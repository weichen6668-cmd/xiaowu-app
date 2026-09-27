/**
 * T06 悬浮 JS 桥（registerPlugin('OverlayPlugin')，同 secure-store 模式）。
 * - supported(): 仅 Android true；iOS/Web 降级 no-op（FR-317/§7 iOS 边界）
 * - 事件桥 onEvent：tap/doubletap/longpress/snapped/mini/closed/shown
 * - 口型/clip/fps 供 TTS 20Hz 链路与 perf-tier 推送
 */
import { Capacitor, registerPlugin } from '@capacitor/core';

export type OverlayForm = 'ball' | 'pet';

export interface OverlayEvent {
  type: 'tap' | 'doubletap' | 'longpress' | 'snapped' | 'mini' | 'closed' | 'shown';
  data: Record<string, unknown>;
}

interface OverlayNative {
  show(opts: { form: OverlayForm; x: number; y: number; size: number }): Promise<{ shown: boolean }>;
  hide(): Promise<{ shown: boolean }>;
  setForm(opts: { form: OverlayForm }): Promise<{ form: string; shown?: boolean }>;
  setTexture(opts: { b64: string }): Promise<void>;
  expandMini(): Promise<{ expanded: boolean }>;
  setPosition(opts: { x: number; y: number }): Promise<{ x: number; y: number }>;
  isShown(): Promise<{ shown: boolean }>;
  setMouth(opts: { open: number }): Promise<void>;
  playClip(opts: { name: string }): Promise<void>;
  setFps(opts: { fps: number }): Promise<void>;
  pauseAnim(): Promise<void>;
  resumeAnim(): Promise<void>;
  permissionState(): Promise<{ overlay: boolean; battery: boolean }>;
  requestOverlayPermission(): Promise<void>;
  requestBatteryIgnore(): Promise<void>;
  onEvent(cb: (ev: OverlayEvent) => void): Promise<OverlayEvent>;
}

let native: OverlayNative | null = null;
if (Capacitor.isNativePlatform() && Capacitor.getPlatform() === 'android') {
  try {
    native = registerPlugin('OverlayPlugin') as unknown as OverlayNative;
  } catch {
    native = null;
  }
}

/** 悬浮仅 Android（iOS/Web supported=false → UI 隐藏入口 + 明示文案） */
export function supported(): boolean {
  return !!native;
}

function noop(): Promise<void> {
  return Promise.resolve();
}

export const overlay = {
  async show(form: OverlayForm, x = 100, y = 200, size = 120): Promise<boolean> {
    if (!native) return false;
    const r = await native.show({ form, x, y, size });
    return !!r.shown;
  },

  async hide(): Promise<void> {
    if (!native) return noop();
    await native.hide();
  },

  async setForm(form: OverlayForm): Promise<void> {
    if (!native) return noop();
    await native.setForm({ form });
  },

  /** 推贴图（WebView 3D 帧快照 base64 → GL 面；服务未运行时静默跳过） */
  async setTexture(b64: string): Promise<void> {
    if (!native || !b64) return noop();
    await native.setTexture({ b64 });
  },

  /** 球点开 = 迷你对话/语音窗（JS 侧渲染迷你层） */
  async expandMini(): Promise<void> {
    if (!native) return noop();
    await native.expandMini();
  },

  async setPosition(x: number, y: number): Promise<void> {
    if (!native) return noop();
    await native.setPosition({ x, y });
  },

  async isShown(): Promise<boolean> {
    if (!native) return false;
    return (await native.isShown()).shown;
  },

  async setMouth(open: number): Promise<void> {
    if (!native) return noop();
    await native.setMouth({ open });
  },

  async playClip(name: string): Promise<void> {
    if (!native) return noop();
    await native.playClip({ name });
  },

  async setFps(fps: number): Promise<void> {
    if (!native) return noop();
    await native.setFps({ fps });
  },

  /** 主 App 前后台互斥活跃（主前台时悬浮降 8fps/静态） */
  async pauseAnim(): Promise<void> {
    if (!native) return noop();
    await native.pauseAnim();
  },

  async resumeAnim(): Promise<void> {
    if (!native) return noop();
    await native.resumeAnim();
  },

  async permissionState(): Promise<{ overlay: boolean; battery: boolean }> {
    if (!native) return { overlay: false, battery: false };
    return native.permissionState();
  },

  async requestOverlayPermission(): Promise<void> {
    if (!native) return noop();
    await native.requestOverlayPermission();
  },

  async requestBatteryIgnore(): Promise<void> {
    if (!native) return noop();
    await native.requestBatteryIgnore();
  },

  /**
   * 事件订阅（长连接桥：原生一次性 resolve 后由本函数循环重订，对上层只暴露回调）。
   * 返回退订函数。
   */
  onEvent(cb: (ev: OverlayEvent) => void): () => void {
    if (!native) return () => undefined;
    let alive = true;
    const loop = async (): Promise<void> => {
      while (alive) {
        try {
          const ev = await native!.onEvent(() => undefined);
          if (!alive) break;
          if (ev && ev.type) cb(ev);
        } catch {
          // 桥断开（服务销毁/进程重建）：退避 500ms 重试，不无限空转
          await new Promise((r) => setTimeout(r, 500));
        }
      }
    };
    void loop();
    return () => {
      alive = false;
    };
  },
};
