/**
 * T05 扩展②：自定义 API 档案管理（命名档案增删改）。
 * 名称+baseUrl+model/voice + key（按档案存 Keystore，UI 只收输入不展示明文）。
 * 风格沿用设置页：rounded bg-white/10 + text-xs。
 */
import React, { useEffect, useState } from 'react';
import { useProfileStore, type ApiProfile, type ProfileKind } from '../store/profileStore';

const KIND_LABEL: Record<ProfileKind, string> = { llm: 'LLM', asr: 'ASR', tts: 'TTS' };

interface Draft {
  kind: ProfileKind;
  name: string;
  baseUrl: string;
  model: string;
  voice: string;
  key: string;
}

const EMPTY: Draft = { kind: 'llm', name: '', baseUrl: '', model: '', voice: '', key: '' };

export function ProfileManager(): React.ReactElement {
  const { profiles, loadAll, add, update, remove, saveProfileKey, hasProfileKey } = useProfileStore();
  const [editingId, setEditingId] = useState<string | null>(null); // '' = 新建
  const [draft, setDraft] = useState<Draft>(EMPTY);
  const [keySaved, setKeySaved] = useState(false);
  const [keyHasMap, setKeyHasMap] = useState<Record<string, boolean>>({});

  useEffect(() => {
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    let alive = true;
    void (async () => {
      const m: Record<string, boolean> = {};
      for (const p of profiles) m[p.id] = await hasProfileKey(p.id);
      if (alive) setKeyHasMap(m);
    })();
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [profiles]);

  const startEdit = (p: ApiProfile | null) => {
    setKeySaved(false);
    if (!p) {
      setEditingId('');
      setDraft(EMPTY);
      return;
    }
    setEditingId(p.id);
    setDraft({ kind: p.kind, name: p.name, baseUrl: p.baseUrl, model: p.model, voice: p.voice, key: '' });
  };

  const onSave = async () => {
    const name = draft.name.trim() || '未命名档案';
    const base = { name, baseUrl: draft.baseUrl.trim(), model: draft.model.trim(), voice: draft.kind === 'tts' ? draft.voice.trim() : '' };
    if (editingId === '') {
      const created = await add({ kind: draft.kind, ...base });
      if (draft.key.trim()) await saveProfileKey(created.id, draft.key.trim());
    } else if (editingId) {
      await update(editingId, base);
      if (draft.key.trim()) await saveProfileKey(editingId, draft.key.trim());
    }
    setEditingId(null);
    setDraft(EMPTY);
    setKeySaved(true);
    setTimeout(() => setKeySaved(false), 1500);
  };

  return (
    <div className="rounded-lg bg-white/5 p-3">
      <div className="flex items-center justify-between mb-2">
        <p className="text-xs opacity-70">自定义 API 档案（名称+地址+模型/音色+Key 引用）</p>
        <button type="button" className="text-xs text-brand-light" onClick={() => startEdit(null)}>
          ＋新建
        </button>
      </div>

      {profiles.length === 0 && editingId === null ? (
        <p className="text-xs opacity-50">暂无档案。新建后可在下方三区下拉切换生效。</p>
      ) : null}

      {profiles.map((p) => (
        <div key={p.id} className="flex items-center gap-2 mb-1.5 text-xs">
          <span className="px-1.5 py-0.5 rounded bg-white/10 opacity-80">{KIND_LABEL[p.kind]}</span>
          <span className="flex-1 truncate">{p.name}</span>
          <span className="opacity-50">{keyHasMap[p.id] ? '🔒' : '无key'}</span>
          <button type="button" className="text-brand-light" onClick={() => startEdit(p)}>
            编辑
          </button>
          <button
            type="button"
            className="opacity-60"
            onClick={() => {
              if (window.confirm(`删除档案「${p.name}」？其 Keystore Key 一并清除`)) void remove(p.id);
            }}
          >
            删除
          </button>
        </div>
      ))}

      {editingId !== null ? (
        <div className="mt-2 rounded bg-white/5 p-2 space-y-1.5">
          <select
            className="w-full h-8 rounded bg-white/10 px-2 text-xs"
            value={draft.kind}
            disabled={editingId !== ''} /* 已存档案不换区，避免引用错位 */
            onChange={(e) => setDraft({ ...draft, kind: e.target.value as ProfileKind })}
          >
            <option value="llm">LLM</option>
            <option value="asr">ASR</option>
            <option value="tts">TTS</option>
          </select>
          <input
            className="w-full h-8 rounded bg-white/10 px-2 text-xs outline-none"
            placeholder="档案名称（如：公司网关）"
            value={draft.name}
            onChange={(e) => setDraft({ ...draft, name: e.target.value })}
          />
          <input
            className="w-full h-8 rounded bg-white/10 px-2 text-xs outline-none"
            placeholder="baseURL"
            value={draft.baseUrl}
            onChange={(e) => setDraft({ ...draft, baseUrl: e.target.value })}
          />
          <input
            className="w-full h-8 rounded bg-white/10 px-2 text-xs outline-none"
            placeholder={draft.kind === 'asr' ? '模型（如 whisper-1）' : 'model'}
            value={draft.model}
            onChange={(e) => setDraft({ ...draft, model: e.target.value })}
          />
          {draft.kind === 'tts' ? (
            <input
              className="w-full h-8 rounded bg-white/10 px-2 text-xs outline-none"
              placeholder="音色（voice）"
              value={draft.voice}
              onChange={(e) => setDraft({ ...draft, voice: e.target.value })}
            />
          ) : null}
          <input
            className="w-full h-8 rounded bg-white/10 px-2 text-xs outline-none"
            placeholder={keyHasMap[editingId] ? 'Key 已存 Keystore🔒（留空不改）' : 'API Key（存本机 Keystore）'}
            type="password"
            value={draft.key}
            onChange={(e) => setDraft({ ...draft, key: e.target.value })}
          />
          <div className="flex gap-2 justify-end">
            <button type="button" className="text-xs opacity-60" onClick={() => setEditingId(null)}>
              取消
            </button>
            <button type="button" className="text-xs text-brand-light" onClick={() => void onSave()}>
              {keySaved ? '✓' : '保存'}
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
