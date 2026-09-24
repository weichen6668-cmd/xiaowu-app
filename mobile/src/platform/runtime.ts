/**
 * 运行时单点装配（§8 Mock 切换统一在 bridge.ts/本文件，禁止散落 if）：
 * DataBackend（mock|supabase）+ LLM/ASR/TTS 客户端（configProvider 热读）+ ChatOrchestrator + SyncSDK。
 */
import {
  createLlmClient,
  createAsrClient,
  createTtsClient,
  createChatOrchestrator,
  ANIMATION_CATEGORIES,
  type AsrClient,
  type ChatOrchestrator,
  type DataBackend,
  type LlmClient,
  type Message,
  type TtsClient,
} from '@xw/shared';
import { MockBackend } from '../sync/backend/MockBackend';
import { SupabaseBackend } from '../sync/backend/SupabaseBackend';
import { XiaowuCloudBackend } from '../sync/backend/XiaowuCloudBackend';
import { createSyncSDK } from '../sync/sync-sdk';
import { dataBackendMode, isMockMode, isOnline, mockAiClients } from '../platform/bridge';
import { MessageRepo } from '../db/repo';
import { useSettingsStore, readApiKey } from '../store/settingsStore';
import { useAuthStore } from '../store/authStore';
import { getOrCreateDeviceId } from '../sync/device';

let backend: DataBackend | null = null;
let orchestrator: ChatOrchestrator | null = null;
let deviceId = '';
let animTrigger: ((clip: string) => void) | null = null;

export function getDataBackend(): DataBackend {
  if (!backend) {
    backend = dataBackendMode() === 'xiaowu'
      ? new XiaowuCloudBackend()
      : isMockMode()
        ? new MockBackend()
        : new SupabaseBackend();
  }
  return backend;
}

export function getDeviceId(): string {
  return deviceId;
}

/** 3D 层注册动画触发桥（ChatPage 挂载时调） */
export function setAnimationTrigger(fn: (clip: string) => void): void {
  animTrigger = fn;
}

export async function initRuntime(): Promise<{
  backend: DataBackend;
  orchestrator: ChatOrchestrator;
  deviceId: string;
}> {
  const be = getDataBackend();
  deviceId = await getOrCreateDeviceId();
  const auth = useAuthStore.getState();
  await auth.init(be);
  const userId = auth.user?.userId || '';

  // Mock 三件套统一由 bridge.ts 装配（§8）：mock 模式全链路离线可走查
  const mocks = mockAiClients();
  let llmWithKey: LlmClient;
  let asr: AsrClient;
  let tts: TtsClient;

  if (mocks) {
    llmWithKey = mocks.llm;
    asr = mocks.asr;
    tts = mocks.tts;
  } else {
    // 设置热读（每次请求取当前 apiKey + provider 行）
    const llm = createLlmClient(() => ({
      ...useSettingsStore.getState().llmRow(),
      // apiKey 不进 store，临时同步注入（每调即读）
      apiKey: '',
    }));
    // 包装：异步补 apiKey
    llmWithKey = {
      async chat(...args: Parameters<typeof llm.chat>) {
        const key = await readApiKey('llm');
        const row = { ...useSettingsStore.getState().llmRow(), apiKey: key };
        return createLlmClient(() => row).chat(...args);
      },
      async chatStream(...args: Parameters<typeof llm.chatStream>) {
        const key = await readApiKey('llm');
        const row = { ...useSettingsStore.getState().llmRow(), apiKey: key };
        return createLlmClient(() => row).chatStream(...args);
      },
    };
    void llm;

    asr = {
      async transcribe(...args: Parameters<AsrClient['transcribe']>) {
        const key = await readApiKey('asr');
        const row = { ...useSettingsStore.getState().asrRow(), apiKey: key };
        return createAsrClient(() => row).transcribe(...args);
      },
    };
    tts = {
      async synthesize(...args: Parameters<TtsClient['synthesize']>) {
        const key = await readApiKey('tts');
        const row = { ...useSettingsStore.getState().ttsRow(), apiKey: key };
        return createTtsClient(() => row).synthesize(...args);
      },
    };
  }

  const orch = createChatOrchestrator({
    llm: llmWithKey,
    asr,
    tts,
    skillCtx: {
      triggerAnimation: (clip: string) => {
        if (clip === '__speaking__') return; // 口型由 TTS 播报层驱动
        animTrigger?.(clip);
      },
      animationList: ANIMATION_CATEGORIES,
      appVersion: '0.1.0 (M1)',
    },
    getHistory: async (sessionId: string): Promise<Message[]> =>
      MessageRepo.listBySession(sessionId),
    persist: (msg) => MessageRepo.create(msg),
    genId: () => crypto.randomUUID(),
    deviceId,
    userId,
  });
  orchestrator = orch;

  return { backend: be, orchestrator: orch, deviceId };
}

export function getOrchestrator(): ChatOrchestrator {
  if (!orchestrator) throw new Error('runtime not initialized');
  return orchestrator;
}

export function getSyncSDK() {
  return createSyncSDK({
    backend: getDataBackend(),
    deviceId,
    isOnline,
  });
}
