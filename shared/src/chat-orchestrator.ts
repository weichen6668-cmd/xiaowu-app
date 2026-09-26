/**
 * 对话流水线编排（FR-104/105/106）：
 * 消息组装 → LLM（流式）→ 工具循环（≤6 轮）→ 流式分句 → 回调 TTS/动画。
 * 与 UI/DB/同步解耦：通过回调 onSentence/onAnimation 上抛，落库由调用方负责。
 */
import type {
  AsrClient,
  ChatOrchestrator,
  LlmClient,
  Message,
  Msg,
  Reply,
  TtsClient,
  ApiResult,
} from './types';
import { ok, fail, XW_ERR, fromError } from './errors';
import { builtinToolDefs, runBuiltinSkill, ANIMATION_CATEGORIES } from './skills-core';

const SYSTEM_PROMPT =
  '你是小巫，一位活泼可爱的 3D 数字人法师助手。回答简短口语化（≤80 字优先），' +
  '适合语音播报。用户要求做动作时调用 set_animation，问时间/天气/版本时调用对应技能。';

const MAX_TOOL_ROUNDS = 6;

export interface OrchestratorDeps {
  llm: LlmClient;
  asr: AsrClient;
  tts: TtsClient;
  /** 工具执行上下文 */
  skillCtx: {
    triggerAnimation: (clip: string) => void;
    animationList?: string[];
    weatherProvider?: (city: string) => string;
    appVersion: string;
    /** 语音播报开关（缺省开启；false 时跳过播报，文字照常显示） */
    ttsEnabled?: () => boolean;
  };
  /** 历史消息读取（组装上下文用） */
  getHistory: (sessionId: string) => Promise<Message[]>;
  /** 落库（本地 SQLite + dirty 标记，由调用方决定是否 enqueue 同步） */
  persist: (msg: Omit<Message, 'id' | 'createdAt'> & { id?: string }) => Promise<Message>;
  /** 用户 uuid 生成 */
  genId: () => string;
  /** 当前设备 */
  deviceId: string;
  userId: string;
}

/** 简单分句器：按中文/英文句末标点切，流式增量喂入，完整句回调 */
export class SentenceSplitter {
  private buf = '';

  feed(delta: string): string[] {
    this.buf += delta;
    const out: string[] = [];
    const re = /[^。！？!?\n]+[。！？!?\n]*/g;
    let lastIdx = 0;
    let m: RegExpExecArray | null;
    const test = new RegExp(re.source, 'g');
    // 只切「已终结」的句子（带标点），残句留 buf
    while ((m = test.exec(this.buf)) !== null) {
      const seg = m[0];
      const ends = /[。！？!?\n]$/.test(seg);
      if (ends) {
        out.push(seg.trim());
        lastIdx = m.index + seg.length;
      }
    }
    if (lastIdx > 0) this.buf = this.buf.slice(lastIdx);
    return out;
  }

  flush(): string {
    const rest = this.buf.trim();
    this.buf = '';
    return rest;
  }
}

/**
 * 创建对话编排器。
 * - sendText/sendVoice → 完整 Reply（userMsg + assistantMsg + skillCalls）
 * - onSentence 逐句回调（UI 驱动 TTS 播报 + 口型）
 * - onAnimation 动画触发回调
 */
export function createChatOrchestrator(deps: OrchestratorDeps): ChatOrchestrator & {
  setTtsPlayer: (p: ((audio: Uint8Array) => void) | null) => void;
} {
  let aborted = false;
  let ttsPlayer: ((audio: Uint8Array) => void) | null = null;
  let sentenceCb: ((text: string) => void) | null = null;
  let animCb: ((clip: string) => void) | null = null;
  /** TTS 开关：false 时跳过播报（ttsPlayer/onSentence 播报链），文字照常 */
  const ttsOn = (): boolean =>
    deps.skillCtx.ttsEnabled ? deps.skillCtx.ttsEnabled() : true;

  const skillCtx = {
    triggerAnimation: (clip: string) => {
      deps.skillCtx.triggerAnimation(clip);
      if (animCb) {
        try {
          animCb(clip);
        } catch {
          /* 忽略回调异常 */
        }
      }
    },
    animationList: deps.skillCtx.animationList || ANIMATION_CATEGORIES,
    weatherProvider: deps.skillCtx.weatherProvider,
    appVersion: deps.skillCtx.appVersion,
  };

  function emitAnimByText(text: string): void {
    // 触发词扫描在 three/animation.ts 做更细；此处给编排层直接命中（"跳个舞"→dance 等）
    const map: Record<string, string[]> = {
      dance: ['跳舞', '跳个舞', '蹦迪'],
      greet: ['你好', '打招呼', '嗨'],
      cast: ['施法', '魔法', '变魔术'],
      happy: ['开心', '太棒', '耶'],
      sad: ['难过', '伤心'],
      fight: ['打架', '战斗'],
      walk: ['散步', '跑步'],
    };
    for (const [clip, words] of Object.entries(map)) {
      if (words.some((w) => text.includes(w))) {
        skillCtx.triggerAnimation(clip);
        return;
      }
    }
  }

  async function runTurn(
    userText: string,
    sessionId: string,
  ): Promise<ApiResult<Reply>> {
    aborted = false;
    try {
      // 1. 落库用户消息
      const userMsg = await deps.persist({
        userId: deps.userId,
        deviceId: deps.deviceId,
        sessionId,
        role: 'user',
        content: userText,
        skillHint: null,
        lamportTs: 0,
        deleted: false,
      });

      // 2. 组装上下文（system + history + 当前）
      const history = await deps.getHistory(sessionId);
      const msgs: Msg[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        ...history
          .filter((m) => !m.deleted)
          .slice(-12)
          .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content })),
      ];
      if (!history.length || history[history.length - 1]?.id !== userMsg.id) {
        msgs.push({ role: 'user', content: userText });
      }

      emitAnimByText(userText);

      // 3. 工具循环（≤6 轮）
      const skillCalls: string[] = [];
      const tools = builtinToolDefs();
      let finalText = '';
      let rounds = 0;

      for (;;) {
        rounds += 1;
        if (rounds > MAX_TOOL_ROUNDS) break;

        const splitter = new SentenceSplitter();
        const reply = await deps.llm.chatStream(msgs, tools, (delta) => {
          if (aborted) return;
          // 流式分句 → onSentence（逐句 TTS）；ttsEnabled=false 时跳过播报，文字照常累加
          for (const seg of splitter.feed(delta)) {
            if (ttsOn() && sentenceCb) {
              try {
                sentenceCb(seg);
              } catch {
                /* 忽略 */
              }
            }
            if (ttsOn()) skillCtx.triggerAnimation('__speaking__'); // 保持口型（three 层翻译）
          }
        });

        // 补齐残句
        const tail = splitter.flush();
        if (tail && ttsOn() && sentenceCb) {
          try {
            sentenceCb(tail);
          } catch {
            /* 忽略 */
          }
        }

        finalText += reply.content || '';

        // 无 tool_calls → 终态
        if (!reply.toolCalls.length) break;

        // 有 tool_calls → 执行技能并回填
        msgs.push({
          role: 'assistant',
          content: reply.content || null,
          tool_calls: reply.toolCalls,
        });
        for (const tc of reply.toolCalls) {
          const name = tc.function.name;
          let args: Record<string, unknown> = {};
          try {
            args = JSON.parse(tc.function.arguments || '{}') as Record<string, unknown>;
          } catch {
            args = {};
          }
          skillCalls.push(name);
          const result = (await runBuiltinSkill(name, args, skillCtx)) ?? '技能未找到';
          msgs.push({ role: 'tool', content: result, tool_call_id: tc.id, name });
        }
        if (rounds >= MAX_TOOL_ROUNDS) break;
      }

      // 4. 动画联动（对最终文本扫一次触发词）
      if (finalText) emitAnimByText(finalText);

      // 5. 落库助手消息
      const assistantMsg = await deps.persist({
        userId: deps.userId,
        deviceId: deps.deviceId,
        sessionId,
        role: 'assistant',
        content: finalText || '（未生成回复）',
        skillHint: skillCalls.length ? skillCalls[0] : null,
        lamportTs: 0,
        deleted: false,
      });

      return ok({ userMsg, assistantMsg, skillCalls });
    } catch (e) {
      return fromError<Reply>(e);
    }
  }

  return {
    sendText(text: string, sessionId: string): Promise<ApiResult<Reply>> {
      return runTurn(text.trim(), sessionId);
    },

    async sendVoice(wav: Uint8Array, sessionId: string): Promise<ApiResult<Reply>> {
      if (!wav || !wav.length) return fail(XW_ERR.RECORD_FAIL, '录音为空');
      let text: string;
      try {
        text = await deps.asr.transcribe(wav, 'wav');
      } catch (e) {
        return fail(XW_ERR.ASR_FAIL, (e as Error).message?.slice(0, 120));
      }
      // Q1：wav 转写后即删，不上云（本地引用直接丢弃）
      text = (text || '').trim();
      if (!text) return fail(XW_ERR.ASR_FAIL, '未识别到内容，请重试');
      return runTurn(text, sessionId);
    },

    interrupt(): void {
      aborted = true;
    },

    onSentence(cb: (text: string) => void): void {
      sentenceCb = cb;
    },

    onAnimation(cb: (clip: string) => void): void {
      animCb = cb;
    },

    setTtsPlayer(p: ((audio: Uint8Array) => void) | null): void {
      // ttsEnabled=false 时跳过播报（置空玩家，文字照常显示）
      ttsPlayer = ttsOn() ? p : null;
      void ttsPlayer;
    },
  };
}
