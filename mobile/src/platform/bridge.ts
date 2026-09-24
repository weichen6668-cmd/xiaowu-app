/**
 * mageAPI 移动版桥（签名对齐 preload.js 子集）：
 * 录音（getUserMedia+MediaRecorder 自采 → 16kHz mono 16bit WAV）/ 网络状态 / 触感。
 * 录音选型说明：@capgo/capacitor-audio-recorder 无 Capacitor 6 兼容版本
 * （7.x 需 core≥7、8.x 需 core≥8），故采用设计 §1.2 既定备选方案 Web Audio 自采；
 * Android 打包后如需原生录音，可将 recordStart() 换为当时兼容 Capacitor 6 的插件 API。
 * Mock/离线：Web 降级用 MediaRecorder/固定 WAV（mock 返回 1 秒静音 WAV）。
 * §8 Mock 切换统一在本文件装配（bridge.ts），禁止散落 if。
 */
import { Haptics, ImpactStyle } from '@capacitor/haptics';
import { Network } from '@capacitor/network';
import {
  createMockAsrClient,
  createMockLlmClient,
  createMockTtsClient,
  type AsrClient,
  type LlmClient,
  type TtsClient,
} from '@xw/shared';

declare const __DATA_BACKEND__: string;
const DATA_BACKEND: 'mock' | 'supabase' | 'xiaowu' =
  (typeof __DATA_BACKEND__ !== 'undefined' ? __DATA_BACKEND__ : 'mock') === 'supabase'
    ? 'supabase'
    : (typeof __DATA_BACKEND__ !== 'undefined' ? __DATA_BACKEND__ : 'mock') === 'xiaowu'
      ? 'xiaowu'
      : 'mock';

export function dataBackendMode(): 'mock' | 'supabase' | 'xiaowu' {
  return DATA_BACKEND;
}

export function isMockMode(): boolean {
  return DATA_BACKEND === 'mock';
}

/**
 * Mock AI 客户端工厂（§1.3/§8）：mock 模式返回固定识别文本 / 示例回复 / 静音 WAV 三件套；
 * 非 mock 返回 null（由 runtime.ts 装配真实客户端）。Mock 开关只在本文件判一次。
 */
export function mockAiClients(): { llm: LlmClient; asr: AsrClient; tts: TtsClient } | null {
  if (!isMockMode()) return null;
  return {
    llm: createMockLlmClient(),
    asr: createMockAsrClient(),
    tts: createMockTtsClient(),
  };
}

/* ============ 麦克风/录音 ============ */

/** 请求麦克风权限 */
export async function requestMic(): Promise<boolean> {
  if (isMockMode()) return true;
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    stream.getTracks().forEach((t) => t.stop());
    return true;
  } catch {
    return false;
  }
}

/** 1 秒静音 WAV（16kHz mono 16bit，mock 录音用） */
export function silentWav(): Uint8Array {
  const sampleRate = 16000;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

/** 录音接口：按住说话调用 start/stop（16kHz mono 16bit WAV） */
export interface RecorderHandle {
  stop(): Promise<Uint8Array>;
  cancel(): void;
  onLevel(cb: (level: number) => void): void;
}

export async function recordStart(): Promise<RecorderHandle> {
  if (isMockMode()) {
    return {
      async stop() {
        await new Promise((r) => setTimeout(r, 300));
        return silentWav();
      },
      cancel() {
        /* no-op */
      },
      onLevel() {
        /* mock 无波形 */
      },
    };
  }

  // Web/Android WebView：getUserMedia + MediaRecorder（16kHz mono）
  const stream = await navigator.mediaDevices.getUserMedia({
    audio: { sampleRate: 16000, channelCount: 1, echoCancellation: true },
  });
  const chunks: Blob[] = [];
  const mime = MediaRecorder.isTypeSupported('audio/webm;codecs=pcm')
    ? 'audio/webm;codecs=pcm'
    : 'audio/webm';
  const rec = new MediaRecorder(stream, { mimeType: mime });
  rec.ondataavailable = (e) => {
    if (e.data.size) chunks.push(e.data);
  };
  rec.start();

  // 音量电平（波形）
  const ac = new AudioContext();
  const src = ac.createMediaStreamSource(stream);
  const analyser = ac.createAnalyser();
  analyser.fftSize = 256;
  src.connect(analyser);
  const dataArr = new Uint8Array(analyser.frequencyBinCount);
  let cbLevel: ((level: number) => void) | null = null;
  let raf = 0;
  const tickLevel = () => {
    analyser.getByteFrequencyDomainData(dataArr);
    const avg = dataArr.reduce((a, b) => a + b, 0) / dataArr.length / 128;
    if (cbLevel) cbLevel(Math.min(1, avg));
    raf = requestAnimationFrame(tickLevel);
  };
  raf = requestAnimationFrame(tickLevel);

  return {
    async stop(): Promise<Uint8Array> {
      cancelAnimationFrame(raf);
      const blob = await new Promise<Blob>((resolve) => {
        rec.onstop = () => resolve(new Blob(chunks, { type: 'audio/webm' }));
        rec.stop();
      });
      stream.getTracks().forEach((t) => t.stop());
      ac.close();
      // WebM → 重采样 WAV（16k mono 16bit）：AudioContext.decodeAudioData
      const ab = await blob.arrayBuffer();
      const ac2 = new AudioContext({ sampleRate: 16000 });
      const audio = await ac2.decodeAudioData(ab);
      ac2.close();
      return audioBufferToWav(audio);
    },
    cancel() {
      cancelAnimationFrame(raf);
      try {
        rec.stop();
      } catch {
        /* ignore */
      }
      stream.getTracks().forEach((t) => t.stop());
      ac.close();
    },
    onLevel(cb: (level: number) => void) {
      cbLevel = cb;
    },
  };
}

/** AudioBuffer → WAV 16kHz mono 16bit PCM（§8 wav 规格） */
export function audioBufferToWav(buffer: AudioBuffer): Uint8Array {
  const numCh = 1;
  const sampleRate = 16000;
  const numSamples = buffer.length;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (off: number, s: string) => {
    for (let i = 0; i < s.length; i += 1) v.setUint8(off + i, s.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, numCh, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, dataSize, true);
  const ch = buffer.getChannelData(0);
  for (let i = 0; i < numSamples; i += 1) {
    const s = Math.max(-1, Math.min(1, ch[i]));
    v.setInt16(44 + i * 2, s < 0 ? s * 0x8000 : s * 0x7fff, true);
  }
  return new Uint8Array(buf);
}

/* ============ 网络状态 ============ */

let online = true;
const onlineCbs: Array<(on: boolean) => void> = [];

/** 初始化网络监听（网络恢复自动补传由 SyncSDK.startAuto 消费） */
export async function initNetworkWatch(): Promise<void> {
  try {
    const status = await Network.getStatus();
    online = status.connected;
    Network.addListener('networkStatusChange', (s) => {
      online = s.connected;
      onlineCbs.forEach((cb) => cb(online));
    });
  } catch {
    // Web 环境降级
    if (typeof window !== 'undefined') {
      online = navigator.onLine;
      window.addEventListener('online', () => {
        online = true;
        onlineCbs.forEach((cb) => cb(true));
      });
      window.addEventListener('offline', () => {
        online = false;
        onlineCbs.forEach((cb) => cb(false));
      });
    }
  }
}

export function isOnline(): boolean {
  return online;
}

export function onNetworkChange(cb: (on: boolean) => void): void {
  onlineCbs.push(cb);
}

/* ============ 触感 ============ */

export async function hapticLight(): Promise<void> {
  try {
    await Haptics.impact({ style: ImpactStyle.Light });
  } catch {
    /* Web 无 haptics */
  }
}
