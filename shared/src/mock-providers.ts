/**
 * MockProvider（设计 §1.3）：离线全链路 UI 测试用。
 * MockAsrClient → 固定识别文本；MockLlmClient → 固定示例回复（含一次 tool_call 演示）；
 * MockTtsClient → 静音 WAV 字节（16kHz mono 16bit）。
 * 装配开关统一在 mobile/src/platform/bridge.ts（§8），禁止散落 if。
 */
import type { AsrClient, LlmClient, LLMReply, Msg, TtsClient, ToolCall, ToolDef } from './types';

/** 固定识别文本（每次转写返回同一句，便于走查天气链路） */
export const MOCK_ASR_TEXT = '今天天气怎么样';

/** 1 秒静音 WAV（16kHz mono 16bit PCM） */
export function mockSilentWav(): Uint8Array {
  const sampleRate = 16000;
  const seconds = 1;
  const numSamples = sampleRate * seconds;
  const dataSize = numSamples * 2;
  const buf = new ArrayBuffer(44 + dataSize);
  const v = new DataView(buf);
  const w = (off: number, str: string) => {
    for (let i = 0; i < str.length; i += 1) v.setUint8(off + i, str.charCodeAt(i));
  };
  w(0, 'RIFF');
  v.setUint32(4, 36 + dataSize, true);
  w(8, 'WAVE');
  w(12, 'fmt ');
  v.setUint32(16, 16, true);
  v.setUint16(20, 1, true);
  v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true);
  v.setUint32(28, sampleRate * 2, true);
  v.setUint16(32, 2, true);
  v.setUint16(34, 16, true);
  w(36, 'data');
  v.setUint32(40, dataSize, true);
  return new Uint8Array(buf);
}

function delay(ms = 120): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/** MockAsrClient：固定识别文本 */
export function createMockAsrClient(): AsrClient {
  return {
    async transcribe(): Promise<string> {
      await delay();
      return MOCK_ASR_TEXT;
    },
  };
}

/**
 * MockLlmClient：固定示例回复。
 * 首轮若带 tools 且用户问天气 → 返回一次 get_weather tool_call 演示；
 * 含 tool result 后 → 固定示例回复文本（流式按句喂 onDelta）。
 */
export function createMockLlmClient(): LlmClient {
  let toolDemoDone = false;

  const answer = (): LLMReply => ({
    content: '今天北京天气晴，气温 25℃，湿度 40%，很适合出门哦。',
    toolCalls: [],
    finishReason: 'stop',
  });

  async function decide(messages: Msg[], tools?: ToolDef[]): Promise<LLMReply> {
    await delay();
    const lastUser = [...messages].reverse().find((m) => m.role === 'user');
    const hasToolResult = messages.some((m) => m.role === 'tool');
    const wantWeather = !!lastUser && /天气/.test(String(lastUser.content || ''));
    const canCall = !!tools && tools.length > 0 && !toolDemoDone && wantWeather && !hasToolResult;
    if (canCall) {
      toolDemoDone = true;
      const call: ToolCall = {
        id: 'mock-call-1',
        type: 'function',
        function: { name: 'get_weather', arguments: '{"city":"北京"}' },
      };
      return { content: '', toolCalls: [call], finishReason: 'tool_calls' };
    }
    return answer();
  }

  return {
    async chat(messages: Msg[], tools?: ToolDef[]): Promise<LLMReply> {
      return decide(messages, tools);
    },

    async chatStream(
      messages: Msg[],
      tools: ToolDef[] | undefined,
      onDelta: (t: string) => void,
    ): Promise<LLMReply> {
      const reply = await decide(messages, tools);
      // 流式按句喂增量（与 SSE 行为一致）
      if (reply.content) {
        for (const ch of reply.content) {
          onDelta(ch);
          await delay(2);
        }
      }
      return reply;
    },
  };
}

/** MockTtsClient：静音 WAV 字节 */
export function createMockTtsClient(): TtsClient {
  return {
    async synthesize(): Promise<Uint8Array | null> {
      await delay();
      return mockSilentWav();
    },
  };
}
