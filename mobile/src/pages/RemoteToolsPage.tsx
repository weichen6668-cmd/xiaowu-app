/**
 * RemoteToolsPage — 电脑工具遥控（补全 T07）
 * 工具白名单执行（tools_exec）：安全工具一键跑，危险工具本地 ConfirmDialog 预确认
 *   → 桌面 guard 还会再弹远程 confirm（RemoteConfirmHost）二次确认，双保险。
 * 系统信息（sys_info）/ 一键优化（sys_optimize）/ 截屏（screenshot → remoteStore 截图卡片）。
 * 技能：search_skills / run_skill（install_skill 桌面端暂为占位提示）。
 */
import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { DANGEROUS_TOOLS } from '@xw/shared';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useRemoteStore } from '../store/remoteStore';
import {
  sysInfo,
  sysOptimize,
  takeScreenshot,
  toolsExec,
  searchSkills,
  installSkill,
  runSkill,
  type SkillBrief,
} from '../remote/remote-api';

interface ToolDef {
  name: string;
  label: string;
  fields: { key: string; placeholder: string }[];
}

/** 工具白名单（与桌面 services/tools.js 对齐；未列入的走「自定义」） */
const TOOLS: ToolDef[] = [
  { name: 'get_time', label: '⏰ 当前时间', fields: [] },
  { name: 'get_weather', label: '🌤 查天气', fields: [{ key: 'city', placeholder: '城市拼音，如 beijing' }] },
  { name: 'open_app', label: '🚀 打开应用', fields: [{ key: 'name', placeholder: '应用名，如 微信' }] },
  { name: 'open_url', label: '🌐 打开网址', fields: [{ key: 'url', placeholder: 'https://...' }] },
  { name: 'web_search', label: '🔍 网页搜索', fields: [{ key: 'query', placeholder: '搜索关键词' }] },
  { name: 'web_fetch', label: '📄 抓取网页', fields: [{ key: 'url', placeholder: 'https://...' }] },
  { name: 'set_volume', label: '🔊 设置音量', fields: [{ key: 'level', placeholder: '0-100' }] },
  { name: 'control_music', label: '🎵 控制音乐', fields: [{ key: 'action', placeholder: 'play/pause/next/previous' }] },
  { name: 'list_directory', label: '📂 列目录', fields: [{ key: 'path', placeholder: '路径，如 ~/' }] },
  { name: 'read_file', label: '📖 读文件', fields: [{ key: 'path', placeholder: '文件路径' }] },
  { name: 'run_shell', label: '⚠ 执行命令', fields: [{ key: 'command', placeholder: 'shell 命令（需确认）' }] },
  { name: 'click_on', label: '⚠ 点击屏幕', fields: [{ key: 'target', placeholder: '目标描述（需确认）' }] },
  { name: 'type_text', label: '⚠ 输入文字', fields: [{ key: 'text', placeholder: '要输入的文字（需确认）' }] },
  { name: 'system_power', label: '⚠ 电源操作', fields: [{ key: 'action', placeholder: 'lock/sleep（需确认）' }] },
  { name: 'move_to_trash', label: '⚠ 移到废纸篓', fields: [{ key: 'path', placeholder: '路径（需确认）' }] },
];

const isDangerous = (name: string): boolean => DANGEROUS_TOOLS.includes(name);

export function RemoteToolsPage(): React.ReactElement {
  const nav = useNavigate();
  const setScreenshot = useRemoteStore((s) => s.setScreenshot);
  const [busy, setBusy] = useState('');
  const [out, setOut] = useState('');
  const [args, setArgs] = useState<Record<string, string>>({});
  const [custom, setCustom] = useState({ name: '', args: '' });
  const [confirm, setConfirm] = useState<{ name: string; args: Record<string, unknown> } | null>(null);
  // 技能区
  const [query, setQuery] = useState('');
  const [skills, setSkills] = useState<SkillBrief[]>([]);
  const [skillMsg, setSkillMsg] = useState('');

  const show = (s: string) => setOut(s.length > 2500 ? s.slice(0, 2500) + '…（截断）' : s);

  const runTool = async (name: string, toolArgs: Record<string, unknown>) => {
    setBusy(name);
    try {
      const r = await toolsExec(name, toolArgs);
      if (r.ok) show(typeof r.data.result === 'string' ? r.data.result : JSON.stringify(r.data.result ?? r.data, null, 2));
      else show('❌ ' + (r.reason || '执行失败'));
    } catch (e) {
      show('❌ ' + String((e as Error).message || e));
    } finally {
      setBusy('');
    }
  };

  const onToolClick = (t: ToolDef) => {
    const toolArgs: Record<string, unknown> = {};
    for (const f of t.fields) toolArgs[f.key] = args[t.name + '.' + f.key] ?? '';
    if (isDangerous(t.name)) setConfirm({ name: t.name, args: toolArgs });
    else void runTool(t.name, toolArgs);
  };

  return (
    <div style={s.page}>
      <div style={s.topBar}>
        <button style={s.back} onClick={() => nav(-1)}>←</button>
        <div style={s.topTitle}>电脑工具遥控</div>
      </div>

      {/* 系统信息 / 优化 / 截屏 */}
      <div style={s.row}>
        <button
          style={s.sysBtn}
          disabled={!!busy}
          onClick={() => void (async () => {
            setBusy('sys_info');
            const r = await sysInfo();
            if (r.ok) {
              const i = r.data.info as Record<string, unknown> | undefined;
              show(i ? `平台: ${i.platform}\n主机: ${i.hostname}\nCPU: ${i.cpus} 核\n内存: ${i.memGB} GB\n运行: ${i.uptimeMin} 分钟` : JSON.stringify(r.data));
            } else show('❌ ' + (r.reason || '获取失败'));
            setBusy('');
          })()}
        >
          💻 系统信息
        </button>
        <button
          style={s.sysBtn}
          disabled={!!busy}
          onClick={() => void (async () => {
            setBusy('sys_optimize');
            const r = await sysOptimize();
            show(r.ok ? `✓ 优化完成，堆内存 ${String(r.data.heapMB ?? '?')} MB` : '❌ ' + (r.reason || '失败'));
            setBusy('');
          })()}
        >
          ⚡ 一键优化
        </button>
        <button
          style={s.sysBtn}
          disabled={!!busy}
          onClick={() => void (async () => {
            setBusy('screenshot');
            const r = await takeScreenshot();
            if (r.ok) {
              const shot = r.data.screenshot as { imageB64?: string } | undefined;
              const b64 = (shot && shot.imageB64) || String(r.data.imageB64 || '');
              if (b64) { setScreenshot(b64); show('✓ 截图已回显（见聊天页截图卡片）'); }
              else show('❌ 截图为空');
            } else show('❌ ' + (r.reason || '截图失败'));
            setBusy('');
          })()}
        >
          🖥 截屏
        </button>
      </div>

      <div style={s.section}>工具执行</div>
      <div style={s.grid}>
        {TOOLS.map((t) => (
          <div key={t.name} style={s.toolCard}>
            <button
              style={{ ...s.toolBtn, ...(isDangerous(t.name) ? s.toolBtnDanger : {}) }}
              disabled={!!busy}
              onClick={() => onToolClick(t)}
            >
              {t.label}
            </button>
            {t.fields.map((f) => (
              <input
                key={f.key}
                style={s.argInput}
                placeholder={f.placeholder}
                value={args[t.name + '.' + f.key] ?? ''}
                onChange={(e) => setArgs({ ...args, [t.name + '.' + f.key]: e.target.value })}
              />
            ))}
          </div>
        ))}
      </div>

      {/* 自定义工具 */}
      <div style={s.section}>自定义工具</div>
      <div style={s.customRow}>
        <input
          style={s.argInput}
          placeholder="工具名，如 look_screen"
          value={custom.name}
          onChange={(e) => setCustom({ ...custom, name: e.target.value })}
        />
        <input
          style={s.argInput}
          placeholder='参数 JSON，如 {"question":"按钮在哪"}'
          value={custom.args}
          onChange={(e) => setCustom({ ...custom, args: e.target.value })}
        />
        <button
          style={{ ...s.sysBtn, background: '#6c5ce7', color: '#fff' }}
          disabled={!!busy || !custom.name.trim()}
          onClick={() => void (async () => {
            let toolArgs: Record<string, unknown> = {};
            try { toolArgs = custom.args.trim() ? JSON.parse(custom.args) : {}; } catch { show('❌ 参数不是合法 JSON'); return; }
            const name = custom.name.trim();
            if (isDangerous(name)) setConfirm({ name, args: toolArgs });
            else await runTool(name, toolArgs);
          })()}
        >
          执行
        </button>
      </div>

      {/* 技能 */}
      <div style={s.section}>技能</div>
      <div style={s.customRow}>
        <input
          style={s.argInput}
          placeholder="搜索技能关键词"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <button
          style={s.sysBtn}
          disabled={!!busy || !query.trim()}
          onClick={() => void (async () => {
            setBusy('search_skills');
            setSkillMsg('');
            const r = await searchSkills(query.trim());
            if (r.ok) {
              const list = (r.data.list as SkillBrief[]) || [];
              setSkills(list);
              setSkillMsg(list.length ? `找到 ${list.length} 个` : '没找到相关技能');
            } else setSkillMsg('❌ ' + (r.reason || '搜索失败'));
            setBusy('');
          })}
        >
          搜索
        </button>
      </div>
      {skillMsg ? <div style={s.out}>{skillMsg}</div> : null}
      {skills.map((sk, i) => (
        <div key={`${sk.slug || i}`} style={s.skillCard}>
          <div style={s.skillTitle}>{sk.title || sk.slug}</div>
          <div style={s.skillDesc}>{sk.desc}</div>
          <div style={s.row}>
            <button
              style={s.sysBtn}
              onClick={() => void (async () => {
                const r = await runSkill(sk.slug || sk.title || '');
                show(r.ok ? String(r.data.out || '（无输出）') : '❌ ' + (r.reason || '运行失败'));
              })}
            >
              ▶ 运行
            </button>
            <button
              style={s.sysBtn}
              onClick={() => void (async () => {
                const r = await installSkill(sk.slug || sk.title || '');
                show(r.ok ? String(r.data.msg || '已请求安装') : '❌ ' + (r.reason || '安装失败'));
              })}
            >
              ⬇ 安装
            </button>
          </div>
        </div>
      ))}

      {/* 输出区 */}
      {out ? (
        <div style={s.section}>
          执行结果
          <pre style={s.out}>{out}</pre>
        </div>
      ) : null}

      {/* 危险操作本地预确认（桌面 guard 还会二次远程确认） */}
      <ConfirmDialog
        open={!!confirm}
        danger
        title={`危险操作：${confirm?.name || ''}`}
        message={`参数：${JSON.stringify(confirm?.args || {})}\n\n电脑端还会弹一次远程确认。确定要在电脑上执行吗？`}
        confirmText="发送执行"
        cancelText="取消"
        onConfirm={() => {
          const c = confirm;
          setConfirm(null);
          if (c) void runTool(c.name, c.args);
        }}
        onCancel={() => setConfirm(null)}
      />
    </div>
  );
}

const s: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f5f7', paddingBottom: 30 },
  topBar: { display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, background: '#fff' },
  back: { border: 'none', background: 'none', fontSize: 22, color: '#333', width: 36, height: 36 },
  topTitle: { flex: 1, fontSize: 17, fontWeight: 600, color: '#222' },
  row: { display: 'flex', gap: 8, padding: '10px 14px', flexWrap: 'wrap' },
  sysBtn: { border: 'none', background: '#eef0ff', color: '#4a3fb0', borderRadius: 8, padding: '8px 12px', fontSize: 13 },
  section: { padding: '10px 16px 4px', fontSize: 13, fontWeight: 600, color: '#555' },
  grid: { display: 'flex', flexWrap: 'wrap', gap: 8, padding: '0 14px' },
  toolCard: { display: 'flex', flexDirection: 'column', gap: 4, width: '47%' },
  toolBtn: { border: 'none', background: '#fff', borderRadius: 8, padding: '10px 8px', fontSize: 13, color: '#333' },
  toolBtnDanger: { background: '#fdecea', color: '#c0392b' },
  argInput: { border: '1px solid #ddd', borderRadius: 6, padding: '6px 8px', fontSize: 12, background: '#fff' },
  customRow: { display: 'flex', gap: 8, padding: '0 14px', flexWrap: 'wrap' },
  skillCard: { background: '#fff', margin: '8px 14px', borderRadius: 10, padding: 10 },
  skillTitle: { fontSize: 14, fontWeight: 600, color: '#222' },
  skillDesc: { fontSize: 12, color: '#888', margin: '4px 0 8px' },
  out: { background: '#1e1e2e', color: '#c8e6c9', borderRadius: 8, padding: 10, fontSize: 12, whiteSpace: 'pre-wrap', wordBreak: 'break-word', maxHeight: 260, overflowY: 'auto', margin: '6px 14px' },
};
