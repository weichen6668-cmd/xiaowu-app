/**
 * 设置状态（FR-107/114）：provider/baseURL/model/音色 + 形象选择。
 * 非敏感配置进 UserConfig（云同步），apiKey 仅 secure-store。
 * §8 配置热更新：各 client 每次请求实时读 settingsStore。
 */
import { create } from 'zustand';
import type { ProviderRow, UserConfig } from '@xw/shared';
import { ConfigRepo } from '../db/repo';
import { secureStore, SS_KEYS } from '../platform/secure-store';

/** 默认配置：与桌面端 config.json 实际 active 对齐（LLM=mimo-v2.6-pro / ASR=硅基流动 XingChen / TTS=MiMo 白桦）。
 * 三段各自独立可改（设置页 provider/baseURL/model/音色/key）；火山仅作可选项（需自填 appid）。 */
export function defaultConfig(userId: string, deviceId: string): UserConfig {
  return {
    userId,
    deviceId,
    avatarModel: 'mage-a',
    llmProvider: 'custom',
    llmBaseUrl: 'https://apimimo.zaiyunding.com/v1',
    llmModel: 'mimo-v2.6-pro',
    asrProvider: 'openai',
    asrBaseUrl: 'https://api.siliconflow.cn/v1',
    asrModel: 'XingChenAGI/XingChenASR-V3.2-Ultra',
    ttsProvider: 'mimo',
    ttsBaseUrl: 'https://api.xiaomimimo.com/v1',
    ttsModel: 'mimo-v2.5-tts',
    ttsVoice: '白桦',
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
  asrRow(): ProviderRow & { appid?: string; cluster?: string };
  ttsRow(): ProviderRow & { appid?: string };
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
      provider: c?.llmProvider || 'custom',
      baseURL: c?.llmBaseUrl || 'https://apimimo.zaiyunding.com/v1',
      model: c?.llmModel || 'mimo-v2.6-pro',
    };
  },

  asrRow(): ProviderRow & { appid?: string; cluster?: string } {
    const c = get().config;
    return {
      provider: c?.asrProvider || 'openai',
      baseURL: c?.asrBaseUrl || 'https://api.siliconflow.cn/v1',
      // 空串 → 让 asr-client 各协议默认生效（mimo→mimo-v2.5-asr / openai→whisper-1）；
      // 以前硬编码 'whisper-1' 会污染 mimo 分支（拿 whisper-1 调 MiMo 必失败）
      model: c?.asrModel || '',
      appid: c?.asrAppid || '',
      cluster: c?.asrCluster || '',
    };
  },

  ttsRow(): ProviderRow & { appid?: string } {
    const c = get().config;
    return {
      provider: c?.ttsProvider || 'mimo',
      baseURL: c?.ttsBaseUrl || 'https://api.xiaomimimo.com/v1',
      // 空串 → tts-client 各协议默认（mimo→mimo-v2.5-tts / openai→tts-1）
      model: c?.ttsModel || '',
      voice: c?.ttsVoice || '白桦',
      appid: c?.ttsAppid || '',
    };
  },
}));

/** 异步读取 apiKey（仅客户端装配用，禁入日志/云） */
export async function readApiKey(which: 'llm' | 'asr' | 'tts'): Promise<string> {
  const k = which === 'llm' ? SS_KEYS.LLM_API_KEY : which === 'asr' ? SS_KEYS.ASR_API_KEY : SS_KEYS.TTS_API_KEY;
  return (await secureStore.get(k)) || '';
}
