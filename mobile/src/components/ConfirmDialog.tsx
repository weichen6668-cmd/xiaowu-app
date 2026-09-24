/**
 * 通用确认对话框（删除会话/退出登录等）。
 */
import React from 'react';

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
