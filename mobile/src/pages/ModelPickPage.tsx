/**
 * 模型选择页（FR-114 降级版）：内置 2 个 GLB 一键切换，主界面即时生效。
 * mage-b 现为占位（mage-a 复制），待美术替换 public/models/mage-b.glb。
 */
import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useSettingsStore } from '../store/settingsStore';

const MODELS = [
  { id: 'mage-a', name: '小巫A', desc: '经典法师造型' },
  { id: 'mage-b', name: '小巫B', desc: '占位变体（待美术替换）' },
] as const;

export function ModelPickPage(): React.ReactElement {
  const nav = useNavigate();
  const { config, update } = useSettingsStore();
  const current = config?.avatarModel || 'mage-a';

  return (
    <div className="flex flex-col min-h-screen bg-[#12081f] text-white">
      <header className="flex items-center px-4 py-3 border-b border-white/10">
        <button type="button" onClick={() => nav('/settings')} className="text-sm opacity-70 mr-3">
          ←
        </button>
        <span className="font-semibold">选择形象</span>
      </header>

      <div className="grid grid-cols-2 gap-4 p-4">
        {MODELS.map((m) => (
          <button
            key={m.id}
            type="button"
            className={`rounded-2xl p-3 text-center ${
              current === m.id ? 'ring-2 ring-brand bg-white/10' : 'bg-white/5'
            }`}
            onClick={() => void update({ avatarModel: m.id })}
          >
            <div className="h-28 flex items-center justify-center text-5xl mb-2">🧙‍♀️</div>
            <p className="text-sm font-medium">{m.name}</p>
            <p className="text-xs opacity-50 mb-2">{m.desc}</p>
            <span
              className={`inline-block rounded-full px-3 py-1 text-xs ${
                current === m.id ? 'bg-brand text-white' : 'bg-white/10'
              }`}
            >
              {current === m.id ? '◉ 选用' : '选用'}
            </span>
          </button>
        ))}
      </div>

      <p className="px-4 text-xs opacity-40">（M3 支持导入自定义 .glb）</p>
    </div>
  );
}
