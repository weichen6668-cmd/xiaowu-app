/**
 * T07 形象校验（FR-304 失败态）：格式/大小/损坏统一报
 * 「格式不支持 / 文件损坏 / 超限」三态文案 + meta（size/kind/hasSkeleton）。
 * 上限（§7 共享知识 7）：GLB/GLTF ≤15MB、FBX ≤20MB（Q8）、PNG ≤5MB、
 * WebM ≤50MB（≤30s 由加载后 duration 复检，Q11）。
 */
import type { AvatarForm, AvatarKind } from '@xw/shared';

export interface ValidateResult {
  ok: boolean;
  reason?: string;
  kind?: AvatarKind;
  form?: AvatarForm;
  meta: {
    size: number;
    kind: AvatarKind | '';
    hasSkeleton: boolean;
  };
}

export const MAX_SIZE: Record<AvatarKind, number> = {
  glb: 15 * 1024 * 1024,
  gltf: 15 * 1024 * 1024,
  fbx: 20 * 1024 * 1024, // Q8：FBX 限 20MB，超限提示转 GLB
  vrm: 30 * 1024 * 1024,
  png: 5 * 1024 * 1024,
  webm: 50 * 1024 * 1024, // Q11：WebM alpha ≤50MB 且 ≤30s
};

const KIND_BY_EXT: Record<string, AvatarKind> = {
  glb: 'glb',
  gltf: 'gltf',
  fbx: 'fbx',
  vrm: 'vrm',
  png: 'png',
  webm: 'webm',
};

const FORM_BY_KIND: Record<AvatarKind, AvatarForm> = {
  glb: '3d',
  gltf: '3d',
  fbx: '3d',
  vrm: '3d',
  png: '2d',
  webm: 'video',
};

export function kindOf(name: string): AvatarKind | '' {
  const m = /\.([a-z0-9]+)$/i.exec(name.trim());
  return m ? KIND_BY_EXT[m[1].toLowerCase()] || '' : '';
}

export function formOfKind(kind: AvatarKind): AvatarForm {
  return FORM_BY_KIND[kind] || '3d';
}

/** 魔数嗅探（损坏/伪装文件拒绝） */
function sniffKind(head: Uint8Array, kind: AvatarKind): boolean {
  const ascii = (s: number, e: number) => String.fromCharCode(...head.slice(s, e));
  switch (kind) {
    case 'glb':
    case 'vrm':
      // glTF 二进制容器：'glTF' + version(2)
      return ascii(0, 4) === 'glTF' && head[4] === 2;
    case 'gltf':
      // JSON 文本：跳 BOM/空白后应为 '{'
      for (let i = 0; i < head.length && i < 8; i += 1) {
        const c = head[i];
        if (c === 0x7b) return true;
        if (c !== 0x20 && c !== 0x0a && c !== 0x0d && c !== 0x09 && c !== 0xef) return false;
      }
      return false;
    case 'fbx':
      // 二进制 FBX："Kaydara FBX Binary" 头；ASCII FBX 以 ';' 注释或 '{' 起
      return ascii(0, 10) === 'Kaydara FB' || head[0] === 0x3b || head[0] === 0x7b;
    case 'png':
      return head[0] === 0x89 && ascii(1, 4) === 'PNG';
    case 'webm':
      // EBML 魔数 1A 45 DF A3（Matroska/WebM）
      return head[0] === 0x1a && head[1] === 0x45 && head[2] === 0xdf && head[3] === 0xa3;
    default:
      return false;
  }
}

/**
 * 校验入口。file：File/Blob（input[type=file] 产物）或 {name, size, slice} 鸭子类型（测试可注入）。
 * 骨架检测（hasSkeleton）在 avatar-loader 加载后回填，此处仅字节级检测（FBX/GLB 含 "skin" 文本近似）。
 */
export async function validate(file: File): Promise<ValidateResult> {
  const size = file.size || 0;
  const kind = kindOf(file.name || '');
  const meta = { size, kind: kind || ('' as const), hasSkeleton: false };
  if (!kind) {
    return { ok: false, reason: '格式不支持：仅支持 GLB/GLTF/FBX/VRM/PNG/WebM', meta };
  }
  if (size === 0) {
    return { ok: false, reason: '文件损坏：内容为空', meta };
  }
  if (size > MAX_SIZE[kind]) {
    const hint = kind === 'fbx' ? '（FBX 超限可转 GLB）' : '';
    return {
      ok: false,
      reason: `超限：${kind.toUpperCase()} 上限 ${Math.round(MAX_SIZE[kind] / 1024 / 1024)}MB${hint}`,
      meta,
    };
  }
  // 魔数嗅探（读头 32 字节；读不到按损坏拒）
  let head: Uint8Array;
  try {
    const buf = await file.slice(0, 32).arrayBuffer();
    head = new Uint8Array(buf);
  } catch {
    return { ok: false, reason: '文件损坏：无法读取', meta };
  }
  if (head.length < 4 || !sniffKind(head, kind)) {
    return { ok: false, reason: '文件损坏：内容与扩展名不符', meta };
  }
  // 近似骨架检测：二进制窗口含 skin/joint 字样（加载后 avatar-loader 权威回填）
  meta.hasSkeleton = await sniffSkeleton(file, kind);
  return { ok: true, kind, form: formOfKind(kind), meta };
}

async function sniffSkeleton(file: File, kind: AvatarKind): Promise<boolean> {
  if (kind !== 'glb' && kind !== 'gltf' && kind !== 'fbx' && kind !== 'vrm') return false;
  try {
    const window = Math.min(file.size, 512 * 1024);
    const buf = await file.slice(0, window).arrayBuffer();
    const text = new TextDecoder('latin1').decode(new Uint8Array(buf));
    return /skin|joint|Armature|Bone/i.test(text);
  } catch {
    return false;
  }
}
