/**
 * 录音波形（FR-104 实时反馈）：按 level 画竖条。
 */
import React from 'react';

export interface WaveformProps {
  level: number;
  active: boolean;
}

export function Waveform({ level, active }: WaveformProps): React.ReactElement | null {
  if (!active) return null;
  const bars = 16;
  return (
    <div className="flex items-end justify-center gap-[2px] h-8 px-2" data-testid="waveform">
      {Array.from({ length: bars }).map((_, i) => {
        const h = 4 + Math.abs(Math.sin(i * 1.7)) * level * 28;
        return (
          <div
            key={i}
            className="w-[3px] rounded bg-cyan-300"
            style={{ height: `${Math.max(3, h)}px` }}
          />
        );
      })}
    </div>
  );
}
