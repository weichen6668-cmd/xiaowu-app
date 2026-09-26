/**
 * 统一错误码 XWExxx（§8）：
 * XW1xxx 网络 / XW2xxx 认证 / XW3xxx 数据 / XW4xxx 语音链路。
 * 一切跨层 Promise 返回 ApiResult<T>，UI 按 code 映射中文提示。
 */
import type { ApiResult } from './types';

export const XW_ERR = {
  /** 网络 */
  NET_TIMEOUT: 'XW1001',
  NET_UNREACHABLE: 'XW1002',
  NET_HTTP: 'XW1003',
  LLM_UNCONFIGURED: 'XW1004',
  /** 认证 */
  AUTH_OTP_SEND_FAIL: 'XW2001',
  AUTH_OTP_WRONG: 'XW2002',
  AUTH_NOT_LOGGED_IN: 'XW2003',
  AUTH_TOKEN_EXPIRED: 'XW2004',
  /** 数据 */
  DB_OPEN_FAIL: 'XW3001',
  DB_EXEC_FAIL: 'XW3002',
  SYNC_CONFLICT: 'XW3003',
  STORAGE_FULL: 'XW3004',
  NOT_FOUND: 'XW3005',
  /** 语音链路 */
  MIC_DENIED: 'XW4001',
  RECORD_FAIL: 'XW4002',
  ASR_FAIL: 'XW4003',
  TTS_FAIL: 'XW4004',
  /** 远程遥控（双端互通） */
  REMOTE_NOT_CONNECTED: 'XW5001',
  REMOTE_PAIR_CODE_WRONG: 'XW5002',
  REMOTE_TS_OUT_OF_WINDOW: 'XW5003',
  REMOTE_NONCE_REPLAY: 'XW5004',
  REMOTE_PREEMPTED: 'XW5005',
  REMOTE_CMD_TIMEOUT: 'XW5006',
  REMOTE_DANGER_DENIED: 'XW5007',
  /** 其他 */
  UNKNOWN: 'XW9001',
} as const;

export type XwErrCode = (typeof XW_ERR)[keyof typeof XW_ERR];

/** 默认中文提示（UI 可覆盖） */
const DEFAULT_MSG: Record<string, string> = {
  [XW_ERR.NET_TIMEOUT]: '网络超时，请稍后重试',
  [XW_ERR.NET_UNREACHABLE]: '网络不可用，请检查连接',
  [XW_ERR.NET_HTTP]: '服务请求失败',
  [XW_ERR.LLM_UNCONFIGURED]: 'LLM 未配置，请到设置页填写 API Key',
  [XW_ERR.AUTH_OTP_SEND_FAIL]: '验证码发送失败',
  [XW_ERR.AUTH_OTP_WRONG]: '验证码错误或已过期',
  [XW_ERR.AUTH_NOT_LOGGED_IN]: '请先登录',
  [XW_ERR.AUTH_TOKEN_EXPIRED]: '登录已过期，请重新登录',
  [XW_ERR.DB_OPEN_FAIL]: '本地数据库打开失败',
  [XW_ERR.DB_EXEC_FAIL]: '本地数据读写失败',
  [XW_ERR.SYNC_CONFLICT]: '同步冲突',
  [XW_ERR.STORAGE_FULL]: '存储空间不足',
  [XW_ERR.NOT_FOUND]: '内容不存在',
  [XW_ERR.MIC_DENIED]: '麦克风权限未授予',
  [XW_ERR.RECORD_FAIL]: '录音失败',
  [XW_ERR.ASR_FAIL]: '语音识别失败',
  [XW_ERR.TTS_FAIL]: '语音合成失败',
  [XW_ERR.REMOTE_NOT_CONNECTED]: '远程未连接，请先连接电脑',
  [XW_ERR.REMOTE_PAIR_CODE_WRONG]: '配对码错误',
  [XW_ERR.REMOTE_TS_OUT_OF_WINDOW]: '时间戳超窗，请校准设备时间',
  [XW_ERR.REMOTE_NONCE_REPLAY]: '请求重放被拒',
  [XW_ERR.REMOTE_PREEMPTED]: '遥控被抢占',
  [XW_ERR.REMOTE_CMD_TIMEOUT]: '指令超时',
  [XW_ERR.REMOTE_DANGER_DENIED]: '危险操作被拒绝',
  [XW_ERR.UNKNOWN]: '出错了，请重试',
};

export function ok<T>(data: T): ApiResult<T> {
  return { ok: true, data };
}

export function fail<T = never>(code: string, msg?: string): ApiResult<T> {
  return { ok: false, code, msg: msg || DEFAULT_MSG[code] || DEFAULT_MSG[XW_ERR.UNKNOWN] };
}

/** 按 code 取默认中文提示 */
export function humanMsg(code: string): string {
  return DEFAULT_MSG[code] || DEFAULT_MSG[XW_ERR.UNKNOWN];
}

/** 异常 → ApiResult（捕获网络/未知异常统一包装） */
export function fromError<T = never>(e: unknown): ApiResult<T> {
  const err = e as { name?: string; message?: string };
  if (err && err.name === 'TimeoutError') {
    return fail(XW_ERR.NET_TIMEOUT);
  }
  const msg = (err && err.message) || String(e);
  if (/failed to fetch|network/i.test(msg)) {
    return fail(XW_ERR.NET_UNREACHABLE);
  }
  return fail(XW_ERR.UNKNOWN, msg.slice(0, 200));
}
