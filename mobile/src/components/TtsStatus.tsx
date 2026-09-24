/**
 * TTS 播报状态条（§5.2 🎵 正在播报…，可点停止）。
 */
import React from 'react';

export interface TtsStatusProps {
  speaking: boolean;
  onStop: () => void;
}

export function TtsStatus({ speaking, onStop }: TtsStatusProps): React.ReactElement | null {
  if (!speaking) return null;
  return (
    <div className="mx-3 mb-1 flex items-center justify-between rounded-lg bg-brand/20 px-3 py-1 text-xs text-white">
      <span>🎵 正在播报…</span>
      <button type="button" className="underline" onClick={onStop}>
        停止
      </button>
    </div>
  );
}
