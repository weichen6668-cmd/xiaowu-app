/**
 * 设置页（FR-107/110）：账号/模型形象/LLM·ASR·TTS 配置/apiKey 管理/关于+FR-110 说明。
 * apiKey 仅 Keystore（掩码显示「已保存🔒」），非敏感配置进云同步。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore } from '../store/settingsStore';
import { getDataBackend, getSyncSDK } from '../platform/runtime';
import { ConfirmDialog } from '../components/ConfirmDialog';
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

  useEffect(() => {
    if (user) void load(user.userId, config?.deviceId || 'dev');
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

          {/* API Key 仅本地 Keystore */}
          <p className="mb-1 font-medium">API Key（仅本机 Keystore，不上云）</p>
          {keyRow('llm', 'LLM', hasLlmKey)}
          {keyRow('asr', 'ASR', hasAsrKey)}
          {keyRow('tts', 'TTS', hasTtsKey)}
        </section>

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
