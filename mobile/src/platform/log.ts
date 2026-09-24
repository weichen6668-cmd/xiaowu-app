/**
 * 统一日志脱敏（§8）：打印前抹除 sk-xxx、Bearer xxx、手机号中间 4 位。
 * Release 构建日志级别 = warn（默认；可用 __DEV__ 覆盖）。
 */
const RE_SK = /sk-\w+/g;
const RE_BEARER = /Bearer\s+\S+/g;
const RE_PHONE = /(\d{3})\d{4}(\d{4})/g;

export function mask(msg: string): string {
  return String(msg)
    .replace(RE_SK, 'sk-****')
    .replace(RE_BEARER, 'Bearer ****')
    .replace(RE_PHONE, '$1****$2');
}

declare const __DEV__: boolean | undefined;
const isDev = typeof __DEV__ !== 'undefined' ? !!__DEV__ : true;

export const log = {
  debug(...args: unknown[]): void {
    if (isDev) console.debug(...args.map((a) => (typeof a === 'string' ? mask(a) : a)));
  },
  info(...args: unknown[]): void {
    if (isDev) console.info(...args.map((a) => (typeof a === 'string' ? mask(a) : a)));
  },
  warn(...args: unknown[]): void {
    console.warn(...args.map((a) => (typeof a === 'string' ? mask(a) : a)));
  },
  error(...args: unknown[]): void {
    console.error(...args.map((a) => (typeof a === 'string' ? mask(a) : a)));
  },
};
