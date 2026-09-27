/**
 * 会话列表页（FR-109）：时间倒序、新建、左滑删除 tombstone；FR-110 说明角标。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useSessionStore } from '../store/sessionStore';
import { useAuthStore } from '../store/authStore';
import { getDeviceId, getSyncSDK } from '../platform/runtime';
import { ConfirmDialog } from '../components/ConfirmDialog';

export function SessionListPage(): React.ReactElement {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { list, loading, load, createSession, remove, setActive } = useSessionStore();
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);
  const [swipedId, setSwipedId] = useState<string | null>(null);
  const swipeStartX = React.useRef(0);

  useEffect(() => {
    if (user) void load(user.userId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const onCreate = async () => {
    if (!user) return;
    const s = await createSession(user.userId, getDeviceId());
    // 新会话上云
    await getSyncSDK().enqueue({
      deviceId: getDeviceId(),
      entity: 'session',
      entityId: s.id,
      action: 'upsert',
      payload: { ...s } as Record<string, unknown>,
    });
    nav('/chat');
  };

  const onDelete = async () => {
    if (!pendingDelete) return;
    const id = pendingDelete;
    setPendingDelete(null);
    // tombstone：本地 deleted=1 + 云端 deleted=true（非物理删）
    await getSyncSDK().enqueue({
      deviceId: getDeviceId(),
      entity: 'session',
      entityId: id,
      action: 'delete',
      payload: { deleted: true, id },
    });
    await remove(id);
    void getSyncSDK().flush();
  };

  const fmt = (iso: string) => {
    const d = new Date(iso);
    const now = new Date();
    const sameDay = d.toDateString() === now.toDateString();
    if (sameDay) return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
    const y = new Date(now.getTime() - 86400000);
    if (d.toDateString() === y.toDateString()) return '昨天';
    return `${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
  };

  return (
    <div className="flex flex-col h-screen bg-[#12081f] text-white">
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button type="button" onClick={() => nav('/chat')} className="text-sm opacity-70">
          ← 返回
        </button>
        <span className="font-semibold">会话列表</span>
        <button type="button" onClick={() => void onCreate()} className="text-sm text-brand-light">
          ＋新建
        </button>
      </header>

      <div className="flex-1 overflow-y-auto">
        {loading ? <p className="p-4 text-sm opacity-60">加载中…</p> : null}
        {!loading && !list.length ? (
          <p className="p-4 text-sm opacity-60">暂无会话，点右上角新建</p>
        ) : null}
        {list.map((s) => (
          <div
            key={s.id}
            className="relative overflow-hidden border-b border-white/5"
            onTouchStart={(e) => {
              swipeStartX.current = e.touches[0].clientX;
              setSwipedId(null);
            }}
          >
            <div
              className="flex items-center justify-between px-4 py-3 bg-[#12081f] transition-transform"
              style={{ transform: swipedId === s.id ? 'translateX(-88px)' : 'translateX(0)' }}
              onTouchMove={(e) => {
                // 左滑露出删除：记录起点后水平位移 <-40px 判定（旧逻辑用元素左边界导致划不出来）
                const dx = e.touches[0].clientX - swipeStartX.current;
                if (dx < -40) setSwipedId(s.id);
                else if (dx > 40) setSwipedId(null);
              }}
              onClick={() => {
                setActive(s.id);
                nav('/chat');
              }}
            >
              <div>
                <p className="text-sm font-medium">{s.title || '未命名'}</p>
                <p className="text-xs opacity-50">{fmt(s.updatedAt)}</p>
              </div>
            </div>
            {swipedId === s.id ? (
              <button
                type="button"
                className="absolute right-0 top-0 bottom-0 w-[88px] bg-red-500 text-white text-sm"
                onClick={() => setPendingDelete(s.id)}
              >
                删除
              </button>
            ) : null}
          </div>
        ))}
      </div>

      {/* FR-110 多端预期管理 */}
      <p className="px-4 py-3 text-xs text-amber-300/70 border-t border-white/10">
        ℹ M1 为手机端单端上云，电脑端互通开发中
      </p>

      <ConfirmDialog
        open={!!pendingDelete}
        title="删除会话"
        message="删除后云端保留墓碑标记（tombstone），不可恢复。"
        confirmText="删除"
        danger
        onConfirm={() => void onDelete()}
        onCancel={() => setPendingDelete(null)}
      />
    </div>
  );
}
