/**
 * T05 扩展①：LLM/ASR/TTS「测试连接」探测。
 * - 成功返回耗时 ms（UI 呈现「✓ 连通 123ms」）；失败给原因：HTTP 401 / 超时 5s / DNS 等。
 * - LLM：GET {base}/models 探测，404/405 时退化 1-token 聊天；ASR/TTS：baseUrl 可达 + key 校验。
 * - 红线：apiKey 仅作 fetch 瞬时入参，禁止写日志 / 进结果对象 / 拼进 URL。
 */
export interface LinkTestResult {
  ok: boolean;
  ms: number;
  detail?: string;
  reason?: string;
}

const TIMEOUT_MS = 5000;

/** 网络层异常 → 用户可读原因（DNS / 超时） */
function classifyNetErr(e: unknown): string {
  const name = String((e as { name?: string })?.name || '');
  const msg = String((e as Error)?.message || e);
  if (name === 'TimeoutError' || name === 'AbortError' || /timeout|aborted/i.test(msg)) return '超时（5 秒未响应）';
  if (/Failed to fetch|NetworkError|ENOTFOUND|EAI_AGAIN|getaddrinfo|ECONNREFUSED|fetch failed/i.test(msg)) {
    return '网络不可达（DNS/跨域拦截，非配置错误）';
  }
  return '网络错误：' + msg.slice(0, 80);
}

/** HTTP 状态 → 原因（2xx 返回 null=正常） */
function classifyStatus(status: number): string | null {
  if (status >= 200 && status < 300) return null;
  if (status === 401) return 'HTTP 401：API Key 无效或未授权';
  if (status === 403) return 'HTTP 403：API Key 无权限';
  if (status === 429) return 'HTTP 429：限流，请稍后再试';
  return 'HTTP ' + status + (status >= 500 ? '：服务端错误' : '：请求被拒绝');
}

/** 统一 5s 超时 fetch（AbortSignal.timeout 优先，缺失退 AbortController） */
async function timedFetch(url: string, init: RequestInit): Promise<{ res: Response; ms: number }> {
  const t0 = Date.now();
  let signal: AbortSignal;
  if (typeof AbortSignal !== 'undefined' && typeof AbortSignal.timeout === 'function') {
    signal = AbortSignal.timeout(TIMEOUT_MS);
  } else {
    const ac = new AbortController();
    setTimeout(() => ac.abort(), TIMEOUT_MS).unref?.();
    signal = ac.signal;
  }
  const res = await fetch(url, { ...init, signal });
  return { res, ms: Date.now() - t0 };
}

function baseOf(baseUrl: string): string {
  return (baseUrl || '').trim().replace(/\/+$/, '');
}

/** LLM 探测：GET /models → 404/405 退 1-token 聊天。key 只进 Authorization 头（禁日志） */
export async function testLlm(baseUrl: string, apiKey: string, model: string): Promise<LinkTestResult> {
  const base = baseOf(baseUrl);
  if (!base) return { ok: false, ms: 0, reason: '未填写 baseURL' };
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (apiKey) headers.Authorization = 'Bearer ' + apiKey;
  try {
    let probe = 'GET /models';
    let r = await timedFetch(base + '/models', { method: 'GET', headers });
    if (r.res.status === 404 || r.res.status === 405) {
      probe = 'POST /chat/completions（1 token）';
      r = await timedFetch(base + '/chat/completions', {
        method: 'POST',
        headers,
        body: JSON.stringify({ model: model || 'default', messages: [{ role: 'user', content: 'hi' }], max_tokens: 1 }),
      });
    }
    const reason = classifyStatus(r.res.status);
    return reason ? { ok: false, ms: r.ms, reason } : { ok: true, ms: r.ms, detail: probe + ' 可用' };
  } catch (e) {
    return { ok: false, ms: TIMEOUT_MS, reason: classifyNetErr(e) };
  }
}

/** ASR/TTS 探测：baseUrl 可达 + key 校验（任意 HTTP 响应=可达，401/403=key 被拒） */
export async function testAsrTts(baseUrl: string, apiKey: string, kind: 'asr' | 'tts'): Promise<LinkTestResult> {
  const base = baseOf(baseUrl);
  if (!base) return { ok: false, ms: 0, reason: '未填写 baseURL' };
  if (!apiKey) return { ok: false, ms: 0, reason: '未保存 API Key（仅本机 Keystore）' };
  try {
    const { res, ms } = await timedFetch(base + '/', {
      method: 'GET',
      headers: { Authorization: 'Bearer ' + apiKey },
    });
    const reason = classifyStatus(res.status === 401 || res.status === 403 ? res.status : 200);
    return reason ? { ok: false, ms, reason } : { ok: true, ms, detail: kind.toUpperCase() + ' host 可达' };
  } catch (e) {
    return { ok: false, ms: TIMEOUT_MS, reason: classifyNetErr(e) };
  }
}
