/**
 * 跨端数据类型（§3.3）。
 * 约定：表/列 snake_case 由后端使用；TS 属性 camelCase（映射见 db/repo.ts、sync/*）。
 * M2 预留字段 device_id / lamport_ts / deleted 全部实体必含。
 */

export interface ProviderRow {
  provider: string;
  baseURL: string;
  model: string;
  voice?: string;
}

export interface AuthUser {
  userId: string;
  phone: string;
}

export interface Session {
  id: string;
  userId: string;
  deviceId: string;
  /** 首条消息摘要，≤30 字 */
  title: string;
  /** M2 预留 */
  lamportTs: number;
  /** tombstone 软删标记 */
  deleted: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface Message {
  id: string;
  sessionId: string;
  userId: string;
  deviceId: string;
  role: 'user' | 'assistant';
  content: string;
  /** 触发的动画/技能名，可空 */
  skillHint: string | null;
  lamportTs: number;
  deleted: boolean;
  createdAt: string;
}

/* ============ T07 形象规格（FR-304/305；§7 共享知识 1：仅元数据进 oplog LWW） ============ */

export type AvatarForm = '3d' | '2d' | 'live2d' | 'video';
export type AvatarKind = 'glb' | 'gltf' | 'fbx' | 'vrm' | 'png' | 'webm';

export interface AvatarSpec {
  form: AvatarForm;
  kind: AvatarKind;
  /** app 沙箱本地 URI（P2 FR-313 云分发换 oss://{hash}，签名不变） */
  uri: string;
  /** sha256 前 16 hex（去重键） */
  hash: string;
  /** 展示缩放（非标骨骼兜底参数，Q15） */
  scale: number;
  /** 垂直偏移（归一化后微调） */
  offsetY: number;
  /** 动作名 → clip 名映射（FBX 首 clip / GLB 多 clip；可手改，Q15） */
  clipMap?: Record<string, string>;
  /** 显示名（形象库卡用） */
  name?: string;
}

export interface UserConfig {
  userId: string;
  deviceId: string;
  avatarModel: 'mage-a' | 'mage-b';
  /** T07 形象元数据（FR-305/§7 共享知识 1：资源本体不同步，仅元数据走 oplog LWW） */
  avatarSpec?: AvatarSpec | null;
  llmProvider: string;
  llmBaseUrl: string;
  llmModel: string;
  asrProvider: string;
  asrBaseUrl: string;
  /** ASR 模型名（空=协议默认：mimo→mimo-v2.5-asr，openai→whisper-1） */
  asrModel?: string;
  /** 火山 ASR appid/cluster（非密钥配置；apiKey 仍只进 Keystore） */
  asrAppid?: string;
  asrCluster?: string;
  ttsProvider: string;
  ttsBaseUrl: string;
  ttsVoice: string;
  /** TTS 模型名（空=协议默认：mimo→mimo-v2.5-tts，openai→tts-1） */
  ttsModel?: string;
  /** 火山 TTS appid */
  ttsAppid?: string;
  /** 语音播报开关（默认 true；false 时文字照常显示、不播报） */
  ttsEnabled: boolean;
  lamportTs: number;
  updatedAt: string;
  deviceIdLast: string;
}

export interface Device {
  id: string;
  userId: string;
  deviceName: string;
  createdAt: string;
  lastSeenAt: string;
}

/** 双端互通设备信息（/api/devices） */
export interface DeviceInfo {
  id: string;
  userId: string;
  /** 如「gorgeous 的 Mac mini」 */
  deviceName: string;
  os: string;
  /** MQTT 房间 */
  room: string;
  online: boolean;
  lastSeenAt: string;
}

/** 长期记忆条目（LWW + tombstone） */
export interface MemoryItem {
  id: string;
  userId: string;
  deviceId: string;
  /** 长期偏好条目 */
  text: string;
  lamportTs: number;
  deleted: boolean;
  createdAt: string;
}

/** 轨迹步骤（脱敏摘要） */
export interface TrajectoryStep {
  seq: number;
  /** 如 run_shell / click_on */
  tool: string;
  /** 脱敏摘要（凭据打码） */
  argsSummary: string;
  resultSummary: string;
  ms: number;
}

/** 任务轨迹（LWW + tombstone） */
export interface TrajectoryEntry {
  id: string;
  userId: string;
  /** 产生轨迹的设备（通常为电脑） */
  deviceId: string;
  sessionId: string | null;
  steps: TrajectoryStep[];
  lamportTs: number;
  deleted: boolean;
  createdAt: string;
}

/** 本地待传队列（LocalOutbox 表） */
export interface LocalOutbox {
  opId: string;
  entity: 'session' | 'message' | 'user_config' | 'memory' | 'trajectory';
  entityId: string;
  action: 'upsert' | 'delete';
  payloadJson: string;
  lamportTs: number;
  /** 指数退避计数 */
  attempts: number;
}

export interface OplogEntry {
  opId: string;
  deviceId: string;
  lamportTs: number;
  entity: 'session' | 'message' | 'user_config' | 'memory' | 'trajectory';
  entityId: string;
  action: 'upsert' | 'delete';
  payload: Record<string, unknown>;
}

/** 统一错误返回（errors.ts 错误码） */
export type ApiResult<T> =
  | { ok: true; data: T }
  | { ok: false; code: string; msg: string };

/* ============ LLM / ASR / TTS ============ */

export interface Msg {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_call_id?: string;
  tool_calls?: ToolCall[];
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

export interface ToolDef {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: Record<string, unknown>;
  };
}

export interface LLMReply {
  content: string;
  toolCalls: ToolCall[];
  finishReason: string | null;
}

export interface LlmClient {
  chat(messages: Msg[], tools?: ToolDef[], signal?: AbortSignal): Promise<LLMReply>;
  chatStream(
    messages: Msg[],
    tools: ToolDef[] | undefined,
    onDelta: (t: string) => void,
    signal?: AbortSignal,
  ): Promise<LLMReply>;
}

export interface AsrClient {
  transcribe(wav: Uint8Array, format?: 'wav' | 'pcm'): Promise<string>;
}

/** null → 系统 TTS 兜底 */
export interface TtsClient {
  synthesize(text: string): Promise<Uint8Array | null>;
}

/* ============ 后端 / 同步 ============ */

export type SyncTable = 'sessions' | 'messages';

export interface DataBackend {
  signInOtp(phone: string): Promise<void>;
  verifyOtp(phone: string, code: string): Promise<AuthUser>;
  signOut(): Promise<void>;
  /** 可选：用户名+密码直登/注册（xiaowu 后端启用；mock/supabase 不实现，LoginPage 按需探测） */
  loginWithPassword?(username: string, password: string): Promise<AuthUser>;
  register?(username: string, password: string, email?: string): Promise<AuthUser>;
  /** 可选：短信验证码 / 绑定手机 / 忘记密码（xiaowu 后端启用） */
  smsSend?(phone: string, purpose: 'bind' | 'reset'): Promise<{ mock?: boolean; mock_code?: string }>;
  bindPhone?(phone: string, code: string): Promise<{ ok: boolean; phone: string }>;
  forgotPassword?(phone: string): Promise<{ mock?: boolean; mock_code?: string }>;
  resetPassword?(phone: string, code: string, newPassword: string): Promise<{ ok: boolean }>;
  upsertRows(table: SyncTable, rows: Record<string, unknown>[]): Promise<void>;
  fetchSince(table: SyncTable, sinceIso: string): Promise<Record<string, unknown>[]>;
  upsertConfig(cfg: UserConfig): Promise<void>;
  fetchConfig(): Promise<UserConfig | null>;
  listDevices(): Promise<Device[]>;
  registerDevice(name: string): Promise<Device>;
}

export interface SyncSDK {
  /** 内部生成 op_id + lamport */
  enqueue(op: Omit<OplogEntry, 'opId' | 'lamportTs'>): Promise<void>;
  /** outbox→云，op_id 幂等，失败指数退避（1s→60s 封顶） */
  flush(): Promise<void>;
  /** since=last_synced_at，返回合并条数 */
  pullIncremental(): Promise<number>;
  /** 网络恢复/app 回前台触发 flush+pull */
  startAuto(): void;
}

/* ============ 对话编排 ============ */

export interface Reply {
  userMsg: Message;
  assistantMsg: Message;
  skillCalls: string[];
}

export interface ChatOrchestrator {
  sendText(text: string, sessionId: string): Promise<ApiResult<Reply>>;
  sendVoice(wav: Uint8Array, sessionId: string): Promise<ApiResult<Reply>>;
  /** 打断 TTS 播报 */
  interrupt(): void;
  /** 流式分句 → TTS */
  onSentence(cb: (text: string) => void): void;
  /** 动画触发 */
  onAnimation(cb: (clip: string) => void): void;
}

/* ============ 3D / 平台 ============ */

export interface AvatarRenderer {
  loadModel(url: string): Promise<void>;
  playClip(name: string): void;
  triggerByText(text: string): void;
  setSpeaking(on: boolean): void;
}

export interface SecureStore {
  set(key: string, value: string): Promise<void>;
  get(key: string): Promise<string | null>;
  remove(key: string): Promise<void>;
}

export interface MageBridge {
  recordWav(): Promise<Uint8Array>;
  requestMic(): Promise<boolean>;
  isOnline(): boolean;
}
