/**
 * T07 形象库页（FR-304/310）：导入（文件选择→校验→进度→预览→设为当前）、
 * 参数条（scale/offsetY/clipMap 入口）、删除当前自动回退默认。
 * T08 四形态 Tab：3D 模型 / 2D 立绘 / Live2D / 视频（按 form 分组，导入 accept 随 Tab 切换）。
 * Q10：Live2D 仅用户自备授权模型 + 免责明示。
 */
import React, { useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAvatarStore } from '../store/avatarStore';
import { useSettingsStore } from '../store/settingsStore';
import { MAX_SIZE } from '../avatar/avatar-validator';
import type { AvatarForm, AvatarSpec } from '@xw/shared';

/** 四形态 Tab 定义（T08） */
type FormTab = { form: AvatarForm; label: string; accept: string };

const FORM_TABS: FormTab[] = [
  { form: '3d', label: '3D 模型', accept: '.glb,.gltf,.fbx,.vrm' },
  { form: '2d', label: '2D 立绘', accept: '.png' },
  { form: 'live2d', label: 'Live2D', accept: '.png' },
  { form: 'video', label: '视频', accept: '.webm' },
];

export function AvatarLibraryPage(): React.ReactElement {
  const nav = useNavigate();
  const { list, importError, importing, importAvatar, apply, remove, clearError, resolve } = useAvatarStore();
  const config = useSettingsStore((s) => s.config);
  const update = useSettingsStore((s) => s.update);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [preview, setPreview] = useState<AvatarSpec | null>(null);
  const [msg, setMsg] = useState('');
  const [tab, setTab] = useState<AvatarForm>('3d');

  const currentHash = config?.avatarSpec?.hash || '';
  const activeSpec = config?.avatarSpec || null;
  const activeTab = FORM_TABS.find((t) => t.form === tab) ?? FORM_TABS[0];
  /** 当前 Tab 分组下的自定义形象列表 */
  const tabList = list.filter((r) => r.spec.form === tab);

  const onPickFile = async (f: File | null): Promise<void> => {
    if (!f) return;
    setMsg('');
    clearError();
    const spec = await importAvatar(f);
    if (spec) {
      const resolved = await resolve(spec);
      setPreview({ ...spec, uri: resolved.uri });
      setMsg('✅ 导入成功，预览确认后点「设为当前」');
    }
    // 失败文案 importError 三态已给出（格式不支持/文件损坏/超限）
  };

  const onApply = async (spec: AvatarSpec): Promise<void> => {
    await apply(spec);
    setMsg('✅ 已设为当前形象（跨端按元数据近似映射，FR-308/Q14）');
    setPreview(null);
  };

  const onParams = (spec: AvatarSpec, patch: Partial<AvatarSpec>): void => {
    const next = { ...spec, ...patch };
    // 参数即时写回 config（scale/offsetY 供 Q15 骨架兜底；clipMap 动作映射可手改）
    void update({ avatarSpec: next });
  };

  const card = (spec: AvatarSpec, createdAt: string) => (
    <div key={spec.hash} className="rounded-lg bg-white/5 p-3 mb-2">
      <div className="flex items-center justify-between mb-1">
        <span className="text-sm font-medium truncate">{spec.name || spec.hash}</span>
        {spec.hash === currentHash ? (
          <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/80">使用中</span>
        ) : (
          <span className="text-[10px] opacity-50">
            {spec.form}/{spec.kind}
          </span>
        )}
      </div>
      <p className="text-[10px] opacity-50 mb-1.5">
        {spec.hash} · {new Date(createdAt).toLocaleDateString()} ·{' '}
        {spec.kind in MAX_SIZE ? `上限 ${Math.round(MAX_SIZE[spec.kind] / 1024 / 1024)}MB` : ''}
      </p>
      <div className="flex gap-2 mb-1.5">
        <button type="button" className="text-xs text-brand-light" onClick={() => void onApply(spec)}>
          设为当前
        </button>
        <button
          type="button"
          className="text-xs opacity-60"
          onClick={() => {
            if (window.confirm(`删除「${spec.name || spec.hash}」？当前使用中将自动回退默认形象`)) {
              void remove(spec.hash);
            }
          }}
        >
          删除
        </button>
      </div>
      {/* 参数条（Q15：scale/offsetY 兜底动效参数；clipMap 动作映射） */}
      {spec.hash === currentHash ? (
        <div className="space-y-1 pt-1 border-t border-white/10">
          <label className="flex items-center gap-2 text-[10px] opacity-70">
            缩放 {(activeSpec?.scale ?? 1).toFixed(2)}
            <input
              type="range"
              min={0.55}
              max={1.8}
              step={0.05}
              value={activeSpec?.scale ?? 1}
              onChange={(e) => onParams(spec, { scale: Number(e.target.value) })}
              className="flex-1"
            />
          </label>
          <label className="flex items-center gap-2 text-[10px] opacity-70">
            高度微调 {(activeSpec?.offsetY ?? 0).toFixed(2)}
            <input
              type="range"
              min={-1}
              max={1}
              step={0.05}
              value={activeSpec?.offsetY ?? 0}
              onChange={(e) => onParams(spec, { offsetY: Number(e.target.value) })}
              className="flex-1"
            />
          </label>
          <input
            className="w-full h-7 rounded bg-white/10 px-2 text-[10px] outline-none"
            placeholder='clipMap JSON（如 {"idle":"Standing"}）'
            defaultValue={spec.clipMap ? JSON.stringify(spec.clipMap) : ''}
            onBlur={(e) => {
              const raw = e.target.value.trim();
              if (!raw) return onParams(spec, { clipMap: undefined });
              try {
                const m = JSON.parse(raw) as Record<string, string>;
                onParams(spec, { clipMap: m });
                setMsg('✅ 动作映射已更新');
              } catch {
                setMsg('❌ clipMap 需为 JSON 对象（如 {"idle":"Standing"}）');
              }
            }}
          />
        </div>
      ) : null}
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#12081f] text-white">
      <header className="flex items-center px-4 py-3 border-b border-white/10">
        <button type="button" onClick={() => nav('/settings')} className="text-sm opacity-70 mr-3">
          ←
        </button>
        <span className="font-semibold">形象库</span>
      </header>

      <div className="p-4 text-sm">
        {/* T08 四形态 Tab */}
        <div className="flex gap-1 mb-3 rounded-lg bg-white/5 p-1">
          {FORM_TABS.map((t) => (
            <button
              key={t.form}
              type="button"
              onClick={() => setTab(t.form)}
              className={`flex-1 rounded py-1.5 text-xs ${
                tab === t.form ? 'bg-brand/80 font-medium' : 'opacity-60'
              }`}
            >
              {t.label}
            </button>
          ))}
        </div>

        {/* Q10 Live2D 免责明示 */}
        {tab === 'live2d' ? (
          <p className="text-[10px] text-amber-200/80 mb-2 leading-relaxed">
            ⚠ Live2D 仅支持用户自备的、已获 Live2D 准会员/商用授权的模型。请自行确认模型授权范围，
            因模型授权纠纷产生的后果由使用者自行承担。导入 PNG 为立绘占位，完整 .moc3 模型请放置应用
            模型目录。
          </p>
        ) : null}

        <button
          type="button"
          className="w-full rounded-lg bg-white/10 px-3 py-3 mb-2 text-sm text-left"
          onClick={() => fileRef.current?.click()}
          disabled={importing}
        >
          {importing ? '⏳ 导入中…' : `＋ 导入${activeTab.label}形象`}
        </button>
        <input
          ref={fileRef}
          key={tab}
          type="file"
          accept={activeTab.accept}
          className="hidden"
          onChange={(e) => void onPickFile(e.target.files?.[0] || null)}
        />
        <p className="text-[10px] opacity-50 mb-2">
          上限：GLB/GLTF 15MB · FBX 20MB（仅首 clip）· VRM 30MB · PNG 5MB · WebM 50MB/30s
        </p>

        {/* 预览确认（FR-304 流程：选文件→校验→进度→预览确认→应用） */}
        {preview ? (
          <div className="rounded-lg bg-white/10 p-3 mb-3">
            <p className="text-sm mb-1">预览：{preview.name}</p>
            <p className="text-[10px] opacity-60 mb-2">
              {preview.form} / {preview.kind} / {preview.hash}
            </p>
            <div className="flex gap-2">
              <button type="button" className="text-xs text-brand-light" onClick={() => void onApply(preview)}>
                ✓ 设为当前
              </button>
              <button type="button" className="text-xs opacity-60" onClick={() => setPreview(null)}>
                取消
              </button>
            </div>
          </div>
        ) : null}

        {importError ? <p className="text-xs text-red-300 mb-2">✗ {importError}</p> : null}
        {msg ? <p className="text-xs mb-2">{msg}</p> : null}

        {/* 内置默认（无 avatarSpec 时的回落） */}
        <div className="rounded-lg bg-white/5 p-3 mb-2 flex items-center justify-between">
          <span className="text-sm">
            内置：{config?.avatarModel === 'mage-b' ? '小巫B' : '小巫A'}
            {!activeSpec ? <span className="text-[10px] px-1.5 py-0.5 rounded bg-brand/80 ml-2">使用中</span> : null}
          </span>
          {activeSpec ? (
            <button
              type="button"
              className="text-xs text-brand-light"
              onClick={() => void update({ avatarSpec: null }).then(() => setMsg('已回退默认形象'))}
            >
              回退默认
            </button>
          ) : null}
        </div>

        {tabList.length ? (
          tabList.map((r) => card(r.spec, r.createdAt))
        ) : (
          <p className="text-xs opacity-50">「{activeTab.label}」暂无自定义形象。导入后可预览、调参并设为当前。</p>
        )}
      </div>
    </div>
  );
}
