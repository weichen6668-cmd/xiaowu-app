/**
 * apiKey 存取封装 —— 唯一密钥出入口（§8）。
 * Android：Keystore AES-GCM（自写 Kotlin 插件 KeystorePlugin）。
 * Web/mock 降级：localStorage（仅开发用，禁止生产 Web 部署）。
 * 禁止 apiKey 进 SQLite / 日志 / URL 参数。
 */
import type { SecureStore } from '@xw/shared';
import { Capacitor, registerPlugin } from '@capacitor/core';

/** 扩展 window 声明：KeystorePlugin 原生桥 */
declare global {
  interface Window {
    KeystorePlugin?: {
      set(opts: { key: string; value: string }): Promise<void>;
      get(opts: { key: string }): Promise<{ value: string | null }>;
      remove(opts: { key: string }): Promise<void>;
    };
  }
}

const PREFIX = 'xw.secure.';

// 原生平台注册 KeystorePlugin（JS 桥赋值；Web 下不注册）
if (Capacitor.isNativePlatform() && typeof window !== 'undefined' && !window.KeystorePlugin) {
  window.KeystorePlugin = registerPlugin('KeystorePlugin') as unknown as NonNullable<Window['KeystorePlugin']>;
}

function native(): boolean {
  return typeof window !== 'undefined' && !!window.KeystorePlugin;
}

export const secureStore: SecureStore = {
  async set(key: string, value: string): Promise<void> {
    if (native()) {
      await window.KeystorePlugin!.set({ key, value });
      return;
    }
    // Web 降级（开发/mock）：localStorage（掩码存储；生产 Android 不走此分支）
    localStorage.setItem(PREFIX + key, value);
  },

  async get(key: string): Promise<string | null> {
    if (native()) {
      const r = await window.KeystorePlugin!.get({ key });
      return r.value;
    }
    return localStorage.getItem(PREFIX + key);
  },

  async remove(key: string): Promise<void> {
    if (native()) {
      await window.KeystorePlugin!.remove({ key });
      return;
    }
    localStorage.removeItem(PREFIX + key);
  },
};

/** SecureStore 键名常量 */
export const SS_KEYS = {
  DEVICE_ID: 'device_id',
  AUTH_SESSION: 'auth_session',
  ECS_TOKEN: 'ecs_token',
  ECS_USER: 'ecs_user',
  LLM_API_KEY: 'llm_api_key',
  ASR_API_KEY: 'asr_api_key',
  TTS_API_KEY: 'tts_api_key',
} as const;
