/**
 * 登录页（FR-102/110）：
 * - mock/supabase：手机号 + OTP 登录/注册、60s 倒计时（mock 验证码固定 000000）
 * - xiaowu 云端后端：用户名 + 密码 直登/注册（探测 backend.loginWithPassword 分派）
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { humanMsg } from '@xw/shared';
import { useAuthStore } from '../store/authStore';
import { getDataBackend } from '../platform/runtime';

export function LoginPage(): React.ReactElement {
  const nav = useNavigate();
  const { sendOtp, verify, loginPassword, registerUser, sending, verifying, user } = useAuthStore();
  const [phone, setPhone] = useState('');
  // 手机号合法：11 位国内（1 开头）或 +开头的国际 E.164（如 +14158080913）
  const phoneValid = /^\d{11}$/.test(phone) || /^\+\d{8,15}$/.test(phone);
  const [code, setCode] = useState('');
  const [countdown, setCountdown] = useState(0);
  const [err, setErr] = useState('');
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const [password, setPassword] = useState('');
  // 双 Tab：账号密码 | 手机验证码（xiaowu 模式默认停 Tab①）
  const [tab, setTab] = useState<'pwd' | 'otp'>(() =>
    getDataBackend().loginWithPassword ? 'pwd' : 'otp',
  );
  // 忘记密码面板（账号密码 Tab 内；字段=账号 target，见后端 /api/send-code）
  const [view, setView] = useState<'login' | 'forgot'>('login');
  const [fpTarget, setFpTarget] = useState('');
  const [fpCode, setFpCode] = useState('');
  const [fpPass, setFpPass] = useState('');
  const [fpSent, setFpSent] = useState('');

  useEffect(() => {
    if (user) nav('/chat', { replace: true });
  }, [user, nav]);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, []);

  const startCountdown = () => {
    setCountdown(60);
    timerRef.current = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1 && timerRef.current) clearInterval(timerRef.current);
        return c - 1;
      });
    }, 1000);
  };

  const onSend = async () => {
    setErr('');
    // 归一 E.164：11 位国内 → +86 前缀；+开头保持（Supabase Phone OTP 要求）
    const e164 = phone.startsWith('+') ? phone : `+86${phone}`;
    const r = await sendOtp(getDataBackend(), e164);
    if (!r.ok) {
      setErr(r.msg);
      return;
    }
    startCountdown();
  };

  const onLogin = async () => {
    setErr('');
    const e164 = phone.startsWith('+') ? phone : `+86${phone}`;
    const r = await verify(getDataBackend(), e164, code);
    if (!r.ok) {
      setErr(r.msg || humanMsg(r.code));
      return;
    }
    nav('/chat', { replace: true });
  };

  // xiaowu 密码模式：用户名=phone 字段复用（免多状态），密码=password
  const onLoginPwd = async () => {
    setErr('');
    const r = await loginPassword(getDataBackend(), phone, password);
    if (!r.ok) {
      setErr(r.msg || humanMsg(r.code));
      return;
    }
    nav('/chat', { replace: true });
  };

  const onRegister = async () => {
    setErr('');
    const r = await registerUser(getDataBackend(), phone, password);
    if (!r.ok) {
      setErr(r.msg || humanMsg(r.code));
      return;
    }
    nav('/chat', { replace: true });
  };

  // 忘记密码：发重置验证码（账号 → /api/send-code；无短信配置时 mock_code 随响应返回）
  const onForgotSend = async () => {
    setErr(''); setFpSent('');
    const b = getDataBackend();
    if (!b.forgotPassword) return setErr('当前后端不支持找回密码');
    try {
      const r = await b.forgotPassword(fpTarget.trim());
      setFpSent(r.mock ? ('测试码 ' + r.mock_code) : '验证码已发送，5 分钟内有效');
    } catch (e) {
      setErr((e as Error).message || '发送失败');
    }
  };

  // 忘记密码：用验证码重置（/api/reset-password {target, code, new_password}）
  const onForgotReset = async () => {
    setErr('');
    const b = getDataBackend();
    if (!b.resetPassword) return setErr('当前后端不支持找回密码');
    try {
      await b.resetPassword(fpTarget.trim(), fpCode.trim(), fpPass);
      setView('login');
      setPassword('');
      setErr('');
      alert('密码已重置，请用新密码登录');
    } catch (e) {
      setErr((e as Error).message || '重置失败');
    }
  };

  const head = (
    <>
      <h1 className="text-2xl font-bold mb-2">✦ 小巫智能 ✦</h1>
      <div className="w-32 h-32 rounded-2xl bg-white/5 mb-6 flex items-center justify-center text-4xl">
        🧙‍♀️
      </div>
    </>
  );

  // 双 Tab 切换条（账号密码 | 手机验证码）
  const tabBar = (
    <div className="w-full max-w-xs flex mb-5 rounded-full bg-white/10 p-1 text-sm">
      <button
        type="button"
        className={`flex-1 h-9 rounded-full ${tab === 'pwd' ? 'bg-brand font-medium' : 'opacity-60'}`}
        onClick={() => { setTab('pwd'); setView('login'); setErr(''); setFpSent(''); }}
      >
        账号密码
      </button>
      <button
        type="button"
        className={`flex-1 h-9 rounded-full ${tab === 'otp' ? 'bg-brand font-medium' : 'opacity-60'}`}
        onClick={() => { setTab('otp'); setErr(''); }}
      >
        手机验证码
      </button>
    </div>
  );

  if (tab === 'pwd' && view === 'forgot') {
      return (
        <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-b from-[#2a1a4a] to-[#12081f] text-white">
          {head}
          <p className="text-sm opacity-70 mb-4">用已绑定的手机号或邮箱找回密码</p>
          <input
            className="w-full max-w-xs h-11 rounded-full bg-white/10 px-4 mb-3 outline-none text-sm"
            placeholder="账号（手机号 / 邮箱）"
            inputMode="text"
            maxLength={64}
            value={fpTarget}
            onChange={(e) => setFpTarget(e.target.value.replace(/\s/g, '').slice(0, 64))}
          />
          <div className="w-full max-w-xs flex gap-2 mb-3">
            <input
              className="flex-1 h-11 rounded-full bg-white/10 px-4 outline-none text-sm"
              placeholder="验证码"
              inputMode="numeric"
              maxLength={6}
              value={fpCode}
              onChange={(e) => setFpCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
            />
            <button
              type="button"
              className="h-11 px-4 rounded-full bg-brand text-sm disabled:opacity-40"
              disabled={!fpTarget.trim()}
              onClick={onForgotSend}
            >
              获取验证码
            </button>
          </div>
          <input
            className="w-full max-w-xs h-11 rounded-full bg-white/10 px-4 mb-3 outline-none text-sm"
            placeholder="新密码（至少 6 位）"
            type="password"
            maxLength={64}
            value={fpPass}
            onChange={(e) => setFpPass(e.target.value.slice(0, 64))}
          />
          <button
            type="button"
            className="w-full max-w-xs h-11 rounded-full bg-brand font-medium disabled:opacity-40"
            disabled={!fpTarget.trim() || fpCode.length !== 6 || fpPass.length < 6}
            onClick={onForgotReset}
          >
            重置密码
          </button>
          {fpSent ? <p className="mt-3 text-sm text-green-300">{fpSent}</p> : null}
          {err ? <p className="mt-3 text-sm text-red-300">{err}</p> : null}
          <button
            type="button"
            className="mt-4 text-xs opacity-60 underline"
            onClick={() => { setView('login'); setErr(''); }}
          >
            ‹ 返回登录
          </button>
        </div>
      );
  }

  if (tab === 'pwd') {
    return (
      <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-b from-[#2a1a4a] to-[#12081f] text-white">
        {head}
        {tabBar}
        <input
          className="w-full max-w-xs h-11 rounded-full bg-white/10 px-4 mb-3 outline-none text-sm"
          placeholder="用户名"
          maxLength={32}
          value={phone}
          onChange={(e) => setPhone(e.target.value.replace(/\s/g, '').slice(0, 32))}
        />
        <input
          className="w-full max-w-xs h-11 rounded-full bg-white/10 px-4 mb-3 outline-none text-sm"
          placeholder="密码"
          type="password"
          maxLength={64}
          value={password}
          onChange={(e) => setPassword(e.target.value.slice(0, 64))}
        />
        <div className="w-full max-w-xs flex justify-end mb-3">
          <button
            type="button"
            className="text-xs opacity-60 underline"
            onClick={() => { setView('forgot'); setErr(''); setFpSent(''); }}
          >
            忘记密码？
          </button>
        </div>
        <button
          type="button"
          className="w-full max-w-xs h-11 rounded-full bg-brand font-medium disabled:opacity-40"
          disabled={verifying || !phone.trim() || !password}
          onClick={onLoginPwd}
        >
          {verifying ? '登录中…' : '登  录'}
        </button>
        <button
          type="button"
          className="w-full max-w-xs h-11 mt-3 rounded-full bg-white/10 text-sm disabled:opacity-40"
          disabled={verifying || !phone.trim() || !password}
          onClick={onRegister}
        >
          注册新账号
        </button>
        {err ? <p className="mt-3 text-sm text-red-300">{err}</p> : null}
        <p className="mt-8 text-xs text-amber-300/80 text-center">云端账号 · 手机/电脑多端同步</p>
      </div>
    );
  }

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-6 bg-gradient-to-b from-[#2a1a4a] to-[#12081f] text-white">
      {head}
      {tabBar}

      <input
        className="w-full max-w-xs h-11 rounded-full bg-white/10 px-4 mb-3 outline-none text-sm"
        placeholder="手机号（11位国内 或 +国际区号）"
        inputMode="tel"
        maxLength={16}
        value={phone}
        onChange={(e) => setPhone(e.target.value.replace(/[^\d+]/g, '').slice(0, 16))}
      />
      <div className="w-full max-w-xs flex gap-2 mb-3">
        <input
          className="flex-1 h-11 rounded-full bg-white/10 px-4 outline-none text-sm"
          placeholder="验证码"
          inputMode="numeric"
          maxLength={6}
          value={code}
          onChange={(e) => setCode(e.target.value.replace(/\D/g, ''))}
        />
        <button
          type="button"
          className="h-11 px-4 rounded-full bg-brand text-sm disabled:opacity-40"
          disabled={countdown > 0 || sending || !phoneValid}
          onClick={onSend}
        >
          {countdown > 0 ? `${countdown}s` : sending ? '发送中…' : '获取验证码'}
        </button>
      </div>

      <button
        type="button"
        className="w-full max-w-xs h-11 rounded-full bg-brand font-medium disabled:opacity-40"
        disabled={verifying || !phoneValid || code.length !== 6}
        onClick={onLogin}
      >
        {verifying ? '登录中…' : '登  录'}
      </button>

      {err ? <p className="mt-3 text-sm text-red-300">{err}</p> : null}

      <p className="mt-4 text-xs opacity-50">可选：邮箱登录 ›（M2）</p>

      {/* FR-110 多端预期提示 */}
      <p className="mt-8 text-xs text-amber-300/80 text-center">
        ⚠ M1 为手机端单端上云，电脑端互通开发中（M2）
      </p>
    </div>
  );
}
