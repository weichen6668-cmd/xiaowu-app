/**
 * 设置状态（FR-107/114）：provider/baseURL/model/音色 + 形象选择。
 * 非敏感配置进 UserConfig（云同步），apiKey 仅 secure-store。
 * §8 配置热更新：各 client 每次请求实时读 settingsStore。
 */
import { create } from 'zustand';
import type { ProviderRow, UserConfig } from '@xw/shared';
import { ConfigRepo } from '../db/repo';
import { secureStore, SS_KEYS } from '../platform/secure-store';

/** 默认配置（Q2/Q6：火山女声 xiaowu_female + DeepSeek 示例） */
export function defaultConfig(userId: string, deviceId: string): UserConfig {
  return {
    userId,
    deviceId,
    avatarModel: 'mage-a',
    llmProvider: 'deepseek',
    llmBaseUrl: 'https://api.deepseek.com/v1',
    llmModel: 'deepseek-chat',
    asrProvider: 'volc',
    asrBaseUrl: 'https://openspeech.bytedance.com',
    ttsProvider: 'volc',
    ttsBaseUrl: 'https://openspeech.bytedance.com',
    ttsVoice: 'xiaowu_female',
    ttsEnabled: true,
    lamportTs: 0,
    updatedAt: new Date().toISOString(),
    deviceIdLast: deviceId,
  };
}

interface SettingsState {
  config: UserConfig | null;
  hasLlmKey: boolean;
  hasAsrKey: boolean;
  hasTtsKey: boolean;
  load(userId: string, deviceId: string): Promise<void>;
  update(patch: Partial<UserConfig>): Promise<void>;
  saveApiKey(which: 'llm' | 'asr' | 'tts', value: string): Promise<void>;
  clearApiKey(which: 'llm' | 'asr' | 'tts'): Promise<void>;
  /** 供 shared 客户端热读（每调即读） */
  llmRow(): ProviderRow;
  asrRow(): ProviderRow;
  ttsRow(): ProviderRow;
}

async function keyExists(which: 'llm' | 'asr' | 'tts'): Promise<boolean> {
  const k = which === 'llm' ? SS_KEYS.LLM_API_KEY : which === 'asr' ? SS_KEYS.ASR_API_KEY : SS_KEYS.TTS_API_KEY;
  return !!(await secureStore.get(k));
}

export const useSettingsStore = create<SettingsState>((set, get) => ({
  config: null,
  hasLlmKey: false,
  hasAsrKey: false,
  hasTtsKey: false,

  async load(userId: string, deviceId: string): Promise<void> {
    let cfg = await ConfigRepo.get(userId);
    if (!cfg) {
      cfg = defaultConfig(userId, deviceId);
      await ConfigRepo.upsert(cfg);
    }
    set({
      config: cfg,
      hasLlmKey: await keyExists('llm'),
      hasAsrKey: await keyExists('asr'),
      hasTtsKey: await keyExists('tts'),
    });
  },

  async update(patch: Partial<UserConfig>): Promise<void> {
    const cur = get().config;
    if (!cur) return;
    const next: UserConfig = { ...cur, ...patch, updatedAt: new Date().toISOString() };
    await ConfigRepo.upsert(next);
    set({ config: next });
  },

  async saveApiKey(which, value): Promise<void> {
    const k = which === 'llm' ? SS_KEYS.LLM_API_KEY : which === 'asr' ? SS_KEYS.ASR_API_KEY : SS_KEYS.TTS_API_KEY;
    if (value) await secureStore.set(k, value);
    else await secureStore.remove(k);
    set({
      hasLlmKey: which === 'llm' ? !!value : get().hasLlmKey,
      hasAsrKey: which === 'asr' ? !!value : get().hasAsrKey,
      hasTtsKey: which === 'tts' ? !!value : get().hasTtsKey,
    });
  },

  async clearApiKey(which): Promise<void> {
    await get().saveApiKey(which, '');
  },

  llmRow(): ProviderRow {
    const c = get().config;
    return {
      provider: c?.llmProvider || 'deepseek',
      baseURL: c?.llmBaseUrl || 'https://api.deepseek.com/v1',
      model: c?.llmModel || 'deepseek-chat',
    };
  },

  asrRow(): ProviderRow {
    const c = get().config;
    return {
      provider: c?.asrProvider || 'volc',
      baseURL: c?.asrBaseUrl || 'https://openspeech.bytedance.com',
      model: 'whisper-1',
    };
  },

  ttsRow(): ProviderRow {
    const c = get().config;
    return {
      provider: c?.ttsProvider || 'volc',
      baseURL: c?.ttsBaseUrl || 'https://openspeech.bytedance.com',
      model: 'tts-1',
      voice: c?.ttsVoice || 'xiaowu_female',
    };
  },
}));

/** 异步读取 apiKey（仅客户端装配用，禁入日志/云） */
export async function readApiKey(which: 'llm' | 'asr' | 'tts'): Promise<string> {
  const k = which === 'llm' ? SS_KEYS.LLM_API_KEY : which === 'asr' ? SS_KEYS.ASR_API_KEY : SS_KEYS.TTS_API_KEY;
  return (await secureStore.get(k)) || '';
}
