/**
 * T07 形象加载（FR-304/Q8/Q9）：GLB/GLTF=GLTFLoader（+meshopt 可选）；
 * FBX=FBXLoader（≤20MB 由 validator 把关，动画仅取首 clip，Q8）；
 * VRM=@pixiv/three-vrm 1.0（0.x 尽力解析，Q9）；PNG/WebM 由 form-renderers（T08）处理。
 * 统一返回 AvatarHandle {scene, animations, hasSkeleton, dispose, mapClip(name)}。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { FBXLoader } from 'three/examples/jsm/loaders/FBXLoader.js';
import type { AvatarSpec } from '@xw/shared';

export interface AvatarHandle {
  scene: THREE.Object3D;
  animations: THREE.AnimationClip[];
  /** 骨架检测结果（false → renderer 走 Q15 兜底摆动） */
  hasSkeleton: boolean;
  /** clipMap 名 → 实际 AnimationClip（找不到回退首 clip） */
  mapClip(name: string): THREE.AnimationClip | null;
  dispose(): void;
}

function buildMapClip(clips: THREE.AnimationClip[], clipMap?: Record<string, string>): (name: string) => THREE.AnimationClip | null {
  return (name: string) => {
    if (!clips.length) return null;
    const wanted = (clipMap && clipMap[name]) || name;
    return clips.find((c) => c.name === wanted) || clips[0]; // 回退首 clip
  };
}

function detectSkeleton(root: THREE.Object3D): boolean {
  let found = false;
  root.traverse((o) => {
    const any = o as THREE.Object3D & { isBone?: boolean; isSkinnedMesh?: boolean };
    if (any.isBone || any.isSkinnedMesh) found = true;
  });
  return found;
}

function disposeTree(root: THREE.Object3D): void {
  root.traverse((o) => {
    const mesh = o as THREE.Mesh;
    if (mesh.geometry) mesh.geometry.dispose();
    const mat = mesh.material as THREE.Material | THREE.Material[] | undefined;
    if (Array.isArray(mat)) mat.forEach((m) => m.dispose());
    else if (mat) mat.dispose();
  });
}

async function loadGltf(url: string): Promise<AvatarHandle> {
  const loader = new GLTFLoader();
  // meshopt 解压可选增强（缺失不阻塞：未压缩模型直接可用）
  try {
    const { MeshoptDecoder } = await import('three/examples/jsm/libs/meshopt_decoder.module.js');
    loader.setMeshoptDecoder(MeshoptDecoder as never);
  } catch {
    /* 无 meshopt：跳过 */
  }
  const gltf = await loader.loadAsync(url);
  const scene = gltf.scene as THREE.Object3D;
  const animations = (gltf.animations || []) as THREE.AnimationClip[];
  return {
    scene,
    animations,
    hasSkeleton: detectSkeleton(scene),
    mapClip: buildMapClip(animations),
    dispose: () => disposeTree(scene),
  };
}

async function loadFbx(url: string): Promise<AvatarHandle> {
  const loader = new FBXLoader();
  const root = await loader.loadAsync(url);
  // Q8：FBX 动画仅取首 clip（多 clip 导出不全是常态，避免错绑）
  const all = (root.animations || []) as THREE.AnimationClip[];
  const animations = all.length ? [all[0]] : [];
  return {
    scene: root as THREE.Object3D,
    animations,
    hasSkeleton: detectSkeleton(root as THREE.Object3D),
    mapClip: buildMapClip(animations),
    dispose: () => disposeTree(root as THREE.Object3D),
  };
}

async function loadVrm(url: string): Promise<AvatarHandle> {
  // Q9：@pixiv/three-vrm 3.x（VRM 1.0 先行，0.x 由插件兼容）；动态 import（依赖缺失时给明确错误）
  let mod: typeof import('@pixiv/three-vrm');
  try {
    mod = await import('@pixiv/three-vrm');
  } catch {
    throw new Error('VRM 支持组件缺失：请安装 @pixiv/three-vrm');
  }
  // v3 API：GLTFLoader + VRMLoaderPlugin（无独立 VRMLoader）
  const loader = new GLTFLoader();
  loader.register((parser) => new mod.VRMLoaderPlugin(parser));
  const gltf = await new Promise<{
    userData: { vrm?: { scene?: THREE.Object3D } };
    scene: THREE.Object3D;
    animations?: THREE.AnimationClip[];
  }>((res, rej) => {
    loader.load(
      url,
      (g: unknown) => res(g as never),
      undefined,
      (e: unknown) => rej(new Error('VRM 解析失败：' + ((e as Error)?.message || '文件损坏'))),
    );
  });
  const vrm = gltf.userData?.vrm || null;
  const scene = (vrm?.scene as THREE.Object3D) || gltf.scene;
  const animations = (gltf.animations || []) as THREE.AnimationClip[];
  return {
    scene,
    animations,
    hasSkeleton: detectSkeleton(scene),
    mapClip: buildMapClip(animations),
    dispose: () => disposeTree(scene),
  };
}

/**
 * 加载入口：按 spec.kind 分派。2D/视频形态（png/webm）不归本加载器
 * （T08 form-renderers 直接消费 uri）。
 */
export async function loadAvatar(spec: AvatarSpec): Promise<AvatarHandle> {
  switch (spec.kind) {
    case 'glb':
    case 'gltf':
      return loadGltf(spec.uri);
    case 'fbx':
      return loadFbx(spec.uri);
    case 'vrm':
      return loadVrm(spec.uri);
    case 'png':
    case 'webm':
      throw new Error(`${spec.kind} 由 2D/视频渲染器处理（form-renderers），不经 avatar-loader`);
    default:
      throw new Error('不支持的形象类型：' + String(spec.kind));
  }
}

/** hash：sha256 前 16 hex（§7 共享知识 1 去重键）；WebCrypto 缺失退 FNV 近似 */
export async function hashFile(file: Blob): Promise<string> {
  try {
    const buf = await file.arrayBuffer();
    const digest = await crypto.subtle.digest('SHA-256', buf);
    return Array.from(new Uint8Array(digest).slice(0, 8))
      .map((b) => b.toString(16).padStart(2, '0'))
      .join('');
  } catch {
    const buf = new Uint8Array(await file.arrayBuffer());
    let h = 0x811c9dc5;
    for (let i = 0; i < buf.length; i += 1) {
      h ^= buf[i];
      h = Math.imul(h, 0x01000193) >>> 0;
    }
    return h.toString(16).padStart(8, '0').repeat(2).slice(0, 16);
  }
}
