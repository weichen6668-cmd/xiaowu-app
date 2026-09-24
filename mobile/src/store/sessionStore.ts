/**
 * 会话列表状态（FR-109）：倒序、新建、左滑删除 tombstone。
 */
import { create } from 'zustand';
import type { Session } from '@xw/shared';
import { SessionRepo } from '../db/repo';

interface SessionState {
  list: Session[];
  activeId: string | null;
  loading: boolean;
  load(userId: string): Promise<void>;
  createSession(userId: string, deviceId: string, title?: string): Promise<Session>;
  setActive(id: string | null): void;
  remove(id: string): Promise<void>;
  touch(id: string, title: string): Promise<void>;
}

export const useSessionStore = create<SessionState>((set, get) => ({
  list: [],
  activeId: null,
  loading: false,

  async load(userId: string): Promise<void> {
    set({ loading: true });
    const list = await SessionRepo.list(userId);
    const activeId = get().activeId && list.some((s) => s.id === get().activeId)
      ? get().activeId
      : list.length
        ? list[0].id
        : null;
    set({ list, activeId, loading: false });
  },

  async createSession(userId: string, deviceId: string, title = '新会话'): Promise<Session> {
    const s = await SessionRepo.create(userId, deviceId, title);
    set({ list: [s, ...get().list], activeId: s.id });
    return s;
  },

  setActive(id: string | null): void {
    set({ activeId: id });
  },

  /** tombstone：本地 deleted=1，sync 层上云同为 deleted=true（FR-109 非物理删） */
  async remove(id: string): Promise<void> {
    await SessionRepo.softDelete(id);
    const list = get().list.filter((s) => s.id !== id);
    const activeId = get().activeId === id ? (list[0]?.id ?? null) : get().activeId;
    set({ list, activeId });
  },

  async touch(id: string, title: string): Promise<void> {
    await SessionRepo.touch(id, title);
    set({
      list: get().list.map((s) =>
        s.id === id ? { ...s, title, updatedAt: new Date().toISOString() } : s,
      ),
    });
  },
}));
