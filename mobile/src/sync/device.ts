/**
 * device_id 生成/注册/上限 5 台踢最早（Q3）。
 * 首启生成 uuid 持久化 Keystore（§8）。
 */
import type { DataBackend, Device } from '@xw/shared';
import { secureStore, SS_KEYS } from '../platform/secure-store';
import { log } from '../platform/log';

/** 读取或生成 device_id（Keystore 持久化） */
export async function getOrCreateDeviceId(): Promise<string> {
  const existing = await secureStore.get(SS_KEYS.DEVICE_ID);
  if (existing) return existing;
  const id = crypto.randomUUID();
  await secureStore.set(SS_KEYS.DEVICE_ID, id);
  return id;
}

/** 机型 + 系统 作 device_name */
export function deviceName(): string {
  const ua = typeof navigator !== 'undefined' ? navigator.userAgent : 'unknown';
  const m = /Android\s+([^;)]+)/.exec(ua);
  const os = m ? `Android ${m[1]}` : /iPhone|iPad/.test(ua) ? 'iOS' : 'Dev';
  return `${os} · ${String(Date.now()).slice(-4)}`;
}

/** 注册本机（超 5 台由 backend.registerDevice 内部踢最早） */
export async function registerThisDevice(backend: DataBackend): Promise<Device> {
  try {
    return await backend.registerDevice(deviceName());
  } catch (e) {
    log.warn('registerDevice failed', e);
    throw e;
  }
}
