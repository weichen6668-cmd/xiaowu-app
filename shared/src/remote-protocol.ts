/**
 * 双端互通指令通道协议（手机 ⇄ MQTT ⇄ 电脑 remote-ipc）。
 * 双端共用同一 schema：消息体信封 + 鉴权四件套 + 命令常量 + nonce 窗口去重。
 *
 * 信封（to-pc / to-phone 统一）：{type, reqId, ok?, denied?, reason?, payload?}
 * 请求体 = {pc, ts, nonce, reqId, cmd, args?}
 *
 * 红线：pc=配对码只留电脑端（不进 oplog/云表）；apiKey/token 不经本协议传输。
 */
import type { TrajectoryStep } from './types';

/* ============ MQTT 主题（room 规则 §7.3） ============ */

/** 手机 → 电脑 */
export function topicToPc(room: string): string {
  return `deskpet/${room}/to-pc`;
}
/** 电脑 → 手机 */
export function topicToPhone(room: string): string {
  return `deskpet/${room}/to-phone`;
}
/** 设备 presence（retain 心跳 30s） */
export function topicPresence(room: string): string {
  return `deskpet/${room}/presence`;
}
/** ECS 同步通知（按 userId） */
export function topicNotify(userId: string): string {
  return `deskpet/${userId}/notify`;
}

/* ============ 常量 ============ */

/** ts 允许偏差 ±120s */
export const TS_WINDOW_MS = 120 * 1000;
/** nonce 去重窗口 120s */
export const NONCE_WINDOW_MS = 120 * 1000;
/** 配对码格式：16 位 hex */
export const PAIR_CODE_RE = /^[0-9a-f]{16}$/i;
/** room 格式：xw-{base36ts}-{hex4} */
export const ROOM_RE = /^xw-[0-9a-z]+-[0-9a-f]{4}$/;

/* ============ 消息体类型（§3.1） ============ */

/** 鉴权四件套 */
export interface RemoteAuthFields {
  /** 配对码（16 hex） */
  pc: string;
  /** epoch ms，±120s 窗口 */
  ts: number;
  /** 120s 内唯一 */
  nonce: string;
  /** uuid，请求/响应关联 */
  reqId: string;
}

/** 手机 → 电脑 请求体 */
export interface RemoteCmd extends RemoteAuthFields {
  /** 见 REMOTE_CMD 常量表 */
  cmd: string;
  args?: Record<string, unknown>;
}

export type RemoteReplyType =
  | 'reply'
  | 'step'
  | 'delta'
  | 'screenshot'
  | 'file'
  | 'presence'
  | 'config-changed'
  | 'confirm'
  | 'deny';

/** 电脑 → 手机 统一信封 */
export interface RemoteReply {
  type: RemoteReplyType;
  /** 与请求关联（presence 类可为空串） */
  reqId: string;
  ok?: boolean;
  denied?: boolean;
  reason?: string;
  /**
   * type=reply:          { result?: unknown }
   * type=step:           { step: TrajectoryStep }
   * type=delta:          { text: string }
   * type=screenshot:     { imageB64: string, mime: 'image/png' }
   * type=file:           { name, size, mime, url?|b64? }
   * type=presence:       { deviceId, deviceName, online, ts }
   * type=confirm:        { action, detail, timeoutSec }
   * type=config-changed: { section: 'llm'|'asr'|'tts'|'remote'|'avatar' }（'avatar' 为 T07 FR-308/Q14：PC 端近似映射响应）
   */
  payload?: Record<string, unknown>;
}

/** 通道消息联合体 */
export type RemoteMessage = RemoteCmd | RemoteReply;

/** presence 载荷 */
export interface PresencePayload {
  deviceId: string;
  deviceName: string;
  online: boolean;
  ts: number;
}

/* ============ 命令常量（§3.3） ============ */

export const REMOTE_CMD = {
  /* agent */
  CHAT_TEXT: 'chat_text',
  VOICE: 'voice',
  AGENT_TASK: 'agent_task',
  AGENT_ABORT: 'agent_abort',
  /* tools / system */
  TOOLS_EXEC: 'tools_exec',
  SYS_INFO: 'sys_info',
  SYS_OPTIMIZE: 'sys_optimize',
  SCREENSHOT: 'screenshot',
  /* config */
  GET_CONFIG: 'get_config',
  SAVE_CONFIG: 'save_config',
  SET_ACTIVE_MODEL: 'set_active_model',
  SET_ASR_ACTIVE: 'set_asr_active',
  SET_TTS_ACTIVE: 'set_tts_active',
  /* file */
  FILE_START: 'file-start',
  FILE_CHUNK: 'file-chunk',
  FILE_END: 'file-end',
  FILE_BROWSE: 'file_browse',
  FILE_READ: 'file_read',
  /* skills */
  SEARCH_SKILLS: 'search_skills',
  INSTALL_SKILL: 'install_skill',
  RUN_SKILL: 'run_skill',
  SKILLS_LIST: 'skills_list',
  SKILLS_SET_ENABLED: 'skills_set_enabled',
  /* neko */
  NEKO_LIST: 'neko_list',
  NEKO_SET_ENABLED: 'neko_set_enabled',
  NEKO_CALL: 'neko_call',
  NEKO_MARKET_INSTALL: 'neko_market_install',
  /* mcp */
  MCP_LIST_TOOLS: 'mcp_list_tools',
  MCP_CALL_TOOL: 'mcp_call_tool',
  /* ctrl / confirm / presence */
  CTRL_CLAIM: 'ctrl_claim',
  CTRL_RELEASE: 'ctrl_release',
  CONFIRM_RESULT: 'confirm_result',
  PRESENCE_PING: 'presence_ping',
} as const;

export type RemoteCmdName = (typeof REMOTE_CMD)[keyof typeof REMOTE_CMD];

/** P0 命令集（T03 路由首批） */
export const P0_CMDS: readonly string[] = [
  REMOTE_CMD.CHAT_TEXT,
  REMOTE_CMD.VOICE,
  REMOTE_CMD.TOOLS_EXEC,
  REMOTE_CMD.SYS_INFO,
  REMOTE_CMD.SYS_OPTIMIZE,
  REMOTE_CMD.SCREENSHOT,
  REMOTE_CMD.GET_CONFIG,
  REMOTE_CMD.SAVE_CONFIG,
  REMOTE_CMD.SET_ACTIVE_MODEL,
  REMOTE_CMD.SET_ASR_ACTIVE,
  REMOTE_CMD.SET_TTS_ACTIVE,
  REMOTE_CMD.FILE_START,
  REMOTE_CMD.FILE_CHUNK,
  REMOTE_CMD.FILE_END,
  REMOTE_CMD.CTRL_CLAIM,
  REMOTE_CMD.CTRL_RELEASE,
  REMOTE_CMD.CONFIRM_RESULT,
  REMOTE_CMD.PRESENCE_PING,
];

/* ============ 危险操作清单（§7.10，需手机确认） ============ */

export const DANGEROUS_TOOLS: readonly string[] = [
  'run_shell',
  'install_software',
  'move_to_trash',
  'send_wechat',
  'click_on',
  'type_text',
  'system_power',
];

/** 命中危险清单返回理由，否则 null */
export function dangerReason(toolName: string): string | null {
  const n = String(toolName || '');
  return DANGEROUS_TOOLS.includes(n) ? `危险操作 ${n} 需要手机确认` : null;
}

/* ============ 鉴权构造与校验（§3.5 / §7.2） ============ */

/** 生成 uuid（WebView 无 randomUUID 时退化拼接） */
export function newId(prefix = ''): string {
  const c: Crypto | undefined = typeof crypto !== 'undefined' ? crypto : undefined;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return (
    prefix +
    Date.now().toString(36) +
    '-' +
    Math.random().toString(36).slice(2, 10) +
    '-' +
    Math.random().toString(36).slice(2, 6)
  );
}

/**
 * 构造鉴权四件套（手机端发送前调用）。
 * classDiagram 签名 buildAuth(pc) → AuthFields；reqId/now 可注入便于测试与请求关联。
 */
export function buildAuth(pc: string, reqId: string = newId(), now: number = Date.now()): RemoteAuthFields {
  return { pc: String(pc || ''), ts: now, nonce: newId('n-'), reqId };
}

/** ts 是否在 ±windowMs 窗口内 */
export function isTsInWindow(ts: number, now: number = Date.now(), windowMs: number = TS_WINDOW_MS): boolean {
  return typeof ts === 'number' && Number.isFinite(ts) && Math.abs(now - ts) <= windowMs;
}

/** 恒定时间比较配对码（防时序侧信道；双端可用） */
export function pairCodeEqual(a: string, b: string): boolean {
  const x = String(a || '').toLowerCase();
  const y = String(b || '').toLowerCase();
  if (x.length !== y.length || x.length === 0) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

/** nonce 120s 窗口去重器（每连接/room 一个实例） */
export class NonceTracker {
  private seen = new Map<string, number>();

  /** 新 nonce → true；重放/空值 → false */
  check(nonce: string, now: number = Date.now()): boolean {
    this.gc(now);
    const n = String(nonce || '');
    if (!n || this.seen.has(n)) return false;
    this.seen.set(n, now);
    return true;
  }

  private gc(now: number): void {
    this.seen.forEach((t, n) => {
      if (now - t > NONCE_WINDOW_MS) this.seen.delete(n);
    });
  }

  size(): number {
    return this.seen.size;
  }
}

/** 鉴权失败码（对齐 XW5002/3/4） */
export type AuthFailCode = 'XW5002' | 'XW5003' | 'XW5004';

/**
 * 验证鉴权四件套：pc（恒定时间）→ ts（±120s）→ nonce（120s 去重）。
 * 返回 null=通过，否则失败码。reqId 仅作关联不参与鉴权。
 */
export function verifyRemoteAuth(
  auth: RemoteAuthFields,
  expectedPc: string,
  tracker: NonceTracker,
  now: number = Date.now(),
): AuthFailCode | null {
  if (!auth || typeof auth !== 'object') return 'XW5002';
  if (!pairCodeEqual(auth.pc, expectedPc)) return 'XW5002';
  if (!isTsInWindow(auth.ts, now)) return 'XW5003';
  if (!tracker.check(auth.nonce, now)) return 'XW5004';
  return null;
}

/* ============ 信封构造（电脑端回流 / 手机端回执） ============ */

export function makeReply(reqId: string, result?: unknown): RemoteReply {
  return { type: 'reply', reqId, ok: true, payload: result === undefined ? {} : { result } };
}

export function makeDeny(reqId: string, code: string, reason: string): RemoteReply {
  return { type: 'deny', reqId, ok: false, denied: true, reason: `${code} ${reason}` };
}

export function makeDelta(reqId: string, text: string): RemoteReply {
  return { type: 'delta', reqId, payload: { text: String(text || '') } };
}

export function makeStep(reqId: string, step: TrajectoryStep): RemoteReply {
  return { type: 'step', reqId, payload: { step: step as unknown as Record<string, unknown> } };
}

export function makeScreenshot(reqId: string, imageB64: string, mime = 'image/png'): RemoteReply {
  return { type: 'screenshot', reqId, payload: { imageB64: String(imageB64 || ''), mime } };
}

export function makeFile(reqId: string, name: string, size: number, mime: string, urlOrB64?: { url?: string; b64?: string }): RemoteReply {
  return {
    type: 'file',
    reqId,
    payload: { name: String(name || ''), size: Number(size) || 0, mime: String(mime || ''), url: urlOrB64 && urlOrB64.url, b64: urlOrB64 && urlOrB64.b64 },
  };
}

export function makePresence(p: PresencePayload): RemoteReply {
  return {
    type: 'presence',
    reqId: '',
    payload: {
      deviceId: String(p.deviceId || ''),
      deviceName: String(p.deviceName || ''),
      online: !!p.online,
      ts: Number(p.ts) || Date.now(),
    },
  };
}

export function makeConfirm(reqId: string, action: string, detail: string, timeoutSec = 30): RemoteReply {
  return { type: 'confirm', reqId, payload: { action: String(action || ''), detail: String(detail || ''), timeoutSec } };
}

export function makeConfigChanged(section: 'llm' | 'asr' | 'tts' | 'remote' | 'avatar'): RemoteReply {
  return { type: 'config-changed', reqId: '', payload: { section } };
}

/* ============ 脱敏（§7.6 get_config 打码 / confirm 详情脱敏） ============ */

/** 凭据打码：保留前后 2 位，中间固定 4 星（如 ab****yz）；短串全码 */
export function maskSecret(v: string): string {
  const s = String(v || '');
  if (!s) return '';
  if (s.length <= 4) return '****';
  return s.slice(0, 2) + '****' + s.slice(-2);
}

/** 命令摘要脱敏（confirm 详情）：args 内敏感键值打码 */
export function maskArgsSummary(args: Record<string, unknown> | undefined, maxLen = 120): string {
  if (!args) return '';
  const SENSITIVE = /(key|token|secret|password|passwd|credential|authorization|cookie)/i;
  const out: Record<string, unknown> = {};
  Object.keys(args).forEach((k) => {
    const v = args[k];
    if (SENSITIVE.test(k) && typeof v === 'string') out[k] = maskSecret(v);
    else if (typeof v === 'string' && v.length > 60) out[k] = v.slice(0, 57) + '...';
    else out[k] = v;
  });
  const s = JSON.stringify(out);
  return s.length > maxLen ? s.slice(0, maxLen - 3) + '...' : s;
}

/** save_config 遇 **** 保留旧值（§7.6）：返回是否为占位打码值 */
export function isMaskedPlaceholder(v: unknown): boolean {
  return typeof v === 'string' && /\*{4}/.test(v);
}
