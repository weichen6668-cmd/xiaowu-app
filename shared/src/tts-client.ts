/**
 * TTS 客户端（抽自 services/tts.js）：火山 / MiMo / OpenAI 三协议合成。
 * 声音克隆采样文件（fs）不进 shared，留在 Electron 侧。
 * 超时兜底 ≤30s。返回 null → 系统 TTS 兜底。
 */
import type { ProviderRow, TtsClient } from './types';

export const TTS_TIMEOUT_MS = 30 * 1000;

/** 火山扩展配置 */
export interface VolcTtsExtra {
  appid?: string;
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

/**
 * 创建 TTS 客户端。configProvider 每次请求实时取 ProviderRow（§8 热更新）。
 * synthesize(text) → mp3/wav bytes；未配置返回 null（前端降级系统 TTS）。
 * apiKey 只经 SecureStore 注入（可选凭证字段，不进类型/云表）。
 */
export function createTtsClient(
  configProvider: () => ProviderRow & Partial<VolcTtsExtra> & { apiKey?: string },
): TtsClient {
  return {
    async synthesize(text: string): Promise<Uint8Array | null> {
      const t = configProvider();
      const provider = t.provider || 'volc';
      const token = t.apiKey || '';
      const trimmed = String(text).slice(0, 2000);

      // 未配置任何可用凭证 → 系统 TTS 兜底
      if (provider !== 'volc' && !token) return null;
      if (provider === 'volc' && !t.appid) return null;

      // 小米 MiMo TTS：chat/completions + audio 参数
      if (provider === 'mimo') {
        const baseURL = (t.baseURL || '').replace(/\/$/, '') || 'https://api.xiaomimimo.com/v1';
        const resp = await fetch(baseURL + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
          body: JSON.stringify({
            model: t.model || 'mimo-v2.5-tts',
            messages: [
              { role: 'user', content: '用自然流畅的中文朗读以下内容，保持正常语速和语气。' },
              { role: 'assistant', content: trimmed },
            ],
            audio: { format: 'wav', voice: t.voice || '白桦' },
          }),
        });
        if (!resp.ok) {
          throw new Error(`TTS(MiMo) 失败 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        }
        const j = (await resp.json()) as {
          choices?: Array<{ message?: { audio?: { data?: string } } }>;
        };
        const audioB64 = j.choices?.[0]?.message?.audio?.data;
        if (!audioB64) throw new Error('TTS(MiMo) 返回无音频数据');
        const bin = atob(audioB64);
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
      }

      // OpenAI 兼容 TTS：POST /audio/speech
      if (provider === 'openai' || provider === 'custom') {
        const baseURL = (t.baseURL || '').replace(/\/$/, '');
        const resp = await fetch(baseURL + '/audio/speech', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
          body: JSON.stringify({
            model: t.model || 'tts-1',
            voice: t.voice || 'alloy',
            input: trimmed,
          }),
        });
        if (!resp.ok) {
          throw new Error(`TTS(OpenAI) 失败 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        }
        return new Uint8Array(await resp.arrayBuffer());
      }

      // 火山 TTS：POST /api/v1/tts → mp3 二进制
      const url = 'https://openspeech.bytedance.com/api/v1/tts';
      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        signal: AbortSignal.timeout(TTS_TIMEOUT_MS),
        body: JSON.stringify({
          app: { appid: t.appid || '', token, cluster: 'volcano_tts' },
          user: { uid: 'xiaowu-mobile' },
          audio: {
            voice_type: t.voice || 'xiaowu_female',
            encoding: 'mp3',
            speed_ratio: 1.0,
            sample_rate: 24000,
          },
          request: { reqid: uuid(), text: trimmed, operation: 'query', silence_duration: 200 },
        }),
      });
      if (!resp.ok) {
        throw new Error(`TTS 请求失败 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const contentType = resp.headers.get('content-type') || '';
      if (contentType.includes('json')) {
        const json = await resp.json();
        throw new Error(`TTS 合成失败: ${JSON.stringify(json).slice(0, 300)}`);
      }
      return new Uint8Array(await resp.arrayBuffer());
    },
  };
}
