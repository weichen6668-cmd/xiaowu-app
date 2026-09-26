/**
 * 通用确认对话框（删除会话/退出登录等）+ T05 危险操作远程确认宿主。
 * RemoteConfirmHost：消费 remoteStore.confirms 队列 → ConfirmDialog（标题=动作、详情=命令摘要脱敏）
 * → 同意/拒绝回流 remoteSdk.send('confirm_result', {confirmReqId, approved})。
 * 30s 超时由电脑端兜底拒绝（本组件仅负责即时回流）。
 */
import React from 'react';
import { useRemoteStore } from '../store/remoteStore';
import { remoteSdk } from '../remote/remote-sdk';

export interface ConfirmDialogProps {
  open: boolean;
  title: string;
  message: string;
  confirmText?: string;
  cancelText?: string;
  danger?: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}

export function ConfirmDialog({
  open,
  title,
  message,
  confirmText = '确定',
  cancelText = '取消',
  danger = false,
  onConfirm,
  onCancel,
}: ConfirmDialogProps): React.ReactElement | null {
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60" data-testid="confirm-dialog">
      <div className="w-[80%] max-w-sm rounded-2xl bg-[#241540] p-4 text-white">
        <h3 className="text-base font-semibold mb-2">{title}</h3>
        <p className="text-sm opacity-80 mb-4">{message}</p>
        <div className="flex justify-end gap-3">
          <button type="button" className="px-4 py-2 text-sm opacity-70" onClick={onCancel}>
            {cancelText}
          </button>
          <button
            type="button"
            className={`px-4 py-2 text-sm rounded-lg ${danger ? 'bg-red-500' : 'bg-brand'}`}
            onClick={onConfirm}
          >
            {confirmText}
          </button>
        </div>
      </div>
    </div>
  );
}

/**
 * 危险操作远程确认宿主（挂载于 ChatPage 根部）。
 * 取 remoteStore.confirms 队首渲染确认框；结果回流电脑端。
 */
export function RemoteConfirmHost(): React.ReactElement | null {
  const confirms = useRemoteStore((s) => s.confirms);
  const removeConfirm = useRemoteStore((s) => s.removeConfirm);
  const cur = confirms.length ? confirms[0] : null;
  if (!cur) return null;

  const settle = (approved: boolean) => {
    void remoteSdk.send('confirm_result', { confirmReqId: cur.confirmReqId, approved });
    removeConfirm(cur.confirmReqId);
  };

  return (
    <ConfirmDialog
      open
      danger
      title={`危险操作确认：${cur.action}`}
      message={`${cur.detail}\n\n来自远程电脑的请求，${cur.timeoutSec} 秒内未确认将自动拒绝。允许执行吗？`}
      confirmText="同意执行"
      cancelText="拒绝"
      onConfirm={() => settle(true)}
      onCancel={() => settle(false)}
    />
  );
}
