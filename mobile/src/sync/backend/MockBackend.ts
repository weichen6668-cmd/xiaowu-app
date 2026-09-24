/**
 * MockBackend：QA 离线自动化测试（§1.3）。
 * - 内存 Map 模拟四张表 + localStorage 持久化
 * - signInWithOtp 固定返回验证码 000000；verifyOtp 校验 000000
 * - 网络延迟 setTimeout(120) 模拟
 * - __mockSeed() 注入测试数据
 */
import type { AuthUser, DataBackend, Device, SyncTable, UserConfig } from '@xw/shared';

const LS_KEY = 'xw.mockdb.v1';

interface MockDbShape {
  sessions: Record<string, unknown>[];
  messages: Record<string, unknown>[];
  user_config: Record<string, unknown>[];
  devices: Record<string, unknown>[];
  currentUser: AuthUser | null;
}

function emptyDb(): MockDbShape {
  return { sessions: [], messages: [], user_config: [], devices: [], currentUser: null };
}

function uuid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string };
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function delay(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

export class MockBackend implements DataBackend {
  private db: MockDbShape = emptyDb();

  constructor() {
    try {
      const raw = localStorage.getItem(LS_KEY);
      if (raw) this.db = { ...emptyDb(), ...(JSON.parse(raw) as MockDbShape) };
    } catch {
      this.db = emptyDb();
    }
  }

  private save(): void {
    try {
      localStorage.setItem(LS_KEY, JSON.stringify(this.db));
    } catch {
      /* 忽略 */
    }
  }

  /** QA 注入测试数据 */
  __mockSeed(partial: Partial<MockDbShape>): void {
    this.db = { ...this.db, ...partial };
    this.save();
  }

  async signInOtp(phone: string): Promise<void> {
    await delay();
    // 兼容 11 位国内 与 +开头国际 E.164（LoginPage 归一后恒带 +，如 +14158080913）
    if (!(/^\d{11}$/.test(phone) || /^\+\d{8,15}$/.test(phone))) throw new Error('手机号格式错误');
    // 固定验证码 000000（§1.3），真实短信通道不发
  }

  async verifyOtp(phone: string, code: string): Promise<AuthUser> {
    await delay();
    if (code !== '000000') throw new Error('验证码错误');
    const user: AuthUser = {
      userId: `mock-${phone}`,
      phone,
    };
    this.db.currentUser = user;
    this.save();
    return user;
  }

  async signOut(): Promise<void> {
    await delay();
    this.db.currentUser = null;
    this.save();
  }

  async upsertRows(table: SyncTable, rows: Record<string, unknown>[]): Promise<void> {
    await delay();
    const arr = this.db[table];
    for (const row of rows) {
      const id = String(row.id);
      const idx = arr.findIndex((r) => String(r.id) === id);
      const merged = { ...(idx >= 0 ? arr[idx] : {}), ...row, updated_at: new Date().toISOString() };
      if (idx >= 0) arr[idx] = merged;
      else arr.push(merged);
    }
    this.save();
  }

  async fetchSince(table: SyncTable, sinceIso: string): Promise<Record<string, unknown>[]> {
    await delay();
    const rows = this.db[table];
    const field = table === 'sessions' ? 'updated_at' : 'created_at';
    return rows.filter((r) => String(r[field] ?? '') > sinceIso).map((r) => ({ ...r }));
  }

  async upsertConfig(cfg: UserConfig): Promise<void> {
    await delay();
    const arr = this.db.user_config;
    const idx = arr.findIndex((r) => r.user_id === cfg.userId);
    const row = this.configToRow(cfg);
    if (idx >= 0) arr[idx] = row;
    else arr.push(row);
    this.save();
  }

  private configToRow(cfg: UserConfig): Record<string, unknown> {
    return {
      user_id: cfg.userId,
      device_id: cfg.deviceId,
      avatar_model: cfg.avatarModel,
      llm_provider: cfg.llmProvider,
      llm_base_url: cfg.llmBaseUrl,
      llm_model: cfg.llmModel,
      asr_provider: cfg.asrProvider,
      asr_base_url: cfg.asrBaseUrl,
      tts_provider: cfg.ttsProvider,
      tts_base_url: cfg.ttsBaseUrl,
      tts_voice: cfg.ttsVoice,
      lamport_ts: cfg.lamportTs,
      updated_at: cfg.updatedAt,
    };
  }

  async fetchConfig(): Promise<UserConfig | null> {
    await delay();
    const cur = this.db.currentUser;
    if (!cur) return null;
    const row = this.db.user_config.find((r) => r.user_id === cur.userId);
    if (!row) return null;
    return {
      userId: String(row.user_id),
      deviceId: String(row.device_id ?? ''),
      avatarModel: String(row.avatar_model ?? 'mage-a') as 'mage-a' | 'mage-b',
      llmProvider: String(row.llm_provider ?? 'deepseek'),
      llmBaseUrl: String(row.llm_base_url ?? ''),
      llmModel: String(row.llm_model ?? ''),
      asrProvider: String(row.asr_provider ?? 'volc'),
      asrBaseUrl: String(row.asr_base_url ?? ''),
      ttsProvider: String(row.tts_provider ?? 'volc'),
      ttsBaseUrl: String(row.tts_base_url ?? ''),
      ttsVoice: String(row.tts_voice ?? 'xiaowu_female'),
      lamportTs: Number(row.lamport_ts ?? 0),
      updatedAt: String(row.updated_at ?? new Date().toISOString()),
      deviceIdLast: String(row.device_id_last ?? ''),
    };
  }

  async listDevices(): Promise<Device[]> {
    await delay();
    const cur = this.db.currentUser;
    return this.db.devices
      .filter((d) => d.user_id === cur?.userId)
      .map((d) => ({
        id: String(d.id),
        userId: String(d.user_id),
        deviceName: String(d.device_name),
        createdAt: String(d.created_at),
        lastSeenAt: String(d.last_seen_at),
      }));
  }

  async registerDevice(name: string): Promise<Device> {
    await delay();
    const cur = this.db.currentUser;
    if (!cur) throw new Error('未登录');
    // Q3：上限 5 台，踢 created_at 最早
    const mine = this.db.devices
      .filter((d) => d.user_id === cur.userId)
      .sort((a, b) => String(a.created_at).localeCompare(String(b.created_at)));
    if (mine.length >= 5) {
      const evict = mine[0];
      this.db.devices = this.db.devices.filter((d) => d.id !== evict.id);
    }
    const now = new Date().toISOString();
    const dev: Device = {
      id: uuid(),
      userId: cur.userId,
      deviceName: name,
      createdAt: now,
      lastSeenAt: now,
    };
    // 统一 snake_case 入库（§8 表/列 snake_case），listDevices/裁剪逻辑同构读取
    this.db.devices.push({
      id: dev.id,
      user_id: dev.userId,
      device_name: dev.deviceName,
      created_at: dev.createdAt,
      last_seen_at: dev.lastSeenAt,
    });
    this.save();
    return dev;
  }
}
