/**
 * SyncSDK（FR-108）：outbox 批量上行、启动增量拉取、指数退避、op_id 幂等。
 * LWW 合并（pull 用 sync-protocol.lwwWins）。
 */
import type { DataBackend, Device, MemoryItem, Message, OplogEntry, Session, SyncSDK, TrajectoryEntry, UserConfig } from '@xw/shared';
import { LamportClock, backoffMs, rowToOplog, lwwWins } from '@xw/shared';
import {
  OutboxRepo,
  SyncCursor,
  OplogCursor,
  SessionRepo,
  MessageRepo,
  MemoryRepo,
  TrajectoryRepo,
  ConfigRepo,
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

function rowToMemory(r: Record<string, unknown>): MemoryItem {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    deviceId: String(r.device_id ?? ''),
    text: String(r.text ?? ''),
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Boolean(r.deleted),
    createdAt: String(r.created_at ?? ''),
  };
}

function rowToTrajectory(r: Record<string, unknown>): TrajectoryEntry {
  let steps: TrajectoryEntry['steps'] = [];
  try { steps = JSON.parse(String(r.steps ?? r.steps_json ?? '[]')) as TrajectoryEntry['steps']; } catch { steps = []; }
  return {
    id: String(r.id),
    userId: String(r.user_id),
    deviceId: String(r.device_id ?? ''),
    sessionId: r.session_id == null ? null : String(r.session_id),
    steps,
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Boolean(r.deleted),
    createdAt: String(r.created_at ?? ''),
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
        // 分组按 entity 批量：session/message 走 REST 材料化；
        // user_config/memory/trajectory 走 oplog syncPush（原缺陷：全误路由 upsertConfig 只写 localStorage，从未上云）
        const byEntity: Record<string, Record<string, unknown>[]> = { sessions: [], messages: [] };
        const oplogOps: OplogEntry[] = [];
        const opIds: string[] = [];
        for (const row of pending) {
          const op = rowToOplog(row, deps.deviceId);
          opIds.push(op.opId);
          const table = op.entity === 'session' ? 'sessions' : op.entity === 'message' ? 'messages' : null;
          if (!table) {
            if (op.entity === 'user_config') {
              // localStorage 镜像（离线读用）；真上云靠下方 syncPush
              try { await deps.backend.upsertConfig(op.payload as never); } catch { /* 镜像失败不阻塞上行 */ }
            }
            if (op.action === 'delete') {
              oplogOps.push({ ...op, payload: { ...(op.payload as Record<string, unknown>), deleted: true } });
            } else {
              oplogOps.push(op);
            }
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
          // oplog 上行（服务端 ENTITIES=user_config/memory/trajectory，op_id 幂等）
          if (oplogOps.length) {
            const be = deps.backend as unknown as { syncPush?: (ops: Record<string, unknown>[]) => Promise<unknown> };
            if (be.syncPush) await be.syncPush(oplogOps as unknown as Record<string, unknown>[]);
            else throw new Error('backend 不支持 syncPush，oplog 实体无法上行');
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
    // T04：memory / trajectory / user_config 合并分支（复用 lwwWins；oplog 增量游标拉取）
    const be = deps.backend as unknown as {
      syncPull?: (sinceLamport: number) => Promise<{ ops: Record<string, unknown>[]; latest: number }>;
      listMemories?: () => Promise<Record<string, unknown>[]>;
    };
    if (be.syncPull) {
      try {
        // 增量拉取：since=oplog 游标（原缺陷 syncPull(0) 每次全量重拉）
        const sinceLamport = await OplogCursor.get();
        const { ops, latest } = await be.syncPull(sinceLamport);
        let maxLamport = sinceLamport;
        for (const op of ops) {
          const entity = String(op.entity ?? '');
          const payload = (op.payload ?? {}) as Record<string, unknown>;
          const incomingMeta = { lamportTs: Number(op.lamportTs ?? 0), deviceId: String(op.deviceId ?? '') };
          if (Number(op.lamportTs ?? 0) > maxLamport) maxLamport = Number(op.lamportTs);
          if (entity === 'memory') {
            const incoming = rowToMemory({ ...payload, id: op.entityId, device_id: op.deviceId, lamport_ts: op.lamportTs });
            const existing = await MemoryRepo.getById(incoming.id);
            if (!existing || lwwWins(incomingMeta, { lamportTs: existing.lamportTs, deviceId: existing.deviceId })) {
              await MemoryRepo.upsertRemote(incoming);
              merged += 1;
            }
          } else if (entity === 'trajectory') {
            // LWW 决胜（原缺陷：无条件覆盖，本机新轨迹会被旧远端冲掉）
            const incoming = rowToTrajectory({ ...payload, id: op.entityId, device_id: op.deviceId, lamport_ts: op.lamportTs });
            const existing = await TrajectoryRepo.getById(incoming.id);
            if (!existing || lwwWins(incomingMeta, { lamportTs: existing.lamportTs, deviceId: existing.deviceId })) {
              await TrajectoryRepo.upsertRemote(incoming);
              merged += 1;
            }
          } else if (entity === 'user_config') {
            // 配置下行（原缺陷：pull 直接丢弃 user_config op）：LWW 后写 ConfigRepo + 刷新 store
            const incomingMeta2 = incomingMeta;
            const cfg = payload as unknown as { userId?: string; lamportTs?: number; deviceId?: string; updatedAt?: string; deviceIdLast?: string };
            const userId = String(cfg.userId ?? '');
            if (userId) {
              const existing = await ConfigRepo.get(userId);
              if (!existing || lwwWins(incomingMeta2, { lamportTs: existing.lamportTs, deviceId: existing.deviceId })) {
                const next = {
                  ...(cfg as object),
                  userId,
                  lamportTs: incomingMeta2.lamportTs,
                  deviceId: cfg.deviceId ?? 'cloud',
                  deviceIdLast: cfg.deviceId ?? 'cloud',
                  updatedAt: cfg.updatedAt ?? new Date().toISOString(),
                } as UserConfig;
                await ConfigRepo.upsertRemote(next);
                merged += 1;
              }
            }
          }
        }
        await OplogCursor.set(Number(latest) > maxLamport ? Number(latest) : maxLamport);
      } catch (e) {
        log.warn('pull memory/trajectory skipped', e);
      }
    } else if (be.listMemories) {
      try {
        const mems = await be.listMemories();
        for (const r of mems) {
          const incoming = rowToMemory(r);
          await MemoryRepo.upsertRemote(incoming);
          merged += 1;
        }
      } catch (e) {
        log.warn('listMemories skipped', e);
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
