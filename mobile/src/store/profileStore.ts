/**
 * T05 扩展②：多自定义 API 命名档案（LLM/ASR/TTS 三区统一）。
 * 档案 = 名称 + baseUrl + model/voice + key 引用；支持增删改 + 下拉切换。
 * 红线：apiKey 按档案存 Keystore（keyRef 指向 SS 条目），档案元数据（无 key）落
 * schema_meta['api_profiles']（JSON），绝不进 JSON 元数据/oplog/云表。
 */
import { create } from 'zustand';
import { openDb } from '../db/repo';
import { secureStore } from '../platform/secure-store';

export type ProfileKind = 'llm' | 'asr' | 'tts';

export interface ApiProfile {
  id: string;
  kind: ProfileKind;
  name: string;
  baseUrl: string;
  /** llm=模型名；asr=固定 whisper-1；tts=可作音色备注 */
  model: string;
  /** 仅 tts 用（音色），其余为空串 */
  voice: string;
  /** Keystore 条目名（xw.profileKey.<id>），元数据只存引用不存 key */
  keyRef: string;
}

const META_KEY = 'api_profiles';

function keyRefOf(id: string): string {
  return 'xw.profileKey.' + id;
}

function newId(): string {
  const c = globalThis.crypto as { randomUUID?: () => string };
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'p-' + Date.now().toString(36) + '-' + Math.random().toString(36).slice(2, 8);
}

async function loadMeta(): Promise<{ profiles: ApiProfile[]; active: Record<ProfileKind, string> }> {
  const d = await openDb();
  const rows = await d.query('select value from schema_meta where key = ?', [META_KEY]);
  if (!rows.length) return { profiles: [], active: { llm: '', asr: '', tts: '' } };
  try {
    const parsed = JSON.parse(String(rows[0].value)) as {
      profiles?: ApiProfile[];
      active?: Record<ProfileKind, string>;
    };
    return {
      profiles: parsed.profiles || [],
      active: { llm: '', asr: '', tts: '', ...(parsed.active || {}) },
    };
  } catch {
    return { profiles: [], active: { llm: '', asr: '', tts: '' } };
  }
}

async function saveMeta(profiles: ApiProfile[], active: Record<ProfileKind, string>): Promise<void> {
  const d = await openDb();
  // 只存元数据；key 在 Keystore（keyRef 引用），此处绝不序列化任何密钥
  await d.run('insert or replace into schema_meta (key, value) values (?, ?)', [
    META_KEY,
    JSON.stringify({ profiles, active }),
  ]);
}

interface ProfileState {
  profiles: ApiProfile[];
  active: Record<ProfileKind, string>;
  loadAll(): Promise<void>;
  add(p: Omit<ApiProfile, 'id' | 'keyRef'>): Promise<ApiProfile>;
  update(id: string, patch: Partial<Pick<ApiProfile, 'name' | 'baseUrl' | 'model' | 'voice'>>): Promise<void>;
  remove(id: string): Promise<void>;
  setActive(kind: ProfileKind, id: string): Promise<void>;
  /** 当前生效档案（未设置回 null） */
  current(kind: ProfileKind): ApiProfile | null;
  saveProfileKey(id: string, value: string): Promise<void>;
  readProfileKey(id: string): Promise<string>;
  hasProfileKey(id: string): Promise<boolean>;
}

export const useProfileStore = create<ProfileState>((set, get) => ({
  profiles: [],
  active: { llm: '', asr: '', tts: '' },

  async loadAll(): Promise<void> {
    const m = await loadMeta();
    set({ profiles: m.profiles, active: m.active });
  },

  async add(p): Promise<ApiProfile> {
    const full: ApiProfile = { ...p, id: newId(), keyRef: '' };
    full.keyRef = keyRefOf(full.id);
    const profiles = [...get().profiles, full];
    set({ profiles });
    await saveMeta(profiles, get().active);
    return full;
  },

  async update(id, patch): Promise<void> {
    const profiles = get().profiles.map((x) => (x.id === id ? { ...x, ...patch } : x));
    set({ profiles });
    await saveMeta(profiles, get().active);
  },

  async remove(id): Promise<void> {
    await secureStore.remove(keyRefOf(id)); // 先清 Keystore 里的 key
    const profiles = get().profiles.filter((x) => x.id !== id);
    const active = { ...get().active };
    (Object.keys(active) as ProfileKind[]).forEach((k) => {
      if (active[k] === id) active[k] = '';
    });
    set({ profiles, active });
    await saveMeta(profiles, active);
  },

  async setActive(kind, id): Promise<void> {
    const active = { ...get().active, [kind]: id };
    set({ active });
    await saveMeta(get().profiles, active);
  },

  current(kind): ApiProfile | null {
    const id = get().active[kind];
    return get().profiles.find((p) => p.id === id && p.kind === kind) || null;
  },

  /** key 只进 Keystore，元数据/日志/oplog 均不可见 */
  async saveProfileKey(id, value): Promise<void> {
    if (value) await secureStore.set(keyRefOf(id), value);
    else await secureStore.remove(keyRefOf(id));
  },

  async readProfileKey(id): Promise<string> {
    return (await secureStore.get(keyRefOf(id))) || '';
  },

  async hasProfileKey(id): Promise<boolean> {
    return !!(await secureStore.get(keyRefOf(id)));
  },
}));
