/**
 * 认证状态（FR-102）：手机号 OTP 登录/退出。
 * token/session 存 secure-store（Keystore），不进 SQLite/日志。
 */
import { create } from 'zustand';
import type { ApiResult, AuthUser, DataBackend } from '@xw/shared';
import { ok, fail, XW_ERR, fromError } from '@xw/shared';
import { secureStore, SS_KEYS } from '../platform/secure-store';
import { log } from '../platform/log';

interface AuthState {
  user: AuthUser | null;
  ready: boolean;
  sending: boolean;
  verifying: boolean;
  init(backend: DataBackend): Promise<void>;
  sendOtp(backend: DataBackend, phone: string): Promise<ApiResult<void>>;
  verify(backend: DataBackend, phone: string, code: string): Promise<ApiResult<AuthUser>>;
  /** 用户名+密码直登（xiaowu 后端；backend 需实现 loginWithPassword） */
  loginPassword(backend: DataBackend, username: string, password: string): Promise<ApiResult<AuthUser>>;
  /** 注册并自动登录（xiaowu 后端；backend 需实现 register） */
  registerUser(backend: DataBackend, username: string, password: string, email?: string): Promise<ApiResult<AuthUser>>;
  signOut(backend: DataBackend): Promise<void>;
}

export const useAuthStore = create<AuthState>((set, get) => ({
  user: null,
  ready: false,
  sending: false,
  verifying: false,

  /** 首启恢复：Keystore 读 auth session（§4 场景②） */
  async init(backend: DataBackend): Promise<void> {
    try {
      const raw = await secureStore.get(SS_KEYS.AUTH_SESSION);
      if (raw) {
        const user = JSON.parse(raw) as AuthUser;
        if (user && user.userId) {
          set({ user, ready: true });
          return;
        }
      }
    } catch (e) {
      log.warn('auth init failed', e);
    }
    set({ ready: true });
    void backend;
  },

  async sendOtp(backend: DataBackend, phone: string): Promise<ApiResult<void>> {
    const clean = phone.replace(/\s/g, '');
    // 与 LoginPage.phoneValid 对齐：11 位国内 或 +开头国际 E.164
    //（LoginPage 调用前已归一 E.164，恒带 + 前缀，如 +8613800001111 / +14158080913）
    if (!(/^\d{11}$/.test(clean) || /^\+\d{8,15}$/.test(clean))) {
      return fail(XW_ERR.AUTH_OTP_SEND_FAIL, '请输入 11 位手机号或 +国际区号号码');
    }
    set({ sending: true });
    try {
      await backend.signInOtp(clean);
      return ok(undefined);
    } catch (e) {
      return fromError<void>(e);
    } finally {
      set({ sending: false });
    }
  },

  async verify(backend: DataBackend, phone: string, code: string): Promise<ApiResult<AuthUser>> {
    const clean = phone.replace(/\s/g, '');
    if (!/^\d{6}$/.test(code)) {
      return fail(XW_ERR.AUTH_OTP_WRONG);
    }
    set({ verifying: true });
    try {
      const user = await backend.verifyOtp(clean, code);
      await secureStore.set(SS_KEYS.AUTH_SESSION, JSON.stringify(user));
      set({ user });
      return ok(user);
    } catch (e) {
      return fail(XW_ERR.AUTH_OTP_WRONG, (e as Error).message?.slice(0, 80));
    } finally {
      set({ verifying: false });
    }
  },

  async loginPassword(backend: DataBackend, username: string, password: string): Promise<ApiResult<AuthUser>> {
    const u = username.trim();
    if (!u || !password) {
      return fail(XW_ERR.AUTH_OTP_SEND_FAIL, '请输入用户名和密码');
    }
    if (!backend.loginWithPassword) {
      return fail(XW_ERR.AUTH_OTP_SEND_FAIL, '当前后端不支持密码登录');
    }
    set({ verifying: true });
    try {
      const user = await backend.loginWithPassword(u, password);
      await secureStore.set(SS_KEYS.AUTH_SESSION, JSON.stringify(user));
      set({ user });
      return ok(user);
    } catch (e) {
      return fail(XW_ERR.AUTH_OTP_WRONG, (e as Error).message?.slice(0, 80));
    } finally {
      set({ verifying: false });
    }
  },

  async registerUser(backend: DataBackend, username: string, password: string, email?: string): Promise<ApiResult<AuthUser>> {
    const u = username.trim();
    if (!u || !password) {
      return fail(XW_ERR.AUTH_OTP_SEND_FAIL, '请输入用户名和密码');
    }
    if (!backend.register) {
      return fail(XW_ERR.AUTH_OTP_SEND_FAIL, '当前后端不支持注册');
    }
    set({ verifying: true });
    try {
      const user = await backend.register(u, password, email?.trim() || undefined);
      await secureStore.set(SS_KEYS.AUTH_SESSION, JSON.stringify(user));
      set({ user });
      return ok(user);
    } catch (e) {
      return fail(XW_ERR.AUTH_OTP_WRONG, (e as Error).message?.slice(0, 80));
    } finally {
      set({ verifying: false });
    }
  },

  async signOut(backend: DataBackend): Promise<void> {
    try {
      await backend.signOut();
    } catch (e) {
      log.warn('signOut backend err', e);
    }
    await secureStore.remove(SS_KEYS.AUTH_SESSION);
    set({ user: get().user && null });
  },
}));
