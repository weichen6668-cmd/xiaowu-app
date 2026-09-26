/**
 * T08 形象快捷切换面板（FR-312）：四形态 + 形象库条目一键切换。
 * 入口：悬浮球点开的迷你对话窗顶部按钮 / 主端形象库页右上角。
 * 切换即写 settingsStore.avatarSpec（LWW user_config op 由 store 侧 enqueue，
 * 资源本体不同步，跨端走 Q14 近似映射）。
 * Q10：Live2D 免责明示（切换到 live2d 形态时提示授权自负）。
 */
import React, { useEffect, useState } from 'react';
import { useAvatarStore } from '../store/avatarStore';
import { useSettingsStore } from '../store/settingsStore';
import type { AvatarForm, AvatarSpec } from '@xw/shared';

type Props = {
  /** 面板开合（受控，父层按钮 toggle） */
  open: boolean;
  /** 关闭回调 */
  onClose: () => void;
  /** 紧凑模式（悬浮迷你窗内嵌，减小占位） */
  compact?: boolean;
};

/** 形态快捷键（内置默认 + 已导入条目按 form 分组） */
const FORMS: { form: AvatarForm; label: string }[] = [
  { form: '3d', label: '3D' },
  { form: '2d', label: '立绘' },
  { form: 'live2d', label: 'Live2D' },
  { form: 'video', label: '视频' },
];

/**
 * 快捷切换面板。未导入条目时给出「去导入」跳转提示。
 */
export function AvatarQuickPanel({ open, onClose, compact = false }: Props): React.ReactElement | null {
  const { list, apply } = useAvatarStore();
  const config = useSettingsStore((s) => s.config);
  const update = useSettingsStore((s) => s.update);
  const [tab, setTab] = useState<AvatarForm>('3d');
  const [msg, setMsg] = useState('');
  const [live2dAck, setLive2dAck] = useState(false);

  const currentHash = config?.avatarSpec?.hash || '';

  useEffect(() => {
    if (open) setMsg('');
  }, [open]);

  if (!open) return null;

  const tabList = list.filter((r) => r.spec.form === tab);

  /** 形态切换：优先已导入该形态条目（取最近一条），否则回退内置默认 3d */
  const onSwitchForm = async (form: AvatarForm): Promise<void> => {
    setTab(form);
    if (form === 'live2d' && !live2dAck) {
      setMsg('⚠ Live2D 需用户自备已获授权模型，授权责任自负。再次点击确认切换。');
      setLive2dAck(true);
      return;
    }
    const first = list.find((r) => r.spec.form === form);
    if (first) {
      await apply(first.spec);
      setMsg(`✅ 已切换：${first.spec.name || first.spec.hash}`);
    } else if (form === '3d') {
      await update({ avatarSpec: null });
      setMsg('✅ 已切换：内置 3D 形象');
    } else {
      setMsg(`✗ 尚无${FORMS.find((f) => f.form === form)?.label ?? form}形象，请先在形象库导入`);
    }
    onClose();
  };

  /** 条目切换（同形态/跨形态皆可，spec.form 随条目） */
  const onPick = async (spec: AvatarSpec): Promise<void> => {
    await apply(spec);
    setMsg(`✅ 已切换：${spec.name || spec.hash}`);
    onClose();
  };

  /** 内置默认切换（avatarSpec=null 走内置 GLB，不经 idb 解析） */
  const onPickBuiltin = async (): Promise<void> => {
    await update({ avatarSpec: null });
    setMsg('✅ 已切换：内置 3D 形象');
    onClose();
  };

  const itemBtn = (spec: AvatarSpec, name: string, onClick: () => void, active: boolean) => (
    <button
      key={spec.hash}
      type="button"
      onClick={onClick}
      className={`w-full text-left rounded px-2 py-1.5 text-xs truncate ${
        active ? 'bg-brand/70' : 'bg-white/5'
      }`}
      title={name}
    >
      {active ? '✓ ' : ''}
      {name}
    </button>
  );

  return (
    <div
      data-testid="avatar-quick-panel"
      className={`rounded-xl bg-[#1c1030]/95 border border-white/10 shadow-lg ${
        compact ? 'p-2 w-48' : 'p-3 w-64'
      }`}
    >
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold">切换形象</span>
        <button type="button" onClick={onClose} className="text-xs opacity-60 px-1" aria-label="关闭">
          ✕
        </button>
      </div>

      {/* 四形态快捷键 */}
      <div className="flex gap-1 mb-2">
        {FORMS.map((f) => (
          <button
            key={f.form}
            type="button"
            onClick={() => void onSwitchForm(f.form)}
            className={`flex-1 rounded py-1 text-[10px] ${
              tab === f.form ? 'bg-brand/80' : 'bg-white/5 opacity-70'
            }`}
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* 当前形态已导入条目 */}
      <div className={`space-y-1 ${compact ? 'max-h-28' : 'max-h-48'} overflow-y-auto`}>
        {tab === '3d'
          ? itemBtn(builtinSpec(), '内置默认（小巫）', () => void onPickBuiltin(), !currentHash || currentHash === 'builtin')
          : null}
        {tabList.length ? (
          tabList.map((r) =>
            itemBtn(r.spec, r.spec.name || r.spec.hash, () => void onPick(r.spec), r.spec.hash === currentHash),
          )
        ) : tab !== '3d' ? (
          <p className="text-[10px] opacity-50 px-1">暂无该形态形象，可在形象库导入</p>
        ) : null}
      </div>

      {msg ? <p className="text-[10px] mt-1.5 leading-snug">{msg}</p> : null}
    </div>
  );
}

/** 解析内置条目的 spec（quick panel「内置默认」项）——供外部复用 */
export function builtinSpec(): AvatarSpec {
  return { form: '3d', kind: 'glb', uri: '', hash: 'builtin', scale: 1, offsetY: 0 };
}

export default AvatarQuickPanel;
