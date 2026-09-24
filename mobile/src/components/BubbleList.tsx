/**
 * 气泡流（§5.2 对话流）：用户/助手气泡，skillHint 小图标，长按复制。
 */
import React from 'react';
import type { Message } from '@xw/shared';

export interface BubbleListProps {
  messages: Message[];
  streamingText?: string;
}

export function BubbleList({ messages, streamingText }: BubbleListProps): React.ReactElement {
  const onLongPress = (text: string) => {
    if (navigator.clipboard) void navigator.clipboard.writeText(text);
  };

  return (
    <div className="flex flex-col gap-2 p-3 overflow-y-auto flex-1" data-testid="bubble-list">
      {messages.map((m) => (
        <div
          key={m.id}
          className={`max-w-[80%] rounded-2xl px-3 py-2 text-sm leading-relaxed ${
            m.role === 'user'
              ? 'self-end bg-brand-dark text-white'
              : 'self-start bg-white/10 text-white'
          }`}
          onContextMenu={(e) => {
            e.preventDefault();
            onLongPress(m.content);
          }}
        >
          {m.content}
          {m.skillHint ? (
            <span className="ml-1 text-xs opacity-70">🎭 {m.skillHint}</span>
          ) : null}
        </div>
      ))}
      {streamingText ? (
        <div className="self-start max-w-[80%] rounded-2xl px-3 py-2 bg-white/10 text-white text-sm animate-pulse">
          {streamingText}
        </div>
      ) : null}
    </div>
  );
}
