/**
 * RemoteSDK — 手机端 MQTT 指令通道封装（T04）
 * connect(room, pairCode) / send(cmd, args) / onMessage(cb) / disconnect()
 * 自动附鉴权四件套 pc/ts/nonce/reqId（shared/remote-protocol.buildAuth）；5s 自动重连；
 * 1对1 抢占握手：connect 后自动发 ctrl_claim，被拒回 XW5005。
 * 红线：pairCode 只在内存持有（不落 localStorage/云表）；断开即丢弃。
 */
import mqtt, { type MqttClient } from 'mqtt';
import {
  buildAuth,
  newId,
  topicToPc,
  topicToPhone,
  type RemoteCmd,
  type RemoteReply,
} from '@xw/shared';

export type RemoteMessageCb = (msg: RemoteReply) => void;

const RECONNECT_MS = 5000;
const SEND_TIMEOUT_MS = 30 * 1000;

export class RemoteSDK {
  private client: MqttClient | null = null;
  private pairCode = '';
  private room = '';
  private deviceId = '';
  private cbs: RemoteMessageCb[] = [];
  private pending = new Map<string, (r: RemoteReply) => void>();

  /** 连接 MQTT 并订阅 to-phone；成功后自动 ctrl_claim 抢占 */
  async connect(room: string, pairCode: string, deviceId = ''): Promise<{ ok: boolean; reason?: string }> {
    this.disconnect();
    this.room = String(room || '');
    this.pairCode = String(pairCode || ''); // 只留内存
    this.deviceId = deviceId || 'phone-' + newId().slice(0, 8);
    if (!this.room || !this.pairCode) return { ok: false, reason: 'XW5001 房间号或配对码缺失' };
    const url = String((globalThis as Record<string, unknown>).__XW_MQTT_URL__ || 'wss://mqtt.example.com/mqtt');
    return new Promise((resolve) => {
      const client = mqtt.connect(url, {
        clientId: 'ph-' + Math.random().toString(16).slice(2),
        clean: true,
        reconnectPeriod: RECONNECT_MS,
        connectTimeout: 8000,
      });
      this.client = client;
      client.on('connect', () => {
        client.subscribe(topicToPhone(this.room));
        // 1对1 抢占握手（Q4）
        this.send('ctrl_claim', { deviceId: this.deviceId }).then((r) => {
          if (r && r.ok === false && r.denied) {
            this.emit({ type: 'deny', reqId: r.reqId || '', denied: true, reason: 'XW5005 遥控被抢占' });
          }
        });
        resolve({ ok: true });
      });
      client.on('message', (_topic, payload) => {
        try {
          const msg = JSON.parse(payload.toString()) as RemoteReply;
          const p = this.pending.get(msg.reqId);
          if (p && (msg.type === 'reply' || msg.type === 'deny')) {
            this.pending.delete(msg.reqId);
            p(msg);
          }
          this.emit(msg);
        } catch { /* 非法消息丢弃 */ }
      });
      client.on('error', (e: Error) => {
        if (!client.connected) resolve({ ok: false, reason: 'XW5001 ' + e.message });
      });
    });
  }

  /**
   * 发送指令（自动附鉴权四件套），等待 type=reply|deny 回流。
   * 超时 30s 回 XW5006；未连接回 XW5001。
   */
  send(cmd: string, args?: Record<string, unknown>): Promise<RemoteReply> {
    const client = this.client;
    if (!client || !client.connected) {
      return Promise.resolve({ type: 'deny', reqId: '', ok: false, denied: true, reason: 'XW5001 远程未连接' });
    }
    const auth = buildAuth(this.pairCode);
    const body: RemoteCmd = { ...auth, cmd, args };
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        this.pending.delete(auth.reqId);
        resolve({ type: 'deny', reqId: auth.reqId, ok: false, denied: true, reason: 'XW5006 指令超时' });
      }, SEND_TIMEOUT_MS);
      this.pending.set(auth.reqId, (r) => {
        clearTimeout(timer);
        resolve(r);
      });
      client.publish(topicToPc(this.room), JSON.stringify(body));
    });
  }

  /** 回流订阅（reply/step/delta/screenshot/file/presence/confirm/deny） */
  onMessage(cb: RemoteMessageCb): () => void {
    this.cbs.push(cb);
    return () => {
      this.cbs = this.cbs.filter((x) => x !== cb);
    };
  }

  private emit(msg: RemoteReply): void {
    for (const cb of this.cbs) {
      try { cb(msg); } catch { /* 单订阅者异常不影响其他 */ }
    }
  }

  isConnected(): boolean {
    return !!this.client && this.client.connected;
  }

  disconnect(): void {
    if (this.client) {
      try { this.client.end(true); } catch { /* ignore */ }
      this.client = null;
    }
    this.pending.clear();
    this.pairCode = ''; // 断开即丢弃（红线）
  }
}

export const remoteSdk = new RemoteSDK();
