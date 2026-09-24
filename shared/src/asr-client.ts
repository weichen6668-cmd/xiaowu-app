/**
 * ASR 客户端（抽自 services/asr.js）：火山一句话 / MiMo / OpenAI-whisper 三协议转写。
 * 无 fs/path/crypto 依赖（reqid 用 globalThis.crypto.randomUUID()）。
 * 超时兜底 ≤45s。
 */
import type { AsrClient, ProviderRow } from './types';

export const ASR_TIMEOUT_MS = 45 * 1000;

/** 火山扩展配置（appid/cluster 不在 ProviderRow，从 provider 侧带） */
export interface VolcAsrExtra {
  appid?: string;
  cluster?: string;
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

function b64(bytes: Uint8Array): string {
  let s = '';
  const CHUNK = 0x8000;
  for (let i = 0; i < bytes.length; i += CHUNK) {
    s += String.fromCharCode(...bytes.subarray(i, i + CHUNK));
  }
  return btoa(s);
}

/**
 * 创建 ASR 客户端。configProvider 每次请求实时取 ProviderRow（§8 热更新），
 * volcExtra 供火山 appid/cluster；apiKey 只经 SecureStore 注入（可选凭证字段）。
 */
export function createAsrClient(
  configProvider: () => ProviderRow & Partial<VolcAsrExtra> & { apiKey?: string },
): AsrClient {
  return {
    async transcribe(wav: Uint8Array, format: 'wav' | 'pcm' = 'wav'): Promise<string> {
      const a = configProvider();
      const token = a.apiKey || '';
      const provider = a.provider || 'volc';

      // 小米 MiMo ASR：chat/completions + input_audio
      if (provider === 'mimo') {
        const baseURL = (a.baseURL || '').replace(/\/$/, '') || 'https://api.xiaomimimo.com/v1';
        const resp = await fetch(baseURL + '/chat/completions', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
          body: JSON.stringify({
            model: a.model || 'mimo-v2.5-asr',
            messages: [
              {
                role: 'user',
                content: [
                  { type: 'input_audio', input_audio: { data: `data:audio/wav;base64,${b64(wav)}` } },
                ],
              },
            ],
            asr_options: { language: 'zh' },
          }),
        });
        if (!resp.ok) {
          throw new Error(`ASR(MiMo) 失败 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        }
        const j = (await resp.json()) as {
          choices?: Array<{ message?: { content?: string } }>;
        };
        return j.choices?.[0]?.message?.content || '';
      }

      // OpenAI 兼容端点（whisper 等）：multipart 上传
      if (provider === 'openai' || provider === 'custom') {
        const baseURL = (a.baseURL || '').replace(/\/$/, '');
        const form = new FormData();
        const ext = format === 'pcm' ? 'pcm' : 'wav';
        form.append('file', new Blob([wav], { type: 'audio/wav' }), `audio.${ext}`);
        form.append('model', a.model || 'whisper-1');
        const resp = await fetch(baseURL + '/audio/transcriptions', {
          method: 'POST',
          headers: { Authorization: `Bearer ${token}` },
          signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
          body: form,
        });
        if (!resp.ok) {
          throw new Error(`ASR(OpenAI) 失败 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
        }
        const j = (await resp.json()) as { text?: string };
        return j.text || '';
      }

      // 火山一句话识别：header(JSON)+binary 音频
      const appid = a.appid || '';
      const cluster = a.cluster || 'volcengine_streaming_common';
      const url = 'https://openspeech.bytedance.com/api/v1/auc/get_one_sentence_recognition';
      const body = {
        app: { appid, token, cluster },
        user: { uid: 'xiaowu-mobile' },
        audio: { format, rate: 16000, bits: 16, channel: 1, codec: 'raw' },
        request: {
          reqid: uuid(),
          workflow: 'audio_in,resample,partition,vad,fe,decode,itn,nlu_punctuate',
          show_utterances: false,
          result_type: 'full',
        },
      };

      // 先 4 字节大端 header 长度，再 header JSON，再二进制音频
      const enc = new TextEncoder();
      const header = enc.encode(JSON.stringify(body));
      const headerLen = new Uint8Array(4);
      new DataView(headerLen.buffer).setUint32(0, header.length, false);
      const payload = new Uint8Array(4 + header.length + wav.length);
      payload.set(headerLen, 0);
      payload.set(header, 4);
      payload.set(wav, 4 + header.length);

      const resp = await fetch(url, {
        method: 'POST',
        headers: { 'Content-Type': 'application/octet-stream' },
        signal: AbortSignal.timeout(ASR_TIMEOUT_MS),
        body: payload,
      });
      if (!resp.ok) {
        throw new Error(`ASR 请求失败 ${resp.status}: ${(await resp.text()).slice(0, 300)}`);
      }
      const json = (await resp.json()) as { status?: number; result?: string };
      if (json.status !== 0) {
        throw new Error(`ASR 识别失败: ${JSON.stringify(json).slice(0, 300)}`);
      }
      return json.result || '';
    },
  };
}
