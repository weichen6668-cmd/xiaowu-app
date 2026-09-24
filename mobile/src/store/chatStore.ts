/**
 * 对话流状态（FR-104/106）：消息气泡、发送中、TTS 播报状态、打断。
 */
import { create } from 'zustand';
import type { ApiResult, ChatOrchestrator, Message, Reply } from '@xw/shared';
import { MessageRepo } from '../db/repo';

interface ChatState {
  messages: Message[];
  sending: boolean;
  speaking: boolean;
  streamingText: string;
  load(sessionId: string): Promise<void>;
  send(orch: ChatOrchestrator, text: string, sessionId: string): Promise<ApiResult<Reply>>;
  sendVoice(orch: ChatOrchestrator, wav: Uint8Array, sessionId: string): Promise<ApiResult<Reply>>;
  setSpeaking(on: boolean): void;
  appendStream(delta: string): void;
  clearStream(): void;
  interrupt(orch: ChatOrchestrator): void;
}

export const useChatStore = create<ChatState>((set, get) => ({
  messages: [],
  sending: false,
  speaking: false,
  streamingText: '',

  async load(sessionId: string): Promise<void> {
    const messages = await MessageRepo.listBySession(sessionId);
    set({ messages, streamingText: '' });
  },

  async send(orch, text, sessionId) {
    set({ sending: true, streamingText: '' });
    const r = await orch.sendText(text, sessionId);
    set({ sending: false, streamingText: '' });
    if (r.ok) {
      set({ messages: [...get().messages, r.data.userMsg, r.data.assistantMsg] });
    }
    return r;
  },

  async sendVoice(orch, wav, sessionId) {
    set({ sending: true, streamingText: '' });
    const r = await orch.sendVoice(wav, sessionId);
    set({ sending: false, streamingText: '' });
    if (r.ok) {
      set({ messages: [...get().messages, r.data.userMsg, r.data.assistantMsg] });
    }
    return r;
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

  interrupt(orch): void {
    orch.interrupt();
    set({ speaking: false, sending: false });
  },
}));
