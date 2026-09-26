/**
 * remoteStore — 遥控会话状态（T04）
 * 步骤进度 / 截图/文件卡片 / 确认队列 / 抢占提示 / 流式 delta。
 * cmd-router 分发回流后调用本 store 动作渲染（ChatPage/ConfirmDialog 消费）。
 */
import { create } from 'zustand';
import type { TrajectoryStep } from '@xw/shared';

export interface RemoteFileCard {
  name: string;
  size: number;
  mime: string;
  url?: string;
  b64?: string;
}

export interface PendingConfirm {
  confirmReqId: string;
  action: string;
  detail: string;
  timeoutSec: number;
}

export interface RemoteState {
  /** 是否处于远程模式（连接电脑） */
  remoteMode: boolean;
  /** 流式增量文本（拼接后展示） */
  streamingText: string;
  /** 最终回复文本 */
  replyText: string;
  /** 任务步骤进度（P0 仅收集，P1 渲染进度条） */
  steps: TrajectoryStep[];
  /** 截图卡片（最新一张） */
  screenshotB64: string;
  /** 文件卡片列表 */
  files: RemoteFileCard[];
  /** 待确认队列（ConfirmDialog 消费） */
  confirms: PendingConfirm[];
  /** 抢占提示 */
  preemptedMsg: string;
  /** ASR 回显（voice 命令识别文本） */
  asrText: string;
  setRemoteMode: (on: boolean) => void;
  appendDelta: (text: string) => void;
  setReply: (text: string, asrText?: string) => void;
  pushStep: (step: TrajectoryStep) => void;
  setScreenshot: (b64: string) => void;
  pushFile: (f: RemoteFileCard) => void;
  pushConfirm: (c: PendingConfirm) => void;
  removeConfirm: (confirmReqId: string) => void;
  setPreempted: (msg: string) => void;
  clearTurn: () => void;
  reset: () => void;
}

const turnReset = {
  streamingText: '',
  replyText: '',
  steps: [] as TrajectoryStep[],
  screenshotB64: '',
  files: [] as RemoteFileCard[],
  asrText: '',
};

const initialState = {
  remoteMode: false,
  ...turnReset,
  confirms: [] as PendingConfirm[],
  preemptedMsg: '',
};

export const useRemoteStore = create<RemoteState>((set) => ({
  ...initialState,

  setRemoteMode: (on) => set({ remoteMode: !!on, ...(on ? {} : turnReset) }),

  appendDelta: (text) =>
    set((s) => ({ streamingText: s.streamingText + String(text || '') })),

  setReply: (text, asrText) =>
    set(() => ({
      replyText: String(text || ''),
      ...(asrText !== undefined ? { asrText: String(asrText || '') } : {}),
    })),

  pushStep: (step) => set((s) => ({ steps: [...s.steps, step] })),

  setScreenshot: (b64) => set({ screenshotB64: String(b64 || '') }),

  pushFile: (f) => set((s) => ({ files: [...s.files, f] })),

  pushConfirm: (c) => set((s) => ({ confirms: [...s.confirms.filter((x) => x.confirmReqId !== c.confirmReqId), c] })),

  removeConfirm: (confirmReqId) =>
    set((s) => ({ confirms: s.confirms.filter((x) => x.confirmReqId !== confirmReqId) })),

  setPreempted: (msg) => set({ preemptedMsg: String(msg || '') }),

  /** 单轮结束（reply 回流后）：清流式/步骤/卡片，保留 remoteMode/confirms */
  clearTurn: () => set({ ...turnReset }),

  reset: () => set({ ...initialState }),
}));
