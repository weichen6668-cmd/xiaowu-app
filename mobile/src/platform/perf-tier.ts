/**
 * T06 性能分档（Q12/FR-307）：
 * - detectTier：RAM<4GB 或 GPU 黑名单 → low（默认省电）；中端 mid；高端 high
 * - fps 表：high=30 / mid=24 / low=8（或立绘静态）
 * - 自动降级：温度 >40℃ 或电量 <20% → 强制 low；恢复后回原档
 * - 手动开关最高优先（manualOverride 时自动降级不生效，UI 角标提示）
 */
export type PerfTier = 'high' | 'mid' | 'low';

export const TIER_FPS: Record<PerfTier, number> = { high: 30, mid: 24, low: 8 };

/** Q12 GPU 黑名单（Adreno/Mali/Tegra 已知低端型号前缀；云端下发列 P2） */
const GPU_BLACKLIST = [
  'adreno (tm) 3',
  'adreno (tm) 4[0-2]',
  'mali-4',
  'mali-t6',
  'mali-t7',
  'tegra 2',
  'tegra 3',
  'powervr sgx',
];

function gpuString(): string {
  // WebGL 渲染器串（RN/WebView 同源）；取不到返回空串（不据此判低端）
  try {
    const c = document.createElement('canvas');
    const gl = (c.getContext('webgl') || c.getContext('experimental-webgl')) as WebGLRenderingContext | null;
    if (!gl) return '';
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    if (!ext) return '';
    return String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL) || '').toLowerCase();
  } catch {
    return '';
  }
}

function ramGb(): number {
  // navigator.deviceMemory：Chromium 系（WebView=Android Chromium）单位 GB，上限 8
  const dm = (navigator as Navigator & { deviceMemory?: number }).deviceMemory;
  return typeof dm === 'number' && dm > 0 ? dm : 8; // 未知=不据此判低端
}

function gpuBlacklisted(): boolean {
  const s = gpuString();
  if (!s) return false;
  return GPU_BLACKLIST.some((pat) => new RegExp(pat).test(s));
}

/** 基础档（静态判定：RAM/GPU） */
export function detectTier(): PerfTier {
  if (ramGb() < 4 || gpuBlacklisted()) return 'low';
  if (ramGb() < 6) return 'mid';
  return 'high';
}

/** 自动降级判定：温度 >40℃ 或电量 <20%（Q12） */
export function shouldThrottle(tempC: number | null, batteryPct: number | null): boolean {
  if (tempC != null && tempC > 40) return true;
  if (batteryPct != null && batteryPct < 20) return true;
  return false;
}

interface PerfState {
  base: PerfTier;
  /** 手动档（null=未手动设，自动走 base）；手动最高优先（FR-307） */
  manual: PerfTier | null;
  /** 自动降级中（角标提示用） */
  throttled: boolean;
}

const state: PerfState = { base: detectTier(), manual: null, throttled: false };
const listeners = new Set<(t: PerfTier, throttled: boolean) => void>();

/** 当前生效档：手动优先；自动降级强制 low（手动时忽略降级，FR-307 手动最高优先） */
export function currentTier(): PerfTier {
  if (state.manual) return state.manual;
  return state.throttled ? 'low' : state.base;
}

export function currentFps(): number {
  return TIER_FPS[currentTier()];
}

/** 手动设档（null=回自动） */
export function setManualTier(t: PerfTier | null): void {
  state.manual = t;
  emit();
}

/** 自动降级入口（温度/电量事件推入） */
export function onThermal(cb: (t: PerfTier, throttled: boolean) => void): () => void {
  listeners.add(cb);
  cb(currentTier(), state.throttled);
  return () => listeners.delete(cb);
}

/** 采样温度/电量并更新降级态（调用方定时喂入；异常值忽略） */
export function reportThermal(tempC: number | null, batteryPct: number | null): void {
  const next = shouldThrottle(tempC, batteryPct);
  if (next !== state.throttled) {
    state.throttled = next;
    emit();
  }
}

/** 电量订阅（Web 标准 API；不可用时跳过） */
export function watchBattery(): () => void {
  try {
    const nav = navigator as Navigator & {
      getBattery?: () => Promise<{ level: number; addEventListener: (t: string, cb: () => void) => void; removeEventListener: (t: string, cb: () => void) => void }>;
    };
    if (!nav.getBattery) return () => undefined;
    let battery: Awaited<ReturnType<NonNullable<typeof nav.getBattery>>> | null = null;
    const onChange = () => {
      if (battery) reportThermal(null, Math.round(battery.level * 100));
    };
    void nav.getBattery().then((b) => {
      battery = b;
      b.addEventListener('levelchange', onChange);
      b.addEventListener('chargingchange', onChange);
      onChange();
    });
    return () => {
      if (battery) {
        battery.removeEventListener('levelchange', onChange);
        battery.removeEventListener('chargingchange', onChange);
      }
    };
  } catch {
    return () => undefined;
  }
}

function emit(): void {
  const t = currentTier();
  listeners.forEach((cb) => {
    try {
      cb(t, state.throttled);
    } catch {
      /* 监听器异常不阻塞分档链路 */
    }
  });
}
