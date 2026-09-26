/**
 * 对话流状态（FR-104/106）：消息气泡、发送中、TTS 播报状态、打断。
 */
import { create } from 'zustand';
import type { ApiResult, ChatOrchestrator, Message, Reply } from '@xw/shared';
import { fail, XW_ERR } from '@xw/shared';
import { MessageRepo } from '../db/repo';

interface ChatState {
  messages: Message[];
  sending: boolean;
  speaking: boolean;
  streamingText: string;
  /** 最近一次失败的用户可见提示（空串=无错误） */
  error: string;
  load(sessionId: string): Promise<void>;
  send(orch: ChatOrchestrator, text: string, sessionId: string): Promise<ApiResult<Reply>>;
  sendVoice(orch: ChatOrchestrator, wav: Uint8Array, sessionId: string): Promise<ApiResult<Reply>>;
  setSpeaking(on: boolean): void;
  appendStream(delta: string): void;
  clearStream(): void;
  clearError(): void;
  interrupt(orch: ChatOrchestrator): void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sending: false,
  speaking: false,
  streamingText: '',
  error: '',

  async load(sessionId: string): Promise<void> {
    const messages = await MessageRepo.listBySession(sessionId);
    set({ messages, streamingText: '', error: '' });
  },

  async send(orch, text, sessionId) {
    set({ sending: true, streamingText: '', error: '' });
    try {
      const r = await orch.sendText(text, sessionId);
      if (r.ok) {
        set({ messages: [...get().messages, r.data.userMsg, r.data.assistantMsg] });
      } else {
        // 根因修复：失败必须上屏，禁止静默吞错
        set({ error: r.msg || '发送失败，请重试' });
      }
      return r;
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 120) || '发送失败，请重试';
      set({ error: msg });
      return fail<Reply>(XW_ERR.UNKNOWN, msg);
    } finally {
      // 状态保险：异常也必复位
      set({ sending: false, streamingText: '' });
    }
  },

  async sendVoice(orch, wav, sessionId) {
    set({ sending: true, streamingText: '', error: '' });
    try {
      const r = await orch.sendVoice(wav, sessionId);
      if (r.ok) {
        set({ messages: [...get().messages, r.data.userMsg, r.data.assistantMsg] });
      } else {
        set({ error: r.msg || '发送失败，请重试' });
      }
      return r;
    } catch (e) {
      const msg = (e as Error).message?.slice(0, 120) || '发送失败，请重试';
      set({ error: msg });
      return fail<Reply>(XW_ERR.UNKNOWN, msg);
    } finally {
      set({ sending: false, streamingText: '' });
    }
  },

  setSpeaking(on: boolean): void {
    set({ speaking: on });
  },

  appendStream(delta: string): void {
    set({ streamingText: get().streamingText + delta });
  },

  clearStream(): void {
    set({ streamingText: '' });
  },

  clearError(): void {
    set({ error: '' });
  },

  interrupt(orch): void {
    orch.interrupt();
    set({ speaking: false, sending: false });
  },
}));
