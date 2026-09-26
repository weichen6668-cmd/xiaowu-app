/**
 * deviceStore — 设备列表 / 在线状态 / 当前连接设备 / 配对流程状态（T04）
 * 数据源：ECS /api/devices（XiaowuCloudBackend.listDevices）+ MQTT presence 回流。
 * 红线：pairCode 仅内存（remote-sdk 持有），不入 store 持久化、不进云表。
 */
import { create } from 'zustand';
import type { DeviceInfo, ApiResult } from '@xw/shared';
import { ok, fail, XW_ERR, fromError } from '@xw/shared';
import { getDataBackend } from '../platform/runtime';
import { remoteSdk } from '../remote/remote-sdk';

export type PairStep = 'idle' | 'connecting' | 'paired' | 'error';

export interface DeviceState {
  devices: DeviceInfo[];
  current: DeviceInfo | null;
  pairStep: PairStep;
  pairError: string;
  mqttConnected: boolean;
  refresh: () => Promise<ApiResult<DeviceInfo[]>>;
  pair: (code: string, room: string) => Promise<ApiResult<boolean>>;
  setCurrent: (d: DeviceInfo | null) => void;
  setMqttConnected: (on: boolean) => void;
  reset: () => void;
}

const initialState = {
  devices: [] as DeviceInfo[],
  current: null as DeviceInfo | null,
  pairStep: 'idle' as PairStep,
  pairError: '',
  mqttConnected: false,
};

export const useDeviceStore = create<DeviceState>((set, get) => ({
  ...initialState,

  /** 拉取设备列表（登录后调用） */
  refresh: async () => {
    try {
      const backend = getDataBackend() as unknown as { listDevices?: () => Promise<DeviceInfo[]> };
      if (!backend.listDevices) return fail(XW_ERR.NOT_FOUND, '当前后端不支持设备管理');
      const devices = await backend.listDevices();
      set({ devices: Array.isArray(devices) ? devices : [] });
      return ok(get().devices);
    } catch (e) {
      return fromError<DeviceInfo[]>(e);
    }
  },

  /**
   * 配对并连接遥控通道：手输 16-hex 配对码（P0，扫码 P1）。
   * 成功 → pairStep='paired' + mqttConnected；失败 → pairStep='error' + 中文原因。
   */
  pair: async (code: string, room: string) => {
    const clean = String(code || '').trim().toLowerCase();
    if (!/^[0-9a-f]{16}$/.test(clean)) {
      set({ pairStep: 'error', pairError: '配对码须为 16 位十六进制' });
      return fail(XW_ERR.REMOTE_PAIR_CODE_WRONG, '配对码须为 16 位十六进制');
    }
    set({ pairStep: 'connecting', pairError: '' });
    try {
      const r = await remoteSdk.connect(room, clean);
      if (!r.ok) {
        set({ pairStep: 'error', pairError: r.reason || '连接失败', mqttConnected: false });
        return fail(XW_ERR.REMOTE_NOT_CONNECTED, r.reason);
      }
      set({ pairStep: 'paired', mqttConnected: true, pairError: '' });
      return ok(true);
    } catch (e) {
      set({ pairStep: 'error', pairError: '连接异常', mqttConnected: false });
      return fromError<boolean>(e);
    }
  },

  setCurrent: (d) => set({ current: d }),
  setMqttConnected: (on) => set({ mqttConnected: !!on }),
  reset: () => {
    remoteSdk.disconnect();
    set({ ...initialState });
  },
}));

/** 独立桥接：调用方可注入 room（deviceStore.pair 需要 room 参数，room 来自设备信息或扫码） */
export function pickRoom(d: DeviceInfo | null): string {
  return String((d && d.room) || '');
}
