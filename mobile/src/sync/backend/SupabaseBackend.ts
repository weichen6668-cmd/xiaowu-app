/**
 * SupabaseBackend：真实 supabase-js 实现（Auth 手机 OTP + PostgREST 四表读写）。
 * RLS 按 user_id 隔离（supabase/policies.sql）。
 * 环境变量：VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY。
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { AuthUser, DataBackend, Device, SyncTable, UserConfig } from '@xw/shared';

declare const __SUPABASE_URL__: string | undefined;
declare const __SUPABASE_ANON__: string | undefined;

export class SupabaseBackend implements DataBackend {
  private client: SupabaseClient;
  private cacheUser: AuthUser | null = null;

  constructor(url?: string, anonKey?: string) {
    const u = url || (typeof __SUPABASE_URL__ !== 'undefined' ? __SUPABASE_URL__ : '') ||
      (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_SUPABASE_URL as string) : '');
    const k = anonKey || (typeof __SUPABASE_ANON__ !== 'undefined' ? __SUPABASE_ANON__ : '') ||
      (typeof import.meta !== 'undefined' ? (import.meta.env?.VITE_SUPABASE_ANON_KEY as string) : '');
    if (!u || !k) {
      throw new Error('缺少 VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY');
    }
    this.client = createClient(u, k);
  }

  async signInOtp(phone: string): Promise<void> {
    const { error } = await this.client.auth.signInWithOtp({ phone });
    if (error) throw new Error(error.message);
  }

  async verifyOtp(phone: string, code: string): Promise<AuthUser> {
    const { data, error } = await this.client.auth.verifyOtp({ phone, token: code, type: 'sms' });
    if (error) throw new Error(error.message);
    const userId = data.user?.id || '';
    this.cacheUser = { userId, phone };
    return this.cacheUser;
  }

  async signOut(): Promise<void> {
    await this.client.auth.signOut();
    this.cacheUser = null;
  }

  async upsertRows(table: SyncTable, rows: Record<string, unknown>[]): Promise<void> {
    if (!rows.length) return;
    const { error } = await this.client.from(table).upsert(rows, { onConflict: 'id' });
    if (error) throw new Error(error.message);
  }

  async fetchSince(table: SyncTable, sinceIso: string): Promise<Record<string, unknown>[]> {
    const col = table === 'sessions' ? 'updated_at' : 'created_at';
    const { data, error } = await this.client
      .from(table)
      .select('*')
      .gt(col, sinceIso)
      .order(col, { ascending: true })
      .limit(500);
    if (error) throw new Error(error.message);
    return (data || []) as Record<string, unknown>[];
  }

  async upsertConfig(cfg: UserConfig): Promise<void> {
    const row = {
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
      tts_enabled: cfg.ttsEnabled === false ? 0 : 1,
      lamport_ts: cfg.lamportTs,
      updated_at: cfg.updatedAt,
    };
    const { error } = await this.client.from('user_config').upsert(row, { onConflict: 'user_id' });
    if (error) throw new Error(error.message);
  }

  async fetchConfig(): Promise<UserConfig | null> {
    const { data: userData } = await this.client.auth.getUser();
    const userId = userData.user?.id || this.cacheUser?.userId || '';
    if (!userId) return null;
    const { data, error } = await this.client
      .from('user_config')
      .select('*')
      .eq('user_id', userId)
      .maybeSingle();
    if (error) throw new Error(error.message);
    if (!data) return null;
    const r = data as Record<string, unknown>;
    return {
      userId: String(r.user_id),
      deviceId: String(r.device_id ?? ''),
      avatarModel: String(r.avatar_model ?? 'mage-a') as 'mage-a' | 'mage-b',
      llmProvider: String(r.llm_provider ?? 'deepseek'),
      llmBaseUrl: String(r.llm_base_url ?? ''),
      llmModel: String(r.llm_model ?? ''),
      asrProvider: String(r.asr_provider ?? 'volc'),
      asrBaseUrl: String(r.asr_base_url ?? ''),
      ttsProvider: String(r.tts_provider ?? 'volc'),
      ttsBaseUrl: String(r.tts_base_url ?? ''),
      ttsVoice: String(r.tts_voice ?? 'xiaowu_female'),
      ttsEnabled: r.tts_enabled == null ? true : Number(r.tts_enabled) !== 0,
      lamportTs: Number(r.lamport_ts ?? 0),
      updatedAt: String(r.updated_at ?? new Date().toISOString()),
      deviceIdLast: String(r.device_id_last ?? ''),
    };
  }

  async listDevices(): Promise<Device[]> {
    const { data, error } = await this.client
      .from('devices')
      .select('*')
      .order('created_at', { ascending: true });
    if (error) throw new Error(error.message);
    return ((data || []) as Record<string, unknown>[]).map((r) => ({
      id: String(r.id),
      userId: String(r.user_id),
      deviceName: String(r.device_name),
      createdAt: String(r.created_at),
      lastSeenAt: String(r.last_seen_at),
    }));
  }

  async registerDevice(name: string): Promise<Device> {
    const { data: userData } = await this.client.auth.getUser();
    const userId = userData.user?.id || this.cacheUser?.userId || '';
    const id = crypto.randomUUID();
    const row = {
      id,
      user_id: userId,
      device_name: name,
      created_at: new Date().toISOString(),
      last_seen_at: new Date().toISOString(),
    };
    const { error } = await this.client.from('devices').insert(row);
    if (error) throw new Error(error.message);
    // Q3：上限 5 台，踢 created_at 最早
    const all = await this.listDevices();
    if (all.length > 5) {
      const evict = all[0];
      await this.client.from('devices').delete().eq('id', evict.id);
    }
    return {
      id,
      userId,
      deviceName: name,
      createdAt: row.created_at,
      lastSeenAt: row.last_seen_at,
    };
  }
}
