/**
 * 同步协议（§8 oplog 格式 / tombstone / M2 预留）：
 * - oplog 结构 {opId, deviceId, lamportTs, entity, entityId, action, payload}
 * - Lamport 时钟：本地写 +1，合并取 max+1
 * - LWW 决胜：先比 lamportTs，平手比 deviceId 字典序
 * - 删除一律 deleted=true（tombstone），不物理删
 * M1 仅「outbox→上行」；M2 双向复用同结构（LWW M1 即接入 pull 合并）。
 */
import type { OplogEntry } from './types';

/** Lamport 时钟 */
export class LamportClock {
  private ts = 0;

  /** 本地写事件：+1 返回新值 */
  tick(): number {
    this.ts += 1;
    return this.ts;
  }

  /** 合并远端：取 max，再 +1 */
  observe(remote: number): number {
    if (remote > this.ts) this.ts = remote;
    return this.tick();
  }

  current(): number {
    return this.ts;
  }
}

/**
 * LWW 决胜：返回 true 表示 incoming 应覆盖 existing。
 * 规则：lamportTs 大者胜；平手 deviceId 字典序大者胜（稳定确定性）。
 */
export function lwwWins(
  incoming: { lamportTs: number; deviceId: string },
  existing: { lamportTs: number; deviceId: string },
): boolean {
  if (incoming.lamportTs !== existing.lamportTs) {
    return incoming.lamportTs > existing.lamportTs;
  }
  return incoming.deviceId >= existing.deviceId;
}

/** 生成 oplog 条目（op_id 幂等键 = uuid，客户端生成） */
export function makeOplog(
  opId: string,
  deviceId: string,
  lamportTs: number,
  entity: OplogEntry['entity'],
  entityId: string,
  action: OplogEntry['action'],
  payload: Record<string, unknown>,
): OplogEntry {
  return { opId, deviceId, lamportTs, entity, entityId, action, payload };
}

/** oplog → LocalOutbox 行（payloadJson 序列化） */
export function oplogToRow(op: OplogEntry): {
  opId: string;
  entity: string;
  entityId: string;
  action: string;
  payloadJson: string;
  lamportTs: number;
  attempts: number;
} {
  return {
    opId: op.opId,
    entity: op.entity,
    entityId: op.entityId,
    action: op.action,
    payloadJson: JSON.stringify(op.payload),
    lamportTs: op.lamportTs,
    attempts: 0,
  };
}

/** LocalOutbox 行 → oplog（payloadJson 反序列化） */
export function rowToOplog(row: {
  opId: string;
  entity: string;
  entityId: string;
  action: string;
  payloadJson: string;
  lamportTs: number;
}, deviceId: string): OplogEntry {
  let payload: Record<string, unknown> = {};
  try {
    payload = JSON.parse(row.payloadJson) as Record<string, unknown>;
  } catch {
    payload = {};
  }
  return {
    opId: row.opId,
    deviceId,
    lamportTs: row.lamportTs,
    entity: row.entity as OplogEntry['entity'],
    entityId: row.entityId,
    action: row.action as OplogEntry['action'],
    payload,
  };
}

/** 指数退避：1s → 2s → 4s … 60s 封顶（attempts 从 0 起） */
export function backoffMs(attempts: number): number {
  const raw = 1000 * Math.pow(2, Math.max(0, attempts));
  return Math.min(raw, 60 * 1000);
}

/** tombstone 标准化：payload 内 deleted 字段统一为 boolean */
export function withTombstone(payload: Record<string, unknown>, deleted: boolean): Record<string, unknown> {
  return { ...payload, deleted };
}
