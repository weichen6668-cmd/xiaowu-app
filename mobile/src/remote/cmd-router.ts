/**
 * cmd-router — 回流消息分发（T04）
 * remote-sdk.onMessage → 本路由 → 对应 store 动作：
 *   reply/step/delta/screenshot/file/presence/config-changed/confirm/deny
 * ConfirmDialog 消费 remoteStore.confirms；deviceStore 更新在线状态。
 */
import type { RemoteReply, TrajectoryStep, DeviceInfo } from '@xw/shared';
import { remoteSdk } from './remote-sdk';
import { unwrapReply } from './remote-api';
import { useRemoteStore } from '../store/remoteStore';
import { useDeviceStore } from '../store/deviceStore';

type ConfigSection = 'llm' | 'asr' | 'tts' | 'remote';

let onConfigChanged: ((section: ConfigSection) => void) | null = null;
let onDenied: ((reason: string) => void) | null = null;

/** 注入配置变更回调（SettingsPage 用） */
export function setConfigChangedHandler(fn: ((section: ConfigSection) => void) | null): void {
  onConfigChanged = fn;
}

/** 注入 deny 回调（ChatPage 错误上屏用） */
export function setDeniedHandler(fn: ((reason: string) => void) | null): void {
  onDenied = fn;
}

/** 分发单条回流消息 */
export function routeRemoteMessage(msg: RemoteReply): void {
  if (!msg || typeof msg !== 'object') return;
  const rs = useRemoteStore.getState();
  const ds = useDeviceStore.getState();
  const p = msg.payload || {};
  switch (msg.type) {
    case 'reply': {
      // 归一信封：payload.result.text / payload.text / 顶层 text（voice 命令 ASR 回显）都可读
      const d = unwrapReply(msg);
      const text = typeof d.text === 'string' ? d.text
        : (d.result && typeof (d.result as { text?: unknown }).text === 'string' ? (d.result as { text: string }).text : '');
      const asrText = typeof d.asrText === 'string' ? d.asrText : undefined;
      if (text || asrText) rs.setReply(text, asrText);
      // 截图命令结果也走 reply 平铺返回（{ok, screenshot:{imageB64}}）→ 落截图卡片
      const shot = d.screenshot as { imageB64?: string } | undefined;
      if (shot && typeof shot.imageB64 === 'string') rs.setScreenshot(shot.imageB64);
      break;
    }
    case 'step': {
      const step = p.step as unknown as TrajectoryStep | undefined;
      if (step && typeof step.seq === 'number') rs.pushStep(step);
      break;
    }
    case 'delta': {
      rs.appendDelta(String(p.text || ''));
      break;
    }
    case 'screenshot': {
      // 两种形状：payload.imageB64（标准信封）或 顶层 screenshot.imageB64（桌面平铺返回）
      const d = unwrapReply(msg);
      const shot = d.screenshot as { imageB64?: string } | undefined;
      const b64 = typeof d.imageB64 === 'string' ? d.imageB64 : String((shot && shot.imageB64) || '');
      rs.setScreenshot(b64);
      break;
    }
    case 'file': {
      rs.pushFile({
        name: String(p.name || 'file'),
        size: Number(p.size) || 0,
        mime: String(p.mime || ''),
        url: typeof p.url === 'string' ? p.url : undefined,
        b64: typeof p.b64 === 'string' ? p.b64 : undefined,
      });
      break;
    }
    case 'presence': {
      const online = !!p.online;
      const deviceId = String(p.deviceId || '');
      const devices = ds.devices.map((d: DeviceInfo) =>
        d.id === deviceId ? { ...d, online, lastSeenAt: new Date(Number(p.ts) || Date.now()).toISOString() } : d,
      );
      useDeviceStore.setState({ devices });
      break;
    }
    case 'config-changed': {
      const section = String(p.section || 'llm') as ConfigSection;
      if (onConfigChanged) {
        try { onConfigChanged(section); } catch { /* 回调异常不影响路由 */ }
      }
      break;
    }
    case 'confirm': {
      rs.pushConfirm({
        confirmReqId: String(msg.reqId || p.confirmReqId || ''),
        action: String(p.action || ''),
        detail: String(p.detail || ''),
        timeoutSec: Number(p.timeoutSec) || 30,
      });
      break;
    }
    case 'deny': {
      const reason = String(msg.reason || 'XW5005 遥控被拒绝');
      if (/抢占/.test(reason)) rs.setPreempted(reason);
      if (onDenied) {
        try { onDenied(reason); } catch { /* 回调异常不影响路由 */ }
      }
      break;
    }
    default:
      break;
  }
}

/* 回流接线（幂等单订阅）：import 本模块即生效；ChatPage 等入口副作用导入触发 */
let installed = false;
export function installCmdRouter(): void {
  if (installed) return;
  installed = true;
  remoteSdk.onMessage((msg) => routeRemoteMessage(msg));
}
installCmdRouter();
