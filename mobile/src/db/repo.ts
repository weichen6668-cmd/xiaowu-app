/**
 * 仓储层：SessionRepo / MessageRepo / ConfigRepo / OutboxRepo。
 * 语义对齐 services/sessions.js（桌面 JSON 版），存储换 SQLite。
 * 全部 CRUD 走 @capacitor-community/sqlite；Web 预览下走内存 Map 降级（dev/mock 可跑）。
 */
import type { LocalOutbox, MemoryItem, Message, Session, TrajectoryEntry, UserConfig } from '@xw/shared';
import { SCHEMA_VERSION, allDdl, MIGRATIONS } from './schema';

type SqlRow = Record<string, unknown>;

/** SQLite 执行接口（Capacitor 插件 or 内存降级） */
export interface SqlExec {
  run(sql: string, params?: unknown[]): Promise<void>;
  query(sql: string, params?: unknown[]): Promise<SqlRow[]>;
}

/* ============ 内存降级实现（Web dev / 单测；真机走原生 SQLite） ============ */

class MemoryDb implements SqlExec {
  private tables = new Map<string, SqlRow[]>();

  private tableOf(sql: string): SqlRow[] {
    const m = /(?:from|into|update)\s+(\w+)/i.exec(sql);
    const name = (m && m[1]) || 'misc';
    if (!this.tables.has(name)) this.tables.set(name, []);
    return this.tables.get(name) as SqlRow[];
  }

  async run(sql: string, params: unknown[] = []): Promise<void> {
    const rows = this.tableOf(sql);
    const s = sql.toLowerCase();
    if (s.startsWith('insert') || s.startsWith('insert or replace')) {
      const row: SqlRow = {};
      const cols = /\(([^)]+)\)/.exec(sql);
      const keys = cols ? cols[1].split(',').map((k) => k.trim()) : [];
      // 值列表逐项解析：字面量（数字/带引号串/now()）按值本身、`?` 按序取 params（一个游标）
      const valuesMatch = /values\s*\(([^)]+)\)/i.exec(sql);
      const items = valuesMatch
        ? valuesMatch[1].split(',').map((v) => v.trim())
        : keys.map(() => '?');
      let cursor = 0;
      keys.forEach((k, i) => {
        const raw = items[i] ?? '?';
        if (raw === '?') {
          row[k] = params[cursor];
          cursor += 1;
        } else if (raw === 'now()') {
          row[k] = new Date().toISOString();
        } else if (/^'.*'$/.test(raw)) {
          row[k] = raw.slice(1, -1);
        } else if (raw === 'null') {
          row[k] = null;
        } else {
          row[k] = Number(raw);
        }
      });
      const pk = keys[0];
      const exist = rows.findIndex((r) => r[pk] === row[pk]);
      if (exist >= 0 && s.includes('replace')) rows[exist] = row;
      else rows.push(row);
      return;
    }
    if (s.startsWith('update')) {
      const setMatch = /set\s+(.+?)(?:\s+where|$)/i.exec(sql);
      const whereMatch = /where\s+(.+)$/i.exec(sql);
      const assignments = setMatch ? setMatch[1].split(',').map((a) => a.trim()).filter(Boolean) : [];
      // SET 子句 ? 参数个数（WHERE 参数在其后）
      const setQ = assignments.filter((a) => /=\s*\?\s*$/.test(a)).length;
      for (const r of rows) {
        if (!whereMatch || this.matchWhere(r, whereMatch[1], params, setQ)) {
          // 三类赋值：? 取参 / 纯数字字面量 / col = col + n 自增；now() 保持
          let setCursor = 0;
          for (const a of assignments) {
            const eq = a.indexOf('=');
            if (eq < 0) continue;
            const k = a.slice(0, eq).trim();
            const v = a.slice(eq + 1).trim();
            if (v === '?') {
              r[k] = params[setCursor];
              setCursor += 1;
            } else if (v === 'now()') {
              r[k] = new Date().toISOString();
            } else if (/^'.*'$/.test(v)) {
              r[k] = v.slice(1, -1);
            } else if (v === 'null') {
              r[k] = null;
            } else {
              const inc = /^(\w+)\s*\+\s*(\d+)$/.exec(v);
              if (inc && inc[1] === k) {
                r[k] = Number(r[k] ?? 0) + Number(inc[2]);
              } else if (/^-?\d+$/.test(v)) {
                r[k] = Number(v);
              } else {
                r[k] = v;
              }
            }
          }
        }
      }
      return;
    }
    if (s.startsWith('delete')) {
      const whereMatch = /where\s+(.+)$/i.exec(sql);
      const kept = rows.filter((r) => !(whereMatch && this.matchWhere(r, whereMatch[1], params)));
      this.tables.set(
        (/(?:from)\s+(\w+)/i.exec(sql) || [, 'misc'])[1],
        kept,
      );
      return;
    }
  }

  private matchWhere(row: SqlRow, where: string, params: unknown[], paramOffset = 0): boolean {
    const parts = where.split(/and/i).map((p) => p.trim());
    // WHERE 的 ? 从 paramOffset 开始按序消费（SET 参数在前已占位）
    let pi = paramOffset;
    const results = parts.map((p) => {
      const m = /(\w+)\s*(=|>=|<=|>|<)\s*(\?|'[^']*'|\d+)/.exec(p);
      if (!m) return true;
      const [, col, op, valRaw] = m;
      let val: unknown;
      if (valRaw === '?') {
        val = params[pi];
        pi += 1;
      } else {
        val = valRaw.replace(/'/g, '');
      }
      const rv = row[col];
      switch (op) {
        case '=':
          return String(rv) === String(val);
        case '>=':
          return String(rv) >= String(val);
        case '<=':
          return String(rv) <= String(val);
        case '>':
          return String(rv) > String(val);
        case '<':
          return String(rv) < String(val);
        default:
          return true;
      }
    });
    return results.every(Boolean);
  }

  async query(sql: string, params: unknown[] = []): Promise<SqlRow[]> {
    const rows = this.tableOf(sql);
    const whereMatch = /where\s+(.+?)(?:order by|limit|$)/i.exec(sql);
    let out = rows.filter((r) => !whereMatch || this.matchWhere(r, whereMatch[1], params.slice()));
    const orderMatch = /order by\s+(\w+)\s*(desc|asc)?/i.exec(sql);
    if (orderMatch) {
      const [, col, dir] = orderMatch;
      out = out.slice().sort((a, b) => {
        const x = String(a[col] ?? '');
        const y = String(b[col] ?? '');
        return dir && dir.toLowerCase() === 'desc' ? y.localeCompare(x) : x.localeCompare(y);
      });
    }
    const limitMatch = /limit\s+(\d+)/i.exec(sql);
    if (limitMatch) out = out.slice(0, Number(limitMatch[1]));
    return out.map((r) => ({ ...r }));
  }
}

/* ============ 数据库单例 ============ */

let db: SqlExec | null = null;
let memFallback: MemoryDb | null = null;

/** 打开本地库：优先 Capacitor SQLite，Web 环境降级内存表（dev 可跑） */
export async function openDb(): Promise<SqlExec> {
  if (db) return db;
  try {
    // 动态 import：Web dev 无原生插件时走降级
    const capMod = await import('@capacitor-community/sqlite');
    const sqlite = capMod.CapacitorSQLite;
    const isNative = (await import('@capacitor/core')).Capacitor.isNativePlatform();
    if (isNative) {
      await sqlite.createConnection({ database: 'xiaowu', encrypted: false, mode: 'no-encryption' });
      await sqlite.open({ database: 'xiaowu' });
      db = {
        async run(sql, params = []) {
          // T05S 根因修复：必须用 run({statement, values}) 绑参。
          // execute({statements}) 的 capSQLiteExecuteOptions 没有 values 字段——
          // 传了也会被插件静默丢弃，SQL 的 ? 全绑 NULL，user_config.user_id 落 NULL，
          // 启动 get(userId) 查不到 → 默认值覆盖用户改动（设置保存丢失）。
          await sqlite.run({ database: 'xiaowu', statement: sql, values: params as never[] });
        },
        async query(sql, params = []) {
          const r = await sqlite.query({ database: 'xiaowu', statement: sql, values: params as never[] });
          return (r.values || []) as SqlRow[];
        },
      };
      for (const ddl of allDdl()) {
        await db.run(ddl);
      }
      // v3 增量：旧库补列（已存在则抛 duplicate column，逐条吞掉）
      for (const sql of MIGRATIONS) {
        try {
          await db.run(sql);
        } catch { /* 列已存在 */ }
      }
      await db.run('insert or replace into schema_meta (key, value) values (?, ?)', [
        'version',
        String(SCHEMA_VERSION),
      ]);
      return db;
    }
  } catch {
    /* fallthrough → 内存降级 */
  }
  memFallback = memFallback || new MemoryDb();
  db = memFallback;
  for (const ddl of allDdl()) {
    await db.run(ddl);
  }
  for (const sql of MIGRATIONS) {
    try {
      await db.run(sql);
    } catch { /* 列已存在 */ }
  }
  return db;
}

function nowIso(): string {
  return new Date().toISOString();
}

function uuid(): string {
  const c = globalThis.crypto as { randomUUID?: () => string };
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, (ch) => {
    const r = (Math.random() * 16) | 0;
    const v = ch === 'x' ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

/* ============ 行映射 ============ */

function rowToSession(r: SqlRow): Session {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    deviceId: String(r.device_id),
    title: String(r.title ?? ''),
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Number(r.deleted ?? 0) === 1,
    createdAt: String(r.created_at),
    updatedAt: String(r.updated_at),
  };
}

function rowToMessage(r: SqlRow): Message {
  return {
    id: String(r.id),
    sessionId: String(r.session_id),
    userId: String(r.user_id),
    deviceId: String(r.device_id),
    role: String(r.role) as 'user' | 'assistant',
    content: String(r.content ?? ''),
    skillHint: r.skill_hint == null ? null : String(r.skill_hint),
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Number(r.deleted ?? 0) === 1,
    createdAt: String(r.created_at),
  };
}

function rowToConfig(r: SqlRow): UserConfig {
  return {
    userId: String(r.user_id),
    deviceId: String(r.device_id ?? ''),
    avatarModel: String(r.avatar_model ?? 'mage-a') as 'mage-a' | 'mage-b',
    llmProvider: String(r.llm_provider ?? 'custom'),
    llmBaseUrl: String(r.llm_base_url ?? ''),
    llmModel: String(r.llm_model ?? ''),
    asrProvider: String(r.asr_provider ?? 'openai'),
    asrBaseUrl: String(r.asr_base_url ?? ''),
    asrModel: r.asr_model == null ? '' : String(r.asr_model),
    asrAppid: r.asr_appid == null ? '' : String(r.asr_appid),
    asrCluster: r.asr_cluster == null ? '' : String(r.asr_cluster),
    ttsProvider: String(r.tts_provider ?? 'mimo'),
    ttsBaseUrl: String(r.tts_base_url ?? ''),
    ttsModel: r.tts_model == null ? '' : String(r.tts_model),
    ttsAppid: r.tts_appid == null ? '' : String(r.tts_appid),
    ttsVoice: String(r.tts_voice ?? '白桦'),
    ttsEnabled: r.tts_enabled == null ? true : Number(r.tts_enabled) !== 0,
    lamportTs: Number(r.lamport_ts ?? 0),
    updatedAt: String(r.updated_at ?? nowIso()),
    deviceIdLast: String(r.device_id_last ?? ''),
  };
}

/* ============ SessionRepo ============ */

export const SessionRepo = {
  /** 列表（不含 tombstone），时间倒序 */
  async list(userId: string): Promise<Session[]> {
    const d = await openDb();
    const rows = await d.query(
      'select * from sessions where user_id = ? and deleted = 0 order by updated_at desc',
      [userId],
    );
    return rows.map(rowToSession);
  },

  async get(id: string): Promise<Session | null> {
    const d = await openDb();
    const rows = await d.query('select * from sessions where id = ?', [id]);
    return rows.length ? rowToSession(rows[0]) : null;
  },

  /** 新建会话（uuid 客户端生成） */
  async create(userId: string, deviceId: string, title: string): Promise<Session> {
    const d = await openDb();
    const t = nowIso();
    const s: Session = {
      id: uuid(),
      userId,
      deviceId,
      title: title.slice(0, 30),
      lamportTs: 0,
      deleted: false,
      createdAt: t,
      updatedAt: t,
    };
    await d.run(
      `insert into sessions (id, user_id, device_id, title, lamport_ts, deleted, created_at, updated_at, dirty)
       values (?, ?, ?, ?, 0, 0, ?, ?, 1)`,
      [s.id, s.userId, s.deviceId, s.title, s.createdAt, s.updatedAt],
    );
    return s;
  },

  /** 更新标题/时间 + dirty 标记 */
  async touch(id: string, title?: string): Promise<void> {
    const d = await openDb();
    await d.run(
      `update sessions set title = ?, updated_at = ?, dirty = 1 where id = ?`,
      [title ?? '', nowIso(), id],
    );
  },

  /** tombstone 软删（FR-109）：deleted=1 + dirty */
  async softDelete(id: string): Promise<void> {
    const d = await openDb();
    await d.run('update sessions set deleted = 1, dirty = 1, updated_at = ? where id = ?', [nowIso(), id]);
  },

  /** 合并云端行（LWW 由 sync 层判定后调用） */
  async upsertRemote(row: Session): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into sessions
       (id, user_id, device_id, title, lamport_ts, deleted, created_at, updated_at, dirty, last_synced_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        row.id,
        row.userId,
        row.deviceId,
        row.title,
        row.lamportTs,
        row.deleted ? 1 : 0,
        row.createdAt,
        row.updatedAt,
        nowIso(),
      ],
    );
  },
};

/* ============ MessageRepo ============ */

export const MessageRepo = {
  /** 某会话消息（分页，默认 50） */
  async listBySession(sessionId: string, limit = 50): Promise<Message[]> {
    const d = await openDb();
    const rows = await d.query(
      'select * from messages where session_id = ? and deleted = 0 order by created_at asc limit ?',
      [sessionId, limit],
    );
    return rows.map(rowToMessage);
  },

  async create(msg: Omit<Message, 'id' | 'createdAt'> & { id?: string }): Promise<Message> {
    const d = await openDb();
    const full: Message = {
      id: msg.id || uuid(),
      sessionId: msg.sessionId,
      userId: msg.userId,
      deviceId: msg.deviceId,
      role: msg.role,
      content: msg.content,
      skillHint: msg.skillHint ?? null,
      lamportTs: msg.lamportTs,
      deleted: false,
      createdAt: nowIso(),
    };
    await d.run(
      `insert into messages (id, session_id, user_id, device_id, role, content, skill_hint, lamport_ts, deleted, created_at, dirty)
       values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?, 1)`,
      [
        full.id,
        full.sessionId,
        full.userId,
        full.deviceId,
        full.role,
        full.content,
        full.skillHint,
        full.lamportTs,
        full.createdAt,
      ],
    );
    return full;
  },

  async softDelete(id: string): Promise<void> {
    const d = await openDb();
    await d.run('update messages set deleted = 1, dirty = 1 where id = ?', [id]);
  },

  async upsertRemote(row: Message): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into messages
       (id, session_id, user_id, device_id, role, content, skill_hint, lamport_ts, deleted, created_at, dirty, last_synced_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [
        row.id,
        row.sessionId,
        row.userId,
        row.deviceId,
        row.role,
        row.content,
        row.skillHint,
        row.lamportTs,
        row.deleted ? 1 : 0,
        row.createdAt,
        nowIso(),
      ],
    );
  },
};

/* ============ ConfigRepo ============ */

export const ConfigRepo = {
  async get(userId: string): Promise<UserConfig | null> {
    const d = await openDb();
    const rows = await d.query('select * from user_config where user_id = ?', [userId]);
    return rows.length ? rowToConfig(rows[0]) : null;
  },

  async upsert(cfg: UserConfig): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into user_config
       (user_id, device_id, avatar_model, llm_provider, llm_base_url, llm_model,
        asr_provider, asr_base_url, asr_model, asr_appid, asr_cluster,
        tts_provider, tts_base_url, tts_model, tts_appid, tts_voice, tts_enabled,
        lamport_ts, updated_at, device_id_last, dirty)
       values (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [
        cfg.userId,
        cfg.deviceId,
        cfg.avatarModel,
        cfg.llmProvider,
        cfg.llmBaseUrl,
        cfg.llmModel,
        cfg.asrProvider,
        cfg.asrBaseUrl,
        cfg.asrModel || '',
        cfg.asrAppid || '',
        cfg.asrCluster || '',
        cfg.ttsProvider,
        cfg.ttsBaseUrl,
        cfg.ttsModel || '',
        cfg.ttsAppid || '',
        cfg.ttsVoice,
        cfg.ttsEnabled === false ? 0 : 1,
        cfg.lamportTs,
        cfg.updatedAt,
        cfg.deviceIdLast,
      ],
    );
  },

  async upsertRemote(cfg: UserConfig): Promise<void> {
    await this.upsert(cfg);
    const d = await openDb();
    await d.run('update user_config set dirty = 0, last_synced_at = ? where user_id = ?', [
      nowIso(),
      cfg.userId,
    ]);
  },
};

/* ============ OutboxRepo（op_id 幂等） ============ */

export const OutboxRepo = {
  /** 入队（op_id 主键，重复 insert or replace 不双写） */
  async enqueue(op: Omit<LocalOutbox, 'attempts'>): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into local_outbox (op_id, entity, entity_id, action, payload_json, lamport_ts, attempts)
       values (?, ?, ?, ?, ?, ?, 0)`,
      [op.opId, op.entity, op.entityId, op.action, op.payloadJson, op.lamportTs],
    );
  },

  /** 取待传（按 lamport 顺序，保证因果） */
  async pending(limit = 50): Promise<LocalOutbox[]> {
    const d = await openDb();
    const rows = await d.query('select * from local_outbox order by lamport_ts asc limit ?', [limit]);
    return rows.map((r) => ({
      opId: String(r.op_id),
      entity: String(r.entity) as LocalOutbox['entity'],
      entityId: String(r.entity_id),
      action: String(r.action) as LocalOutbox['action'],
      payloadJson: String(r.payload_json),
      lamportTs: Number(r.lamport_ts ?? 0),
      attempts: Number(r.attempts ?? 0),
    }));
  },

  /** 成功后出队（幂等删除） */
  async remove(opId: string): Promise<void> {
    const d = await openDb();
    await d.run('delete from local_outbox where op_id = ?', [opId]);
  },

  /** 失败退避计数 +1 */
  async bumpAttempts(opId: string): Promise<void> {
    const d = await openDb();
    await d.run('update local_outbox set attempts = attempts + 1 where op_id = ?', [opId]);
  },
};

/* ============ 同步游标（last_synced_at） ============ */

export const SyncCursor = {
  async get(): Promise<string> {
    const d = await openDb();
    const rows = await d.query("select value from schema_meta where key = 'last_synced_at'");
    return rows.length ? String(rows[0].value) : '1970-01-01T00:00:00.000Z';
  },

  async set(iso: string): Promise<void> {
    const d = await openDb();
    await d.run("insert or replace into schema_meta (key, value) values ('last_synced_at', ?)", [iso]);
  },
};

/** oplog lamport 游标（syncPull 增量拉取用；与 ISO 游标分槽互不干扰） */
export const OplogCursor = {
  async get(): Promise<number> {
    const d = await openDb();
    const rows = await d.query("select value from schema_meta where key = 'oplog_lamport'");
    return rows.length ? Number(rows[0].value) || 0 : 0;
  },

  async set(lamport: number): Promise<void> {
    const d = await openDb();
    await d.run("insert or replace into schema_meta (key, value) values ('oplog_lamport', ?)", [String(Math.floor(lamport))]);
  },
};

/** 标记 entities 已同步（dirty=0, last_synced_at=now） */
export async function markSynced(table: 'sessions' | 'messages', ids: string[]): Promise<void> {
  const d = await openDb();
  for (const id of ids) {
    const pk = table === 'sessions' ? 'id' : 'id';
    await d.run(`update ${table} set dirty = 0, last_synced_at = ? where ${pk} = ?`, [nowIso(), id]);
  }
}

/** 取 dirty=1 的行（待上云） */
export async function dirtyRows(table: 'sessions' | 'messages'): Promise<SqlRow[]> {
  const d = await openDb();
  return d.query(`select * from ${table} where dirty = 1 limit 100`);
}

/** 按 id 全量查行（不带 dirty 过滤，LWW 合并用） */
export async function findRow(table: 'sessions' | 'messages', id: string): Promise<SqlRow | null> {
  const d = await openDb();
  const rows = await d.query(`select * from ${table} where id = ?`, [id]);
  return rows.length ? rows[0] : null;
}

/* ============ v2 新增：MemoryRepo / TrajectoryRepo（LWW + tombstone） ============ */

function rowToMemory(r: SqlRow): MemoryItem {
  return {
    id: String(r.id),
    userId: String(r.user_id),
    deviceId: String(r.device_id ?? ''),
    text: String(r.text ?? ''),
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Number(r.deleted ?? 0) !== 0,
    createdAt: String(r.created_at ?? ''),
  };
}

function rowToTrajectory(r: SqlRow): TrajectoryEntry {
  let steps: TrajectoryEntry['steps'] = [];
  try { steps = JSON.parse(String(r.steps_json ?? '[]')) as TrajectoryEntry['steps']; } catch { steps = []; }
  return {
    id: String(r.id),
    userId: String(r.user_id),
    deviceId: String(r.device_id ?? ''),
    sessionId: r.session_id == null ? null : String(r.session_id),
    steps,
    lamportTs: Number(r.lamport_ts ?? 0),
    deleted: Number(r.deleted ?? 0) !== 0,
    createdAt: String(r.created_at ?? ''),
  };
}

export const MemoryRepo = {
  async list(userId: string): Promise<MemoryItem[]> {
    const d = await openDb();
    const rows = await d.query(
      'select * from memories where user_id = ? and deleted = 0 order by lamport_ts desc, created_at desc limit 500',
      [userId],
    );
    return rows.map(rowToMemory);
  },

  /** 按 id 查（LWW 合并判定用，含 tombstone） */
  async getById(id: string): Promise<MemoryItem | null> {
    const d = await openDb();
    const rows = await d.query('select * from memories where id = ?', [id]);
    return rows.length ? rowToMemory(rows[0]) : null;
  },

  async upsertLocal(m: MemoryItem): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into memories (id, user_id, device_id, text, lamport_ts, deleted, created_at, dirty)
       values (?, ?, ?, ?, ?, ?, ?, 1)`,
      [m.id, m.userId, m.deviceId, m.text, m.lamportTs, m.deleted ? 1 : 0, m.createdAt],
    );
  },

  /** tombstone 软删 */
  async softDelete(id: string): Promise<void> {
    const d = await openDb();
    await d.run('update memories set deleted = 1, dirty = 1 where id = ?', [id]);
  },

  /** 云端合并落点（LWW 已由 sync 层判定） */
  async upsertRemote(m: MemoryItem): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into memories (id, user_id, device_id, text, lamport_ts, deleted, created_at, dirty, last_synced_at)
       values (?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [m.id, m.userId, m.deviceId, m.text, m.lamportTs, m.deleted ? 1 : 0, m.createdAt, nowIso()],
    );
  },
};

export const TrajectoryRepo = {
  async listBySession(sessionId: string): Promise<TrajectoryEntry[]> {
    const d = await openDb();
    const rows = await d.query(
      'select * from trajectories where session_id = ? and deleted = 0 order by lamport_ts desc limit 200',
      [sessionId],
    );
    return rows.map(rowToTrajectory);
  },

  /** 按 id 全量查（LWW 合并用，不带 deleted 过滤） */
  async getById(id: string): Promise<TrajectoryEntry | null> {
    const d = await openDb();
    const rows = await d.query('select * from trajectories where id = ?', [id]);
    return rows.length ? rowToTrajectory(rows[0]) : null;
  },

  async upsertLocal(t: TrajectoryEntry): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into trajectories (id, user_id, device_id, session_id, steps_json, lamport_ts, deleted, created_at, dirty)
       values (?, ?, ?, ?, ?, ?, ?, ?, 1)`,
      [t.id, t.userId, t.deviceId, t.sessionId, JSON.stringify(t.steps), t.lamportTs, t.deleted ? 1 : 0, t.createdAt],
    );
  },

  /** 云端合并落点（LWW 已由 sync 层判定） */
  async upsertRemote(t: TrajectoryEntry): Promise<void> {
    const d = await openDb();
    await d.run(
      `insert or replace into trajectories (id, user_id, device_id, session_id, steps_json, lamport_ts, deleted, created_at, dirty, last_synced_at)
       values (?, ?, ?, ?, ?, ?, ?, ?, 0, ?)`,
      [t.id, t.userId, t.deviceId, t.sessionId, JSON.stringify(t.steps), t.lamportTs, t.deleted ? 1 : 0, t.createdAt, nowIso()],
    );
  },
};
