/**
 * T06 悬浮状态（FR-301~307）：form 双形态、size 80~200dp、powerSave、visible、
 * mini 会话绑定。接 perf-tier 分档推 fps（手动最高优先）+ overlay 桥事件分发。
 * 状态仅本地（悬浮是本地形态，不同步 oplog——§7 共享知识 3/6）。
 */
import { create } from 'zustand';
import { overlay, supported, type OverlayEvent, type OverlayForm } from '../platform/overlay';
import { currentFps, onThermal, setManualTier, watchBattery, type PerfTier } from '../platform/perf-tier';

interface OverlayState {
  /** 平台支持（Android true；iOS/Web false → UI 隐藏入口） */
  supported: boolean;
  visible: boolean;
  form: OverlayForm;
  /** 80~200dp（FR-302） */
  sizeDp: number;
  /** 手动省电（最高优先，FR-307） */
  powerSave: boolean;
  /** 自动降级中（角标提示） */
  throttled: boolean;
  /** 球点开迷你窗时绑定的会话 id（mini 对话/语音窗） */
  miniSessionId: string | null;
  /** 最近事件（引导页验证用） */
  lastEvent: OverlayEvent | null;
  show(form?: OverlayForm): Promise<boolean>;
  hide(): Promise<void>;
  setForm(form: OverlayForm): Promise<void>;
  setSize(dp: number): Promise<void>;
  setPowerSave(on: boolean): Promise<void>;
  expandMini(sessionId: string | null): Promise<void>;
  /** 接线：perf 分档推 fps + 电池订阅 + 原生事件分发（App 启动调一次） */
  attach(): () => void;
}

export const useOverlayStore = create<OverlayState>((set, get) => ({
  supported: supported(),
  visible: false,
  form: 'ball',
  sizeDp: 120,
  powerSave: false,
  throttled: false,
  miniSessionId: null,
  lastEvent: null,

  async show(form): Promise<boolean> {
    const f = form || get().form;
    const ok = await overlay.show(f, 100, 200, get().sizeDp);
    if (ok) {
      set({ visible: true, form: f });
      // 显示后立即按当前档推 fps（perf-tier 联动）
      await overlay.setFps(get().powerSave ? 8 : currentFps());
    }
    return ok;
  },

  async hide(): Promise<void> {
    await overlay.hide();
    set({ visible: false, miniSessionId: null });
  },

  async setForm(form): Promise<void> {
    await overlay.setForm(form);
    set({ form });
  },

  async setSize(dp): Promise<void> {
    const v = Math.round(dp);
    if (v < 80 || v > 200) return;
    set({ sizeDp: v });
    // 尺寸变化按当前形态重显（80~200dp，FR-302）
    if (get().visible) await overlay.show(get().form, 100, 200, v);
  },

  async setPowerSave(on): Promise<void> {
    setManualTier(on ? 'low' : null);
    set({ powerSave: on, throttled: false });
    await overlay.setFps(on ? 8 : currentFps());
  },

  async expandMini(sessionId): Promise<void> {
    await overlay.expandMini();
    set({ miniSessionId: sessionId });
  },

  attach(): () => void {
    const offs: Array<() => void> = [];
    // perf 分档 → fps（手动 powerSave 最高优先；自动降级置角标）
    offs.push(
      onThermal((t: PerfTier, throttled: boolean) => {
        set({ throttled: throttled && !get().powerSave });
        if (get().visible) void overlay.setFps(get().powerSave ? 8 : currentFps());
        void t;
      }),
    );
    offs.push(watchBattery());
    // 原生事件分发（tap→迷你窗、doubletap→形态互切、longpress→快捷面板入口）
    offs.push(
      overlay.onEvent((ev: OverlayEvent) => {
        set({ lastEvent: ev });
        if (ev.type === 'tap') {
          const sid = get().miniSessionId;
          void get().expandMini(sid);
        } else if (ev.type === 'doubletap') {
          void get().setForm(get().form === 'ball' ? 'pet' : 'ball');
        }
        // longpress/mini/closed/snapped 由页面层按 lastEvent 响应（AvatarQuickPanel 等）
        if (ev.type === 'closed') set({ visible: false, miniSessionId: null });
        if (ev.type === 'shown') set({ visible: true });
      }),
    );
    return () => offs.forEach((f) => f());
  },
}));
