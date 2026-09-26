/**
 * 设置页（FR-107/110）：账号/模型形象/LLM·ASR·TTS 配置/apiKey 管理/关于+FR-110 说明。
 * apiKey 仅 Keystore（掩码显示「已保存🔒」），非敏感配置进云同步。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, readApiKey } from '../store/settingsStore';
import { useProfileStore, type ProfileKind } from '../store/profileStore';
import { testLlm, testAsrTts } from '../services/link-test';
import { ProfileManager } from '../components/ProfileManager';
import { getDataBackend, getSyncSDK } from '../platform/runtime';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { useDeviceStore } from '../store/deviceStore';
import { useRemoteStore } from '../store/remoteStore';
import { useOverlayStore } from '../store/overlayStore';
import type { UserConfig } from '@xw/shared';

type KeyKind = 'llm' | 'asr' | 'tts';

export function SettingsPage(): React.ReactElement {
  const nav = useNavigate();
  const { user, signOut } = useAuthStore();
  const { config, hasLlmKey, hasAsrKey, hasTtsKey, load, update, saveApiKey, clearApiKey } =
    useSettingsStore();
  const [keyDraft, setKeyDraft] = useState<Record<KeyKind, string>>({ llm: '', asr: '', tts: '' });
  const [askSignOut, setAskSignOut] = useState(false);
  const [saved, setSaved] = useState('');
  // 绑定手机（xiaowu 后端；用于忘记密码短信找回）
  const [bindPhone, setBindPhone] = useState('');
  const [bindCode, setBindCode] = useState('');
  const [bindMsg, setBindMsg] = useState('');
  const canBindPhone = !!getDataBackend().bindPhone;
  // 互通状态（T05）
  const devices = useDeviceStore((s) => s.devices);
  const mqttConnected = useDeviceStore((s) => s.mqttConnected);
  // T06 桌面悬浮（仅 Android 展示；iOS/Web supported=false 隐藏）
  const ovSupported = useOverlayStore((s) => s.supported);
  const ovForm = useOverlayStore((s) => s.form);
  const ovPowerSave = useOverlayStore((s) => s.powerSave);
  const ovThrottled = useOverlayStore((s) => s.throttled);
  const { setForm: setOvForm, setPowerSave } = useOverlayStore();
  // T05 扩展①：测试连接结果（「✓ 连通 123ms」/失败原因）
  const [testMsg, setTestMsg] = useState<Record<KeyKind, string>>({ llm: '', asr: '', tts: '' });
  const [testing, setTesting] = useState<Record<KeyKind, boolean>>({ llm: false, asr: false, tts: false });
  // T05 扩展②：自定义 API 档案（下拉切换）
  const profiles = useProfileStore((s) => s.profiles);
  const active = useProfileStore((s) => s.active);
  const { loadAll, setActive, readProfileKey, current } = useProfileStore();

  useEffect(() => {
    if (user) void load(user.userId, config?.deviceId || 'dev');
    void loadAll();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user]);

  const patch = (p: Partial<UserConfig>) => {
    void update(p).then(() => {
      // 非敏感配置上云（M2 激活双向，M1 上行）
      if (user) {
        void getSyncSDK().enqueue({
          deviceId: config?.deviceId || 'dev',
          entity: 'user_config',
          entityId: user.userId,
          action: 'upsert',
          payload: { ...config, ...p } as Record<string, unknown>,
        });
      }
    });
  };

  const saveKey = async (k: KeyKind) => {
    await saveApiKey(k, keyDraft[k].trim());
    setKeyDraft({ ...keyDraft, [k]: '' });
    setSaved(k);
    setTimeout(() => setSaved(''), 1500);
  };

  /** T05 扩展①：测试连接——key 只瞬时读出入参，禁止进日志/结果文案 */
  const onTest = async (k: KeyKind) => {
    setTesting((t) => ({ ...t, [k]: true }));
    setTestMsg((m) => ({ ...m, [k]: '探测中…' }));
    try {
      const c = config;
      const key = await readApiKey(k);
      const r =
        k === 'llm'
          ? await testLlm(c?.llmBaseUrl || '', key, c?.llmModel || '')
          : k === 'asr'
            ? await testAsrTts(c?.asrBaseUrl || '', key, 'asr')
            : await testAsrTts(c?.ttsBaseUrl || '', key, 'tts');
      setTestMsg((m) => ({
        ...m,
        [k]: r.ok ? `✓ 连通 ${r.ms}ms（${r.detail || ''}）` : `✗ ${r.reason || '连接失败'}`,
      }));
    } catch (e) {
      setTestMsg((m) => ({ ...m, [k]: '✗ ' + ((e as Error).message || '测试异常').slice(0, 60) }));
    } finally {
      setTesting((t) => ({ ...t, [k]: false }));
    }
  };

  /** T05 扩展②：切自定义档案——三区统一应用该档案的 baseUrl/model/voice（key 不动，走 Keystore 引用） */
  const onPickProfile = async (k: KeyKind, id: string) => {
    await setActive(k as ProfileKind, id);
    const p = current(k as ProfileKind);
    if (!p) return;
    if (k === 'llm') patch({ llmProvider: 'custom', llmBaseUrl: p.baseUrl, llmModel: p.model });
    else if (k === 'asr') patch({ asrProvider: 'openai', asrBaseUrl: p.baseUrl });
    else patch({ ttsProvider: 'openai', ttsBaseUrl: p.baseUrl, ttsVoice: p.voice || p.model });
  };

  // 绑定手机：发码 + 绑定（xiaowu 后端）
  const onBindSend = async () => {
    setBindMsg('');
    const b = getDataBackend();
    if (!b.smsSend) return;
    try {
      const r = await b.smsSend(bindPhone.trim(), 'bind');
      setBindMsg(r.mock ? ('测试码 ' + r.mock_code) : '验证码已发送，10 分钟内有效');
    } catch (e) {
      setBindMsg('❌ ' + ((e as Error).message || '发送失败'));
    }
  };
  const onBindOk = async () => {
    setBindMsg('');
    const b = getDataBackend();
    if (!b.bindPhone) return;
    try {
      const r = await b.bindPhone(bindPhone.trim(), bindCode.trim());
      setBindMsg('✅ 已绑定 ' + r.phone + '（忘记密码可用短信找回）');
      setBindPhone(''); setBindCode('');
    } catch (e) {
      setBindMsg('❌ ' + ((e as Error).message || '绑定失败'));
    }
  };

  const keyRow = (k: KeyKind, label: string, has: boolean) => (
    <div className="flex items-center gap-2 mb-2">
      <span className="w-16 text-xs opacity-70">{label}</span>
      <span className="text-xs">{has ? '已保存🔒' : '未设置'}</span>
      <input
        className="flex-1 h-9 rounded bg-white/10 px-2 text-xs outline-none"
        placeholder="粘贴后点保存（仅本机 Keystore）"
        type="password"
        value={keyDraft[k]}
        onChange={(e) => setKeyDraft({ ...keyDraft, [k]: e.target.value })}
      />
      <button type="button" className="text-xs text-brand-light" onClick={() => void saveKey(k)}>
        {saved === k ? '✓' : '保存'}
      </button>
      {has ? (
        <button type="button" className="text-xs opacity-60" onClick={() => void clearApiKey(k)}>
          重置
        </button>
      ) : null}
    </div>
  );

  const maskedPhone = user ? user.phone.replace(/(\d{3})\d{4}(\d{4})/, '$1****$2') : '';

  return (
    <div className="flex flex-col min-h-screen bg-[#12081f] text-white">
      <header className="flex items-center px-4 py-3 border-b border-white/10">
        <button type="button" onClick={() => nav('/chat')} className="text-sm opacity-70 mr-3">
          ←
        </button>
        <span className="font-semibold">设置</span>
      </header>

      <div className="p-4 space-y-6 text-sm">
        {/* 账号 */}
        <section>
          <h3 className="text-xs opacity-50 mb-2">── 账号 ──</h3>
          <div className="flex items-center justify-between">
            <span>{maskedPhone}</span>
            <button type="button" className="text-red-300" onClick={() => setAskSignOut(true)}>
              退出
            </button>
          </div>

          {canBindPhone ? (
            <div className="mt-3 rounded-lg bg-white/5 p-3">
              <p className="text-xs opacity-70 mb-2">绑定手机（用于忘记密码短信找回）</p>
              <div className="flex gap-2 mb-2">
                <input
                  className="flex-1 h-9 rounded bg-white/10 px-2 text-xs outline-none"
                  placeholder="手机号（11位 或 +国际区号）"
                  inputMode="tel"
                  maxLength={16}
                  value={bindPhone}
                  onChange={(e) => setBindPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 16))}
                />
                <button type="button" className="h-9 px-3 rounded bg-white/10 text-xs" onClick={onBindSend}>
                  发验证码
                </button>
              </div>
              <div className="flex gap-2">
                <input
                  className="flex-1 h-9 rounded bg-white/10 px-2 text-xs outline-none"
                  placeholder="短信验证码"
                  inputMode="numeric"
                  maxLength={6}
                  value={bindCode}
                  onChange={(e) => setBindCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
                />
                <button type="button" className="h-9 px-3 rounded bg-white/10 text-xs" onClick={onBindOk}>
                  绑定
                </button>
              </div>
              {bindMsg ? <p className="mt-2 text-xs">{bindMsg}</p> : null}
            </div>
          ) : null}
        </section>

        {/* 模型形象 */}
        <section>
          <h3 className="text-xs opacity-50 mb-2">── 模型形象 ──</h3>
          <button
            type="button"
            className="w-full flex items-center justify-between rounded-lg bg-white/5 px-3 py-3"
            onClick={() => nav('/settings/model')}
          >
            <span>当前：{config?.avatarModel === 'mage-b' ? '小巫B' : '小巫A'}</span>
            <span className="opacity-50">切换 ›</span>
          </button>
        </section>

        {/* 服务配置 */}
        <section>
          <h3 className="text-xs opacity-50 mb-2">── 服务配置 ──</h3>

          <p className="mb-1 font-medium">LLM</p>
          <select
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs"
            value={config?.llmProvider || 'deepseek'}
            onChange={(e) => patch({ llmProvider: e.target.value })}
          >
            <option value="deepseek">DeepSeek</option>
            <option value="openai">OpenAI 兼容</option>
            <option value="custom">自定义</option>
          </select>
          <input
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs outline-none"
            placeholder="baseURL"
            value={config?.llmBaseUrl || ''}
            onChange={(e) => patch({ llmBaseUrl: e.target.value })}
          />
          <input
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs outline-none"
            placeholder="model"
            value={config?.llmModel || ''}
            onChange={(e) => patch({ llmModel: e.target.value })}
          />
          {profiles.some((p) => p.kind === 'llm') ? (
            <select
              className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs"
              value={active.llm || ''}
              onChange={(e) => void onPickProfile('llm', e.target.value)}
            >
              <option value="">— 选择自定义档案 —</option>
              {profiles.filter((p) => p.kind === 'llm').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              className="h-8 px-3 rounded bg-white/10 text-xs disabled:opacity-40"
              disabled={testing.llm}
              onClick={() => void onTest('llm')}
            >
              测试连接
            </button>
            <span className={`text-xs ${testMsg.llm.startsWith('✓') ? 'text-emerald-300' : testMsg.llm.startsWith('✗') ? 'text-red-300' : 'opacity-70'}`}>
              {testMsg.llm}
            </span>
          </div>

          <p className="mb-1 font-medium">ASR</p>
          <select
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs"
            value={config?.asrProvider || 'volc'}
            onChange={(e) => patch({ asrProvider: e.target.value })}
          >
            <option value="volc">火山</option>
            <option value="mimo">MiMo</option>
            <option value="openai">OpenAI 兼容</option>
          </select>
          <input
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs outline-none"
            placeholder="baseURL"
            value={config?.asrBaseUrl || ''}
            onChange={(e) => patch({ asrBaseUrl: e.target.value })}
          />
          {profiles.some((p) => p.kind === 'asr') ? (
            <select
              className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs"
              value={active.asr || ''}
              onChange={(e) => void onPickProfile('asr', e.target.value)}
            >
              <option value="">— 选择自定义档案 —</option>
              {profiles.filter((p) => p.kind === 'asr').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              className="h-8 px-3 rounded bg-white/10 text-xs disabled:opacity-40"
              disabled={testing.asr}
              onClick={() => void onTest('asr')}
            >
              测试连接
            </button>
            <span className={`text-xs ${testMsg.asr.startsWith('✓') ? 'text-emerald-300' : testMsg.asr.startsWith('✗') ? 'text-red-300' : 'opacity-70'}`}>
              {testMsg.asr}
            </span>
          </div>

          <p className="mb-1 font-medium">TTS</p>
          <select
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs"
            value={config?.ttsProvider || 'volc'}
            onChange={(e) => patch({ ttsProvider: e.target.value })}
          >
            <option value="volc">火山</option>
            <option value="mimo">MiMo</option>
            <option value="openai">OpenAI 兼容</option>
          </select>
          <input
            className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs outline-none"
            placeholder="baseURL"
            value={config?.ttsBaseUrl || ''}
            onChange={(e) => patch({ ttsBaseUrl: e.target.value })}
          />
          <input
            className="w-full h-9 rounded bg-white/10 px-2 mb-3 text-xs outline-none"
            placeholder="音色（默认 xiaowu_female）"
            value={config?.ttsVoice || ''}
            onChange={(e) => patch({ ttsVoice: e.target.value })}
          />
          {profiles.some((p) => p.kind === 'tts') ? (
            <select
              className="w-full h-9 rounded bg-white/10 px-2 mb-2 text-xs"
              value={active.tts || ''}
              onChange={(e) => void onPickProfile('tts', e.target.value)}
            >
              <option value="">— 选择自定义档案 —</option>
              {profiles.filter((p) => p.kind === 'tts').map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <div className="flex items-center gap-2 mb-3">
            <button
              type="button"
              className="h-8 px-3 rounded bg-white/10 text-xs disabled:opacity-40"
              disabled={testing.tts}
              onClick={() => void onTest('tts')}
            >
              测试连接
            </button>
            <span className={`text-xs ${testMsg.tts.startsWith('✓') ? 'text-emerald-300' : testMsg.tts.startsWith('✗') ? 'text-red-300' : 'opacity-70'}`}>
              {testMsg.tts}
            </span>
          </div>
          {/* 语音播报开关（默认开；关闭后发消息不播报，文字照常显示） */}
          <div className="flex items-center justify-between mb-3">
            <span className="text-xs opacity-70">语音播报</span>
            <button
              type="button"
              className={`w-12 h-7 rounded-full transition-colors ${config?.ttsEnabled !== false ? 'bg-brand' : 'bg-white/20'}`}
              onClick={() => patch({ ttsEnabled: config?.ttsEnabled === false })}
            >
              <span
                className={`block w-6 h-6 m-0.5 rounded-full bg-white transition-transform ${config?.ttsEnabled !== false ? 'translate-x-5' : ''}`}
              />
            </button>
          </div>

          {/* API Key 仅本地 Keystore */}
          <p className="mb-1 font-medium">API Key（仅本机 Keystore，不上云）</p>
          {keyRow('llm', 'LLM', hasLlmKey)}
          {keyRow('asr', 'ASR', hasAsrKey)}
          {keyRow('tts', 'TTS', hasTtsKey)}

          {/* T05 扩展②：多自定义 API 命名档案（key 按档案存 Keystore 引用） */}
          <div className="mt-3">
            <ProfileManager />
          </div>
        </section>

        {/* 双端互通（T05）：设备管理入口 + MQTT 状态 + 同步说明 */}
        <section>
          <h3 className="text-xs opacity-50 mb-2">── 互通 ──</h3>
          <button
            type="button"
            className="w-full mb-2 rounded-lg bg-white/10 px-3 py-2 text-sm text-left"
            onClick={() => nav('/devices')}
          >
            💻 设备管理（{devices.length} 台 · 上限 5 台）→
          </button>
          <p className="text-xs opacity-70 mb-1">
            遥控通道：{mqttConnected ? '🟢 已连接' : '⚪ 未连接'}（配对码仅存电脑端，16 位配对）
          </p>
          <p className="text-xs opacity-70 mb-1">
            数据同步：会话/消息/记忆/配置 LWW 双向（云端 oplog 幂等）
          </p>
          <p className="text-xs text-amber-300/80 leading-relaxed">
            ℹ️ 同步冲突按 Lamport 时间合并（平手比设备号）；危险操作需手机确认，30 秒未确认自动拒绝。
          </p>
        </section>

        {/* 桌面悬浮（T06，FR-301~307）：仅 Android；iOS 隐藏入口（FR-317 归 P2） */}
        {ovSupported ? (
          <section>
            <h3 className="text-xs opacity-50 mb-2">── 桌面悬浮 ──</h3>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs opacity-70">形态</span>
              <div className="flex gap-2">
                <button
                  type="button"
                  className={`px-3 py-1 rounded text-xs ${ovForm === 'ball' ? 'bg-brand' : 'bg-white/10'}`}
                  onClick={() => void setOvForm('ball')}
                >
                  悬浮球
                </button>
                <button
                  type="button"
                  className={`px-3 py-1 rounded text-xs ${ovForm === 'pet' ? 'bg-brand' : 'bg-white/10'}`}
                  onClick={() => void setOvForm('pet')}
                >
                  桌宠小窗
                </button>
              </div>
            </div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-xs opacity-70">
                省电模式{ovThrottled && !ovPowerSave ? '（过热/低电自动降级中）' : ''}
              </span>
              <button
                type="button"
                className={`w-12 h-7 rounded-full transition-colors ${ovPowerSave ? 'bg-brand' : 'bg-white/20'}`}
                onClick={() => void setPowerSave(!ovPowerSave)}
              >
                <span className={`block w-6 h-6 m-0.5 rounded-full bg-white transition-transform ${ovPowerSave ? 'translate-x-5' : ''}`} />
              </button>
            </div>
            <button
              type="button"
              className="w-full rounded-lg bg-white/10 px-3 py-2 text-sm text-left"
              onClick={() => nav('/overlay-guide')}
            >
              🎈 权限与使用引导（首次开启必看）→
            </button>
            <p className="mt-2 text-xs text-amber-300/80 leading-relaxed">
              ℹ️ RAM&lt;4GB 默认省电（8fps）；&gt;40℃ 或电量 &lt;20% 自动降级，手动开关最高优先。
            </p>
          </section>
        ) : null}

        {/* 关于 */}
        <section>
          <h3 className="text-xs opacity-50 mb-2">── 关于 ──</h3>
          <p className="text-xs opacity-70">v0.1.0 (M1)</p>
          {/* FR-110 */}
          <p className="mt-2 text-xs text-amber-300/80 leading-relaxed">
            ℹ️ M1 手机端单端上云，电脑互通开发中（M2）。当前手机端对话记录自动同步云端并支持换机拉取；
            与电脑端双向互通尚未开通。
          </p>
        </section>
      </div>

      <ConfirmDialog
        open={askSignOut}
        title="退出登录"
        message="退出后本机对话记录仍保留，需重新验证码登录。"
        confirmText="退出"
        danger
        onConfirm={() => {
          setAskSignOut(false);
          void signOut(getDataBackend()).then(() => nav('/login', { replace: true }));
        }}
        onCancel={() => setAskSignOut(false)}
      />
    </div>
  );
}
