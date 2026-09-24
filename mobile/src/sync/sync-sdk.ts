/**
 * SyncSDK（FR-108）：outbox 批量上行、启动增量拉取、指数退避、op_id 幂等。
 * LWW 合并（pull 用 sync-protocol.lwwWins）。
 */
import type { DataBackend, Device, Message, OplogEntry, Session, SyncSDK } from '@xw/shared';
import { LamportClock, backoffMs, rowToOplog, lwwWins } from '@xw/shared';
import {
  OutboxRepo,
  SyncCursor,
  SessionRepo,
  MessageRepo,
  markSynced,
  findRow,
} from '../db/repo';
import { log } from '../platform/log';

export interface SyncDeps {
  backend: DataBackend;
  deviceId: string;
  /** 网络状态钩子 */
  isOnline: () => boolean;
  /** 同步完成回调（UI 刷新） */
  onSyncDone?: (merged: number) => void;
}

/** snake_case 行 → Session */
function rowToSession(r: Record<string, unknown>): Session {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    deviceId: String(r.device_id),
    title: String(r.title ?? ''),
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Boolean(r.deleted),
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToMessage(r: Record<string, unknown>): Message {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    userId: String(r.user_id),
    deviceId: String(r.device_id),
    role: String(r.role) as 'user' | 'assistant',
    content: String(r.content ?? ''),
    skillHint: r.skill_hint == null ? null : String(r.skill_hint),
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Boolean(r.deleted),
    createdAt: String(r.created_at),
  };
}

export function createSyncSDK(deps: SyncDeps): SyncSDK & { getClock(): LamportClock } {
  const clock = new LamportClock();
  let flushing = false;
  let autoTimer: ReturnType<typeof setInterval> | null = null;

  async function flush(): Promise<void> {
    if (flushing) return;
    flushing = true;
    try {
      for (;;) {
        const pending = await OutboxRepo.pending(20);
        if (!pending.length) break;
        // 分组按 entity 批量
        const byEntity: Record<string, Record<string, unknown>[]> = { sessions: [], messages: [] };
        const opIds: string[] = [];
        for (const row of pending) {
          const op = rowToOplog(row, deps.deviceId);
          opIds.push(op.opId);
          const table = op.entity === 'session' ? 'sessions' : op.entity === 'message' ? 'messages' : null;
          if (!table) {
            // user_config 单独走 upsertConfig（payload 即 UserConfig 行）
            const cfg = op.payload as never;
            await deps.backend.upsertConfig(cfg);
            continue;
          }
          if (op.action === 'delete') {
            // tombstone：payload.deleted=true，upsert 即可
            byEntity[table].push({ ...op.payload, deleted: true, id: op.entityId });
          } else {
            byEntity[table].push({ ...op.payload, id: op.entityId });
          }
        }
        try {
          for (const table of ['sessions', 'messages'] as const) {
            if (byEntity[table].length) {
              await deps.backend.upsertRows(table, byEntity[table]);
              await markSynced(table, byEntity[table].map((r) => String(r.id)));
            }
          }
          for (const id of opIds) await OutboxRepo.remove(id);
        } catch (e) {
          log.warn('flush failed, backoff', e);
          for (const id of opIds) await OutboxRepo.bumpAttempts(id);
          break;
        }
        if (!deps.isOnline()) break;
      }
    } finally {
      flushing = false;
    }
  }

  async function pullIncremental(): Promise<number> {
    const since = await SyncCursor.get();
    let merged = 0;
    for (const table of ['sessions', 'messages'] as const) {
      const rows = await deps.backend.fetchSince(table, since);
      for (const r of rows) {
        const incoming = table === 'sessions' ? rowToSession(r) : rowToMessage(r);
        // LWW 决胜（M2 预留，M1 即接入）：existing 按 id 全量查（不带 dirty 过滤）
        const existingRaw = await findRow(table, incoming.id);
        const existing = existingRaw
          ? table === 'sessions'
            ? rowToSession(existingRaw)
            : rowToMessage(existingRaw)
          : null;
        if (!existing || lwwWins({ lamportTs: incoming.lamportTs, deviceId: incoming.deviceId },
          { lamportTs: existing.lamportTs, deviceId: existing.deviceId })) {
          if (table === 'sessions') await SessionRepo.upsertRemote(incoming as Session);
          else await MessageRepo.upsertRemote(incoming as Message);
          merged += 1;
        }
      }
    }
    await SyncCursor.set(new Date().toISOString());
    return merged;
  }

  return {
    getClock: () => clock,

    async enqueue(op: Omit<OplogEntry, 'opId' | 'lamportTs'>): Promise<void> {
      const opId = crypto.randomUUID();
      const lamportTs = clock.tick();
      await OutboxRepo.enqueue({
        opId,
        entity: op.entity,
        entityId: op.entityId,
        action: op.action,
        payloadJson: JSON.stringify(op.payload),
        lamportTs,
      });
    },

    flush,

    pullIncremental,

    startAuto(): void {
      // 启动即清残留 + 拉取
      void flush().then(() => pullIncremental()).then((n) => deps.onSyncDone?.(n));
      // 周期性（30s）+ 网络恢复触发
      if (autoTimer) clearInterval(autoTimer);
      autoTimer = setInterval(() => {
        if (!deps.isOnline()) return;
        void flush().then(() => pullIncremental()).then((n) => {
          if (n > 0) deps.onSyncDone?.(n);
        });
      }, 30_000);
    },
  };
}

export type { Device };
