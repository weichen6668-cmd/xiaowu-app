/**
 * RemoteConfigPage — 电脑配置遥控（补全 T07）
 * get_config 拉取 → 编辑 → save_config 回写；set_active_model/set_asr_active/set_tts_active 快捷切换。
 * 红线：apiKey/token 显示为脱敏 ****；保存时 **** 原样回传即保留电脑端原值（桌面 pick 逻辑不动脱敏字段）。
 * remote.pairCode 只回 room（配对码仅存电脑端），本页不可见。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  getRemoteConfig,
  saveRemoteConfig,
  setActiveModel,
  setAsrActive,
  setTtsActive,
} from '../remote/remote-api';

interface ModelRow {
  label?: string;
  provider?: string;
  baseURL?: string;
  model?: string;
  apiKey?: string;
  token?: string;
  voice?: string;
}

interface PcConfig {
  llm?: { activeModel?: string; models?: ModelRow[]; systemPrompt?: string };
  asr?: { active?: string; models?: ModelRow[] };
  tts?: { active?: string; models?: ModelRow[] };
  remote?: { room?: string };
}

export function RemoteConfigPage(): React.ReactElement {
  const nav = useNavigate();
  const [cfg, setCfg] = useState<PcConfig | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  const [promptDraft, setPromptDraft] = useState('');

  const loadCfg = async () => {
    setBusy(true);
    setMsg('');
    const r = await getRemoteConfig();
    if (r.ok && r.data.config) {
      const c = r.data.config as PcConfig;
      setCfg(c);
      setPromptDraft(c.llm?.systemPrompt || '');
      setMsg('✓ 已读取电脑配置');
    } else setMsg('❌ ' + (r.reason || '读取失败：请确认已连接电脑'));
    setBusy(false);
  };

  useEffect(() => {
    void loadCfg();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const patchModels = (section: 'llm' | 'asr' | 'tts', idx: number, field: keyof ModelRow, value: string) => {
    if (!cfg) return;
    const next: PcConfig = JSON.parse(JSON.stringify(cfg));
    const arr = (next[section] && next[section]!.models) || [];
    if (arr[idx]) arr[idx][field] = value;
    setCfg(next);
  };

  const doSave = async () => {
    if (!cfg) return;
    setBusy(true);
    setMsg('');
    const payload: PcConfig = {
      llm: { ...(cfg.llm || {}), systemPrompt: promptDraft },
      asr: cfg.asr || {},
      tts: cfg.tts || {},
    };
    const r = await saveRemoteConfig(payload);
    setMsg(r.ok ? '✓ 已保存到电脑' : '❌ ' + (r.reason || '保存失败'));
    setBusy(false);
    if (r.ok) void loadCfg();
  };

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <button style={s.back} onClick={() => nav(-1)}>←</button>
        <div style={s.topTitle}>电脑配置遥控</div>
        <button style={s.refresh} disabled={busy} onClick={() => void loadCfg()}>刷新</button>
      </div>
      {msg ? <div style={s.msg}>{msg}</div> : null}

      {!cfg ? (
        <div style={s.empty}>{busy ? '读取中…' : '未读取到配置（需先连接电脑）'}</div>
      ) : (
        <>
          {/* LLM 模型切换 + 编辑 */}
          <div style={s.section}>
            LLM 当前：{cfg.llm?.activeModel || '未设置'}（房间 {cfg.remote?.room || '—'}）
          </div>
          {(cfg.llm?.models || []).map((m, i) => (
            <div key={`llm-${i}`} style={s.card}>
              <div style={s.cardTitle}>
                {m.label || m.model || `模型${i + 1}`}
                {cfg.llm?.activeModel === m.model ? <span style={s.activeTag}>当前</span> : null}
              </div>
              <div style={s.rowLine}>
                <input style={s.input} value={m.model || ''} placeholder="model" onChange={(e) => patchModels('llm', i, 'model', e.target.value)} />
                <input style={s.input} value={m.baseURL || ''} placeholder="baseURL" onChange={(e) => patchModels('llm', i, 'baseURL', e.target.value)} />
              </div>
              <div style={s.rowLine}>
                <input
                  style={s.input}
                  value={m.apiKey || ''}
                  placeholder="apiKey（**** 为脱敏，不动=保留原值）"
                  onChange={(e) => patchModels('llm', i, 'apiKey', e.target.value)}
                />
                <button
                  style={s.actBtn}
                  disabled={busy}
                  onClick={() => void (async () => {
                    setBusy(true);
                    const r = await setActiveModel(m.model || '');
                    setMsg(r.ok ? `✓ 已切换到 ${m.model}` : '❌ ' + (r.reason || '切换失败'));
                    setBusy(false);
                  })}
                >
                  切换
                </button>
              </div>
            </div>
          ))}

          {/* ASR 切换 */}
          <div style={s.section}>语音识别（当前：{cfg.asr?.active || '未设置'}）</div>
          {(cfg.asr?.models || []).map((m, i) => (
            <div key={`asr-${i}`} style={s.card}>
              <div style={s.cardTitle}>
                {m.provider || m.model}
                {cfg.asr?.active === m.provider ? <span style={s.activeTag}>当前</span> : null}
              </div>
              <div style={s.rowLine}>
                <input style={s.input} value={m.baseURL || ''} placeholder="baseURL" onChange={(e) => patchModels('asr', i, 'baseURL', e.target.value)} />
                <button
                  style={s.actBtn}
                  disabled={busy}
                  onClick={() => void (async () => {
                    setBusy(true);
                    const r = await setAsrActive(m.provider || '');
                    setMsg(r.ok ? `✓ ASR 已切换 ${m.provider}` : '❌ ' + (r.reason || '切换失败'));
                    setBusy(false);
                  })}
                >
                  切换
                </button>
              </div>
            </div>
          ))}

          {/* TTS 切换 */}
          <div style={s.section}>语音合成（当前：{cfg.tts?.active || '未设置'}）</div>
          {(cfg.tts?.models || []).map((m, i) => (
            <div key={`tts-${i}`} style={s.card}>
              <div style={s.cardTitle}>
                {m.provider || m.model}
                {cfg.tts?.active === m.provider ? <span style={s.activeTag}>当前</span> : null}
              </div>
              <div style={s.rowLine}>
                <input style={s.input} value={m.baseURL || ''} placeholder="baseURL" onChange={(e) => patchModels('tts', i, 'baseURL', e.target.value)} />
                <button
                  style={s.actBtn}
                  disabled={busy}
                  onClick={() => void (async () => {
                    setBusy(true);
                    const r = await setTtsActive(m.provider || '');
                    setMsg(r.ok ? `✓ TTS 已切换 ${m.provider}` : '❌ ' + (r.reason || '切换失败'));
                    setBusy(false);
                  })}
                >
                  切换
                </button>
              </div>
            </div>
          ))}

          {/* 系统提示词 */}
          <div style={s.section}>系统提示词</div>
          <textarea
            style={s.textarea}
            rows={5}
            value={promptDraft}
            onChange={(e) => setPromptDraft(e.target.value)}
            placeholder="电脑端小巫的系统提示词"
          />

          <button style={s.saveBtn} disabled={busy} onClick={() => void doSave()}>
            {busy ? '处理中…' : '保存到电脑'}
          </button>
        </>
      )}
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f5f7', paddingBottom: 30 },
  topBar: { display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, background: '#fff' },
  back: { border: 'none', background: 'none', fontSize: 22, color: '#333', width: 36, height: 36 },
  topTitle: { flex: 1, fontSize: 17, fontWeight: 600, color: '#222' },
  refresh: { border: 'none', background: '#eef0ff', color: '#4a3fb0', borderRadius: 8, padding: '6px 14px', fontSize: 13 },
  msg: { padding: '8px 16px', fontSize: 13, color: '#4a3fb0' },
  empty: { padding: 60, textAlign: 'center', color: '#999', fontSize: 14 },
  section: { padding: '12px 16px 4px', fontSize: 13, fontWeight: 600, color: '#555' },
  card: { background: '#fff', margin: '6px 14px', borderRadius: 10, padding: 10 },
  cardTitle: { fontSize: 14, fontWeight: 600, color: '#222', marginBottom: 6 },
  activeTag: { marginLeft: 8, fontSize: 11, background: '#6c5ce7', color: '#fff', borderRadius: 4, padding: '2px 6px' },
  rowLine: { display: 'flex', gap: 8, marginTop: 6 },
  input: { flex: 1, border: '1px solid #ddd', borderRadius: 6, padding: '7px 10px', fontSize: 12, minWidth: 0 },
  actBtn: { border: 'none', background: '#eef0ff', color: '#4a3fb0', borderRadius: 6, padding: '7px 14px', fontSize: 12 },
  textarea: { width: 'auto', margin: '6px 14px', borderRadius: 8, border: '1px solid #ddd', padding: 10, fontSize: 13, fontFamily: 'inherit', display: 'block' },
  saveBtn: { display: 'block', margin: '18px 14px', width: 'calc(100% - 28px)', border: 'none', background: '#6c5ce7', color: '#fff', borderRadius: 10, padding: '12px 0', fontSize: 15 },
};
