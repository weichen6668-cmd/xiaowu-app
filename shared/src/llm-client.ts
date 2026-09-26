/**
 * LLM HTTP 客户端（抽自 services/llm.js 的 fetch/流式 SSE 逻辑）。
 * config 注入式：不读 fs/secrets，调用方每次传 ProviderRow（§8 配置热更新：每调即读）。
 * 超时兜底 ≤120s。
 */
import type { LlmClient, LLMReply, Msg, ProviderRow, ToolCall, ToolDef } from './types';

/** 默认超时：调用方未传 signal 时兜底（防网络半挂起永久 pending） */
export const LLM_TIMEOUT_MS = 120 * 1000;

function signalWithDefault(ext?: AbortSignal): AbortSignal {
  // 优先 AbortSignal.timeout（内部 timer 不挂事件循环）；
  // Android WebView 无 timeout/any 时退 AbortController+setTimeout 兜底（≤120s）
  if (typeof AbortSignal.timeout === 'function') {
    const timeout = AbortSignal.timeout(LLM_TIMEOUT_MS);
    if (!ext) return timeout;
    if (typeof (AbortSignal as unknown as { any?: unknown }).any === 'function') {
      return (AbortSignal as unknown as { any(s: AbortSignal[]): AbortSignal }).any([ext, timeout]);
    }
    const ac = new AbortController();
    const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
    const done = (): void => {
      clearTimeout(timer);
      ac.abort();
    };
    timeout.addEventListener('abort', done, { once: true });
    if (ext.aborted) done();
    else ext.addEventListener('abort', done, { once: true });
    return ac.signal;
  }
  const ac = new AbortController();
  const timer = setTimeout(() => ac.abort(), LLM_TIMEOUT_MS);
  ac.signal.addEventListener('abort', () => clearTimeout(timer), { once: true });
  if (ext) {
    if (ext.aborted) ac.abort();
    else ext.addEventListener('abort', () => ac.abort(), { once: true });
  }
  return ac.signal;
}

function buildBody(messages: Msg[], tools: ToolDef[] | undefined, stream: boolean, model: string): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages,
    temperature: 0.8,
    max_tokens: 1024,
  };
  if (stream) body.stream = true;
  if (tools && tools.length) {
    body.tools = tools;
    body.tool_choice = 'auto';
  }
  return body;
}

function requireConfigured(row: LlmConfigRow): string {
  const isLocal = /127\.0\.0\.1|localhost/.test(row.baseURL || '');
  if (!((isLocal || row.apiKey) && row.baseURL && row.model)) {
    throw new Error('LLM 未配置：请在设置页填入模型 API Key。');
  }
  return `${row.baseURL.replace(/\/$/, '')}/chat/completions`;
}

function parseReply(content: string, toolCalls: ToolCall[], finishReason: string | null): LLMReply {
  return {
    content,
    toolCalls: toolCalls.filter(Boolean),
    finishReason,
  };
}

/** 客户端配置行 = ProviderRow（设计 §3.3）+ 运行时凭证（apiKey 只经 SecureStore 注入，不进类型/云表） */
export type LlmConfigRow = ProviderRow & { apiKey?: string };

/** 创建 LLM 客户端；configProvider 每次请求实时取当前 ProviderRow（热更新） */
export function createLlmClient(configProvider: () => LlmConfigRow): LlmClient {
  return {
    async chat(messages: Msg[], tools?: ToolDef[], signal?: AbortSignal): Promise<LLMReply> {
      const row = configProvider();
      const url = requireConfigured(row);
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${row.apiKey}`,
        },
        body: JSON.stringify(buildBody(messages, tools, false, row.model)),
        signal: signalWithDefault(signal),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM 请求失败 ${resp.status}: ${text.slice(0, 400)}`);
      }
      const j = (await resp.json()) as {
        choices?: Array<{
          message?: { content?: string | null; tool_calls?: ToolCall[] };
          finish_reason?: string | null;
        }>;
      };
      const ch = (j.choices && j.choices[0]) || {};
      return parseReply(ch.message?.content || '', ch.message?.tool_calls || [], ch.finish_reason ?? null);
    },

    async chatStream(
      messages: Msg[],
      tools: ToolDef[] | undefined,
      onDelta: (t: string) => void,
      signal?: AbortSignal,
    ): Promise<LLMReply> {
      const row = configProvider();
      const url = requireConfigured(row);
      const resp = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${row.apiKey}`,
        },
        body: JSON.stringify(buildBody(messages, tools, true, row.model)),
        signal: signalWithDefault(signal),
      });
      if (!resp.ok) {
        const text = await resp.text();
        throw new Error(`LLM 请求失败 ${resp.status}: ${text.slice(0, 400)}`);
      }

      // SSE 解析：tool_calls 增量拼接（index 分槽）
      const reader = (resp.body as ReadableStream<Uint8Array>).getReader();
      const decoder = new TextDecoder();
      let buf = '';
      let content = '';
      const toolCalls: ToolCall[] = [];
      let finishReason: string | null = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf('\n')) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line.startsWith('data:')) continue;
          const payload = line.slice(5).trim();
          if (payload === '[DONE]') continue;
          let ev: {
            choices?: Array<{
              delta?: {
                content?: string;
                tool_calls?: Array<{
                  index?: number;
                  id?: string;
                  type?: string;
                  function?: { name?: string; arguments?: string };
                }>;
              };
              finish_reason?: string | null;
            }>;
          };
          try {
            ev = JSON.parse(payload);
          } catch {
            continue;
          }
          const ch = ev.choices && ev.choices[0];
          if (!ch) continue;
          const delta = ch.delta || {};
          if (typeof delta.content === 'string' && delta.content) {
            content += delta.content;
            try {
              onDelta(delta.content);
            } catch {
              /* 回调异常不阻断流 */
            }
          }
          if (Array.isArray(delta.tool_calls)) {
            for (const tc of delta.tool_calls) {
              const idx = tc.index || 0;
              const cur = toolCalls[idx] ||
                (toolCalls[idx] = { id: '', type: 'function', function: { name: '', arguments: '' } });
              if (tc.id) cur.id = tc.id;
              if (tc.type) cur.type = 'function';
              if (tc.function) {
                if (tc.function.name) cur.function.name += tc.function.name;
                if (tc.function.arguments) cur.function.arguments += tc.function.arguments;
              }
            }
          }
          if (ch.finish_reason) finishReason = ch.finish_reason;
        }
      }
      return parseReply(content, toolCalls, finishReason);
    },
  };
}
