/**
 * remote-api — 遥控命令统一封装（补全 T07）
 * 覆盖 P0 命令全集：tools/screenshot/sys/config/model/asr/tts/skills/presence。
 * 信封归一：桌面 handleRemoteCmd 的返回是平铺合并进 reply 信封
 *   （{type,reqId,ok,config|info|screenshot|result|out...}），
 *   渲染层回推走 payload.result —— unwrap 时把 payload 与顶层字段合并，
 *   命令层只面对一个扁平 result 对象，不再区分两种信封。
 */
import type { RemoteReply } from '@xw/shared';
import { remoteSdk } from './remote-sdk';

export interface ToolCallResult {
  ok: boolean;
  reason?: string;
  /** 归一后的扁平结果（config/info/screenshot/result/out/text...） */
  data: Record<string, unknown>;
}

/** 归一信封：顶层字段 + payload 字段 + payload.result 字段（后者优先） */
export function unwrapReply(msg: RemoteReply): Record<string, unknown> {
  const flat = (msg || {}) as unknown as Record<string, unknown>;
  const payload = (msg && msg.payload) || {};
  const inner = (payload as Record<string, unknown>).result;
  return {
    ...flat,
    ...(payload as Record<string, unknown>),
    ...(inner && typeof inner === 'object' ? (inner as Record<string, unknown>) : {}),
  };
}

async function call(cmd: string, args?: Record<string, unknown>): Promise<ToolCallResult> {
  const r = await remoteSdk.send(cmd, args);
  const data = unwrapReply(r);
  const ok = r.ok !== false && r.denied !== true;
  const reason = typeof data.reason === 'string' ? data.reason : (r.reason || '');
  return { ok, reason: reason || undefined, data };
}

/* ===== 系统 ===== */
export function sysInfo(): Promise<ToolCallResult> {
  return call('sys_info');
}
export function sysOptimize(): Promise<ToolCallResult> {
  return call('sys_optimize');
}
export function takeScreenshot(): Promise<ToolCallResult> {
  return call('screenshot');
}

/* ===== 工具执行（args: {name, args}，桌面危险清单走 confirm 回流） ===== */
export function toolsExec(name: string, toolArgs: Record<string, unknown>): Promise<ToolCallResult> {
  return call('tools_exec', { name, args: toolArgs });
}

/* ===== 配置（红线：apiKey/token 脱敏 ****，回传不动即保留原值） ===== */
export function getRemoteConfig(): Promise<ToolCallResult> {
  return call('get_config');
}
export function saveRemoteConfig(config: unknown): Promise<ToolCallResult> {
  return call('save_config', { config });
}
export function setActiveModel(model: string): Promise<ToolCallResult> {
  return call('set_active_model', { model });
}
export function setAsrActive(value: string): Promise<ToolCallResult> {
  return call('set_asr_active', { value });
}
export function setTtsActive(value: string): Promise<ToolCallResult> {
  return call('set_tts_active', { value });
}

/* ===== 技能 ===== */
export interface SkillBrief {
  title?: string;
  owner?: string;
  slug?: string;
  desc?: string;
  installs?: number;
}
export function searchSkills(query: string): Promise<ToolCallResult> {
  return call('search_skills', { query });
}
export function installSkill(skillId: string): Promise<ToolCallResult> {
  return call('install_skill', { skillId });
}
export function runSkill(skillId: string, command?: string): Promise<ToolCallResult> {
  return call('run_skill', { skillId, command: command || '' });
}

/* ===== presence（在线检测心跳，30s 一次） ===== */
export function presencePing(): Promise<ToolCallResult> {
  return call('presence_ping');
}
