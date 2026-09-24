/**
 * 输入条（§5.2）：按住说话 / 文字切换。断网置灰提示（Q7）。
 * FR-104：按住麦克风说话，松开发送；FR-106：键盘弹起输入条上移不遮挡。
 */
import React, { useRef, useState } from 'react';

export interface InputBarProps {
  disabled?: boolean;
  disabledTip?: string;
  onSendText: (text: string) => void;
  onVoiceStart: () => void;
  onVoiceEnd: () => void;
  recording?: boolean;
  level?: number;
}

export function InputBar({
  disabled = false,
  disabledTip = '',
  onSendText,
  onVoiceStart,
  onVoiceEnd,
  recording = false,
  level = 0,
}: InputBarProps): React.ReactElement {
  const [mode, setMode] = useState<'voice' | 'text'>('voice');
  const [text, setText] = useState('');
  const holdRef = useRef(false);

  const send = () => {
    const t = text.trim();
    if (!t || disabled) return;
    onSendText(t);
    setText('');
  };

  return (
    <div className="input-dock flex items-center gap-2 p-2 bg-[#1a1030] border-t border-white/10">
      <button
        type="button"
        aria-label="切换文字输入"
        className="text-xl px-1"
        onClick={() => setMode(mode === 'voice' ? 'text' : 'voice')}
      >
        {mode === 'voice' ? '⌨️' : '🎤'}
      </button>

      {mode === 'voice' ? (
        <button
          type="button"
          disabled={disabled}
          className={`flex-1 h-11 rounded-full text-sm font-medium ${
            recording ? 'bg-red-500 text-white' : 'bg-brand text-white'
          } ${disabled ? 'opacity-40' : ''}`}
          onTouchStart={() => {
            if (disabled) return;
            holdRef.current = true;
            onVoiceStart();
          }}
          onTouchEnd={() => {
            if (!holdRef.current) return;
            holdRef.current = false;
            onVoiceEnd();
          }}
        >
          {disabled ? disabledTip || '离线，恢复后自动补发' : recording ? `🎙 松开发送 · ${Math.round(level * 100)}%` : '按住说话'}
        </button>
      ) : (
        <>
          <input
            className="flex-1 h-11 rounded-full bg-white/10 px-4 text-sm outline-none"
            placeholder={disabled ? disabledTip || '离线，恢复后自动补发' : '说点什么…'}
            value={text}
            disabled={disabled}
            enterKeyHint="send"
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') send();
            }}
          />
          <button
            type="button"
            aria-label="发送"
            className="w-11 h-11 rounded-full bg-brand text-white"
            disabled={disabled}
            onClick={send}
          >
            ➤
          </button>
        </>
      )}
    </div>
  );
}
