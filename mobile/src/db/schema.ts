/**
 * 本地 SQLite DDL（与 Supabase 表同构，列名 snake_case 一致）。
 * 本地多两列：dirty（待上云标记）、last_synced_at。
 * M2 预留三列：device_id / lamport_ts / deleted。
 * 迁移版本号 SCHEMA_VERSION 变更时执行增量 DDL。
 */
export const SCHEMA_VERSION = 3;

/** 本地四张表 DDL（含 outbox） */
export const DDL: string[] = [
  `create table if not exists sessions (
    id          text primary key,
    user_id     text not null,
    device_id   text not null,
    title       text not null default '',
    lamport_ts  integer not null default 0,
    deleted     integer not null default 0,
    created_at  text not null,
    updated_at  text not null,
    dirty       integer not null default 1,
    last_synced_at text
  )`,
  `create table if not exists messages (
    id          text primary key,
    session_id  text not null,
    user_id     text not null,
    device_id   text not null,
    role        text not null check (role in ('user','assistant')),
    content     text not null default '',
    skill_hint  text,
    lamport_ts  integer not null default 0,
    deleted     integer not null default 0,
    created_at  text not null,
    dirty       integer not null default 1,
    last_synced_at text
  )`,
  `create table if not exists user_config (
    user_id       text primary key,
    device_id     text not null default '',
    avatar_model  text not null default 'mage-a',
    llm_provider  text not null default 'custom',
    llm_base_url  text not null default 'https://apimimo.zaiyunding.com/v1',
    llm_model     text not null default 'mimo-v2.6-pro',
    asr_provider  text not null default 'openai',
    asr_base_url  text not null default 'https://api.siliconflow.cn/v1',
    asr_model     text not null default 'XingChenAGI/XingChenASR-V3.2-Ultra',
    asr_appid     text not null default '',
    asr_cluster   text not null default '',
    tts_provider  text not null default 'mimo',
    tts_base_url  text not null default 'https://api.xiaomimimo.com/v1',
    tts_model     text not null default 'mimo-v2.5-tts',
    tts_appid     text not null default '',
    tts_voice     text not null default '白桦',
    tts_enabled   integer not null default 1,
    lamport_ts    integer not null default 0,
    updated_at    text not null,
    device_id_last text not null default '',
    dirty         integer not null default 1,
    last_synced_at text
    -- 注意：不存任何 apiKey/token 字段（secure-store.ts 独占）
  )`,
  `create table if not exists local_outbox (
    op_id       text primary key,
    entity      text not null,
    entity_id   text not null,
    action      text not null,
    payload_json text not null,
    lamport_ts  integer not null default 0,
    attempts    integer not null default 0
  )`,
  /* ===== v2 新增：memories / trajectories（LWW + tombstone，M2 双端互通） ===== */
  `create table if not exists memories (
    id          text primary key,
    user_id     text not null,
    device_id   text not null default '',
    text        text not null default '',
    lamport_ts  integer not null default 0,
    deleted     integer not null default 0,
    created_at  text not null,
    dirty       integer not null default 1,
    last_synced_at text
  )`,
  `create table if not exists trajectories (
    id          text primary key,
    user_id     text not null,
    device_id   text not null default '',
    session_id  text,
    steps_json  text not null default '[]',
    lamport_ts  integer not null default 0,
    deleted     integer not null default 0,
    created_at  text not null,
    dirty       integer not null default 1,
    last_synced_at text
  )`,
  `create index if not exists idx_sessions_user_updated on sessions (user_id, updated_at desc)`,
  `create index if not exists idx_messages_session on messages (session_id, created_at)`,
  `create index if not exists idx_outbox_lamport on local_outbox (lamport_ts)`,
  `create index if not exists idx_memories_user on memories (user_id, lamport_ts)`,
  `create index if not exists idx_trajectories_user on trajectories (user_id, lamport_ts)`,
];

/** 版本迁移表 */
export const MIGRATION_DDL = `create table if not exists schema_meta (
  key text primary key,
  value text not null
)`;

/**
 * v3 增量迁移：ASR/TTS 扩展列（旧库 ALTER 补列）。
 * SQLite 无 add column if not exists，重复执行会抛「duplicate column」——执行处逐条吞错。
 */
export const MIGRATIONS: string[] = [
  `alter table user_config add column asr_model text not null default ''`,
  `alter table user_config add column asr_appid text not null default ''`,
  `alter table user_config add column asr_cluster text not null default ''`,
  `alter table user_config add column tts_model text not null default ''`,
  `alter table user_config add column tts_appid text not null default ''`,
];

/** 建库语句序列（open 后执行） */
export function allDdl(): string[] {
  return [MIGRATION_DDL, ...DDL];
}
