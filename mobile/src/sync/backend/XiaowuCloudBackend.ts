/**
 * XiaowuCloudBackend：对接阿里云 ECS 后端（http://47.239.4.112:8000），
 * 协议见《小巫智能体 - 云端后端部署与对接文档》第三/五节。
 *
 * ⚠️ Auth 桥接说明（诚实声明）：
 *   mobile 的 DataBackend 契约是 signInOtp(phone)/verifyOtp(phone, code)，
 *   新后端是「用户名 + 密码」JWT。本适配器把 phone 字段借为「用户名」、
 *   code 字段借为「密码」（LoginPage 的验证码框当密码框用）。
 *   （LoginPage 已按此改用 loginWithPassword 直连；OTP 桥保留兼容旧路径。）
 *
 * 对话语义：
 *   sessions 行 ↔ /api/conversations（客户端 id 幂等，服务端 ON CONFLICT DO NOTHING）
 *   messages 行 ↔ /api/conversations/{cid}/messages（同上）
 *   服务端无 config/devices 表 → config 落 localStorage，devices 本地占位（文档无此表）。
 */
import type { AuthUser, DataBackend, Device, SyncTable, UserConfig } from '@xw/shared';

const BASE = 'http://47.239.4.112:8000';
const LS_TOKEN = 'xw.xiaowu.token';
const LS_USER = 'xw.xiaowu.user';
const LS_CONFIG = 'xw.xiaowu.config';

function lsGet<T>(k: string): T | null {
  try { const v = localStorage.getItem(k); return v ? (JSON.parse(v) as T) : null; } catch { return null; }
}
function lsSet(k: string, v: unknown): void {
  try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 忽略 */ }
}

export class XiaowuCloudBackend implements DataBackend {
  private token = '';
  private user: AuthUser | null = null;

  constructor() {
    this.token = localStorage.getItem(LS_TOKEN) || '';
    this.user = lsGet<AuthUser>(LS_USER);
  }

  private auth(): Record<string, string> {
    return this.token ? { Authorization: 'Bearer ' + this.token } : {};
  }

  private async api<T>(method: string, p: string, body?: unknown): Promise<T> {
    const res = await fetch(BASE + p, {
      method,
      headers: { 'Content-Type': 'application/json', ...this.auth() },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const data = (await res.json().catch(() => ({}))) as T & { detail?: string };
    if (!res.ok) throw new Error(data.detail || 'HTTP ' + res.status);
    return data;
  }

  /** 标准密码登录（LoginPage xiaowu 模式直连） */
  async loginWithPassword(username: string, password: string): Promise<AuthUser> {
    const data = await this.api<{ token: string; user: { id: number; username: string } }>(
      'POST', '/api/login', { username, password });
    this.token = data.token;
    this.user = { userId: String(data.user.id), phone: data.user.username };
    localStorage.setItem(LS_TOKEN, this.token);
    lsSet(LS_USER, this.user);
    return this.user;
  }

  /** 注册（用户名+密码，email 可选）后自动登录 */
  async register(username: string, password: string, email = ''): Promise<AuthUser> {
    await this.api('POST', '/api/register', { username, password, email });
    return this.loginWithPassword(username, password);
  }

  /** 桥接：phone=用户名（仅记录，登录在 verifyOtp 完成） */
  async signInOtp(phone: string): Promise<void> {
    if (!phone) throw new Error('请输入用户名');
  }

  /** 桥接：code=密码（与 loginWithPassword 等效） */
  async verifyOtp(phone: string, code: string): Promise<AuthUser> {
    return this.loginWithPassword(phone, code);
  }

  async signOut(): Promise<void> {
    this.token = '';
    this.user = null;
    localStorage.removeItem(LS_TOKEN);
    localStorage.removeItem(LS_USER);
  }

  /** 发短信/邮件验证码（purpose: bind=绑定手机 / reset=忘记密码）→ POST /api/send-code */
  async smsSend(phone: string, purpose: 'bind' | 'reset'): Promise<{ mock?: boolean; mock_code?: string }> {
    const channel = phone.includes('@') ? 'email' : 'sms';
    const data = await this.api<{ dev_code?: string }>('POST', '/api/send-code', {
      target: phone,
      purpose: purpose === 'bind' ? 'bind_phone' : 'reset_password',
      channel,
    });
    // 无短信/SMTP 配置时服务端降级返回 dev_code → 映射为 mock 形状（UI 兼容）
    return data && data.dev_code ? { mock: true, mock_code: data.dev_code } : {};
  }

  /** 绑定手机号（需已登录） */
  async bindPhone(phone: string, code: string): Promise<{ ok: boolean; phone: string }> {
    await this.api('POST', '/api/bind-phone', { phone, code });
    return { ok: true, phone };
  }

  /** 忘记密码：发重置验证码 → POST /api/send-code {target, purpose:'reset_password', channel} */
  async forgotPassword(target: string): Promise<{ mock?: boolean; mock_code?: string }> {
    const channel = target.includes('@') ? 'email' : 'sms';
    const data = await this.api<{ dev_code?: string }>('POST', '/api/send-code', {
      target,
      purpose: 'reset_password',
      channel,
    });
    return data && data.dev_code ? { mock: true, mock_code: data.dev_code } : {};
  }

  /** 用验证码重置密码 → POST /api/reset-password {target, code, new_password} */
  async resetPassword(target: string, code: string, newPassword: string): Promise<{ ok: boolean }> {
    await this.api('POST', '/api/reset-password', { target, code, new_password: newPassword });
    return { ok: true };
  }

  /** 上行：sessions→POST conversations（带客户端 id 幂等）；messages→POST messages */
  async upsertRows(table: SyncTable, rows: Record<string, unknown>[]): Promise<void> {
    for (const r of rows) {
      const id = String(r.id ?? '');
      if (table === 'sessions') {
        await this.api('POST', '/api/conversations', { id, title: String(r.title ?? '小巫对话') });
      } else {
        const cid = String(r.session_id ?? r.sessionId ?? '');
        if (!cid) continue;
        await this.api('POST', `/api/conversations/${cid}/messages`, {
          id,
          role: String(r.role ?? 'user'),
          content: String(r.content ?? ''),
          attachment_url: String(r.attachment_url ?? ''),
        });
      }
    }
  }

  /** 下行：拉对话列表（sessions）或全部消息（messages，逐对话拉取） */
  async fetchSince(table: SyncTable, _sinceIso: string): Promise<Record<string, unknown>[]> {
    const uid = this.user ? this.user.userId : '';
    if (table === 'sessions') {
      const data = await this.api<{ conversations: Record<string, unknown>[] }>('GET', '/api/conversations');
      return (data.conversations || []).map((c) => ({
        id: c.id, user_id: uid, device_id: 'cloud', title: c.title,
        lamport_ts: 0, deleted: false, created_at: c.created_at, updated_at: c.updated_at,
      }));
    }
    const { conversations } = await this.api<{ conversations: Record<string, unknown>[] }>('GET', '/api/conversations');
    const out: Record<string, unknown>[] = [];
    for (const c of conversations || []) {
      const cid = String(c.id);
      const data = await this.api<{ messages: Record<string, unknown>[] }>('GET', `/api/conversations/${cid}/messages`);
      for (const m of data.messages || []) {
        out.push({
          id: m.id, session_id: cid, user_id: uid, device_id: 'cloud',
          role: m.role, content: m.content, attachment_url: m.attachment_url ?? '',
          skill_hint: null, lamport_ts: 0, deleted: false,
          created_at: m.created_at, updated_at: m.created_at,
        });
      }
    }
    return out;
  }

  /** 服务端暂无 config 表 → localStorage 暂存 */
  async upsertConfig(cfg: UserConfig): Promise<void> { lsSet(LS_CONFIG, cfg); }
  async fetchConfig(): Promise<UserConfig | null> { return lsGet<UserConfig>(LS_CONFIG); }

  /** 服务端暂无 devices 表 → 本地占位 */
  async listDevices(): Promise<Device[]> {
    const d = await this.registerDevice('local');
    return [d];
  }
  async registerDevice(name: string): Promise<Device> {
    const now = new Date().toISOString();
    return { id: 'local', userId: this.user ? this.user.userId : '', deviceName: name, createdAt: now, lastSeenAt: now };
  }
}
