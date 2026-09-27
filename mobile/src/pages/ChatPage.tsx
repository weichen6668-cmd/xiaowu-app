/**
 * 主对话页（豆包式多对话窗口布局，T05）：
 * 顶栏[←][✎]+双行标题（会话名 + 被控设备名）+右[📞][🔇]；
 * AI 气泡底部操作条 复制/播报/赞/踩/转发；
 * 底部工具条 设备 chip +「选择项目」+ ⓘ；
 * 输入坞 [📷][发消息或按住说话][语音圆钮][＋]。
 * 远程模式：来源徽标「在 xx 执行」+ 截图/文件卡片 + RemoteConfirmHost 危险确认。
 * 吞错修复保留：doSend/doVoiceEnd 全链路 try/finally + error 红字上屏。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AvatarStage } from '../components/AvatarStage';
import { TtsStatus } from '../components/TtsStatus';
import { Waveform } from '../components/Waveform';
import { RemoteConfirmHost } from '../components/ConfirmDialog';
import { useChatStore } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';
import { useAuthStore } from '../store/authStore';
import { useSettingsStore, readApiKey } from '../store/settingsStore';
import { useDeviceStore } from '../store/deviceStore';
import { useRemoteStore } from '../store/remoteStore';
import { remoteSdk } from '../remote/remote-sdk';
import { installCmdRouter } from '../remote/cmd-router';
import { getOrchestrator, getDeviceId, getSyncSDK } from '../platform/runtime';
import { recordStart, isOnline, onNetworkChange, hapticLight, requestMic, isMockMode } from '../platform/bridge';
import type { RecorderHandle } from '../platform/bridge';
import { createTtsClient, type Message } from '@xw/shared';

/** 播报：TTS 合成 + Audio 元素播放；合成不可用退系统 speechSynthesis */
/** 播放队列：逐句排队不叠播；stopSpeak 打断当前句并作废已排队句（代际令牌） */
let ttsChain: Promise<void> = Promise.resolve();
let curAudio: HTMLAudioElement | null = null;
let ttsGen = 0; // 代际：stopSpeak 递增即作废所有在途/排队句
let ttsPending = 0; // 在播+排队句数，归零才置 speaking=false
let ttsCredsWarned = false; // 缺凭证提示只报一次，不刷屏
let audioUnlocked = false; // WebView 自动播放解锁标记

/** 魔数嗅探音频 MIME（桌面 app.js 同款：无 MIME 的 WAV 在 WebView 解码失败会静默失声） */
export function sniffAudioMime(b: Uint8Array): string {
  if (b.length >= 4) {
    if (b[0] === 0x52 && b[1] === 0x49 && b[2] === 0x46 && b[3] === 0x46) return 'audio/wav'; // RIFF
    if (b[0] === 0x4f && b[1] === 0x67 && b[2] === 0x67 && b[3] === 0x53) return 'audio/ogg'; // OggS
    if (b[0] === 0x49 && b[1] === 0x44 && b[2] === 0x33) return 'audio/mpeg'; // ID3
  }
  return 'audio/mpeg';
}

/** WebView 自动播放解锁：用户手势内播放 0 音量静音片段（一次性），否则后续 play() 被 NotAllowedError 拦截 */
export function prewarmAudio(): void {
  if (audioUnlocked) return;
  try {
    const el = new Audio('data:audio/wav;base64,UklGRiQAAABXQVZFZm10IBAAAAABAAEAgD4AAAB9AAACABAAZGF0YQAAAAA=');
    el.volume = 0;
    void el.play().then(() => { audioUnlocked = true; }).catch(() => undefined);
  } catch { /* 无 Audio 环境忽略 */ }
}

export function stopSpeak(): void {
  ttsGen++;
  ttsPending = 0;
  try { window.speechSynthesis.cancel(); } catch { /* 无系统 TTS */ }
  if (curAudio) {
    try { curAudio.pause(); } catch { /* ignore */ }
    curAudio = null;
  }
}

function notifyTtsMissingCreds(): void {
  if (ttsCredsWarned) return;
  ttsCredsWarned = true;
  useChatStore.setState({ error: 'TTS 未配置完整（缺 API Key 或 appid），已用系统语音兜底' });
}

async function speakOnce(text: string, gen: number): Promise<void> {
  const t = text.slice(0, 500);
  if (!t || gen !== ttsGen) return;
  try {
    const key = await readApiKey('tts');
    const row = { ...useSettingsStore.getState().ttsRow(), apiKey: key };
    const audio = await createTtsClient(() => row).synthesize(t);
    if (gen !== ttsGen) return; // 合成期间被停止
    if (audio && audio.length) {
      const url = URL.createObjectURL(new Blob([audio.slice().buffer as ArrayBuffer], { type: sniffAudioMime(audio) }));
      const el = new Audio(url);
      curAudio = el;
      // 等 onended 再出队（只等 play() 会句间叠播）；30s 兜底防队列卡死
      await new Promise<void>((resolve) => {
        const timer = setTimeout(() => { URL.revokeObjectURL(url); resolve(); }, 30000);
        const done = () => { clearTimeout(timer); URL.revokeObjectURL(url); resolve(); };
        el.onended = done;
        el.onerror = done;
        el.play().catch((e) => {
          clearTimeout(timer);
          URL.revokeObjectURL(url);
          const name = String((e as Error)?.name || '');
          useChatStore.setState({
            error: name === 'NotAllowedError'
              ? '语音播放被系统拦截：请再点一次发送或播报'
              : '语音播放失败: ' + String((e as Error)?.message || e).slice(0, 60),
          });
          resolve();
        });
      });
      return;
    }
    notifyTtsMissingCreds(); // synthesize 返回 null = 缺凭证（key/appid）
  } catch (e) {
    // 合成失败退系统 TTS，但原因必须上屏（以前空 catch 全链零提示）
    useChatStore.setState({ error: 'TTS 合成失败，已退系统语音: ' + String((e as Error)?.message || e).slice(0, 60) });
  }
  try {
    await new Promise<void>((resolve) => {
      const u = new SpeechSynthesisUtterance(t);
      u.onend = () => resolve();
      u.onerror = () => resolve();
      window.speechSynthesis.speak(u);
      setTimeout(resolve, 15000); // 部分 WebView 不回 onend，兜底防队列卡死
    });
  } catch { /* 无系统 TTS 则静默（点击即触发，无挂起态） */ }
}

function speakText(text: string): Promise<void> {
  const gen = ttsGen;
  ttsPending++;
  ttsChain = ttsChain
    .then(() => (gen === ttsGen ? speakOnce(text, gen) : undefined))
    .catch(() => undefined)
    .then(() => {
      ttsPending = Math.max(0, ttsPending - 1);
      if (ttsPending === 0 && gen === ttsGen) {
        // 全部播完才熄灭「说话中」；交给调用方 setSpeaking 会提前熄灯
        useChatStore.getState().setSpeaking(false);
      }
    });
  return ttsChain;
}

async function copyText(text: string): Promise<void> {
  try {
    await navigator.clipboard.writeText(text);
  } catch { /* 剪贴板不可用静默 */ }
}

async function shareText(text: string): Promise<void> {
  try {
    if (navigator.share) {
      await navigator.share({ text });
      return;
    }
  } catch { /* 用户取消或不支持 → 退复制 */ }
  await copyText(text);
}

/** AI 气泡底部操作条：复制/播报/赞/踩/转发 */
function BubbleActions({ text }: { text: string }): React.ReactElement {
  const [vote, setVote] = useState<'up' | 'down' | null>(null);
  const btn = (label: string, fn: () => void, on = false): React.ReactElement => (
    <button
      type="button"
      onClick={fn}
      style={{ ...actStyles.btn, ...(on ? actStyles.btnOn : {}) }}
    >
      {label}
    </button>
  );
  return (
    <div style={actStyles.row}>
      {btn('复制', () => void copyText(text))}
      {btn('播报', () => { prewarmAudio(); useChatStore.getState().setSpeaking(true); void speakText(text); })}
      {btn('赞', () => setVote(vote === 'up' ? null : 'up'), vote === 'up')}
      {btn('踩', () => setVote(vote === 'down' ? null : 'down'), vote === 'down')}
      {btn('转发', () => void shareText(text))}
    </div>
  );
}

const actStyles: Record<string, React.CSSProperties> = {
  row: { display: 'flex', gap: 8, marginTop: 6, flexWrap: 'wrap' },
  btn: { border: 'none', background: 'rgba(255,255,255,0.08)', color: '#aaa', borderRadius: 6, padding: '3px 10px', fontSize: 12 },
  btnOn: { background: '#6c5ce7', color: '#fff' },
};

export function ChatPage(): React.ReactElement {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { messages, sending, speaking, streamingText, error, clearError, load, send, sendVoice, setSpeaking, interrupt } =
    useChatStore();
  const { activeId, createSession, load: loadSessions, list, touch } = useSessionStore();
  const config = useSettingsStore((s) => s.config);
  const update = useSettingsStore((s) => s.update);
  const current = useDeviceStore((s) => s.current);
  const remoteMode = useRemoteStore((s) => s.remoteMode);
  const rStreaming = useRemoteStore((s) => s.streamingText);
  const rReply = useRemoteStore((s) => s.replyText);
  const rFiles = useRemoteStore((s) => s.files);
  const rShot = useRemoteStore((s) => s.screenshotB64);
  const rSteps = useRemoteStore((s) => s.steps);
  const preemptedMsg = useRemoteStore((s) => s.preemptedMsg);
  const setPreempted = useRemoteStore((s) => s.setPreempted);
  const [recording, setRecording] = useState(false); // 语音输入（按住说话）进行中
  const [callActive, setCallActive] = useState(false); // 实时通话进行中
  const [callPhase, setCallPhase] = useState<'listen' | 'think' | 'speak'>('listen');
  const [level, setLevel] = useState(0);
  const [online, setOnline] = useState(isOnline());
  const [draft, setDraft] = useState('');
  const [showPlus, setShowPlus] = useState(false);
  const [stageOpen, setStageOpen] = useState(true); // 3D 舞台收起态（T05：上滑/点击收起只留消息流）
  const stageTouchY = useRef(0);
  const recRef = useRef<RecorderHandle | null>(null);
  const callGenRef = useRef(0); // 通话代际：结束/重启递增，作废在途循环
  const callOnRef = useRef(false); // 通话循环开关（闭包内读，避免 state 陈旧）
  const bottomRef = useRef<HTMLDivElement | null>(null);
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [pickAccept, setPickAccept] = useState('image/*');

  const sessionTitle = list.find((s: { id: string; title: string }) => s.id === activeId)?.title || '小巫对话';
  const deviceLabel = remoteMode && current ? current.deviceName : '本机';
  const ttsOn = config?.ttsEnabled !== false;

  useEffect(() => {
    onNetworkChange(setOnline);
    installCmdRouter(); // 回流分发接线（幂等）
    // TTS 逐句播报接线（根因修复：此前只置 speaking 状态、从不合成播放）
    try {
      getOrchestrator().onSentence((seg) => {
        // 尊重「语音播报」开关：关闭时不自动播（气泡「播报」按钮不受限，用户显式点播）
        if (useSettingsStore.getState().config?.ttsEnabled === false) return;
        setSpeaking(true);
        void speakText(seg);
      });
    } catch { /* runtime 未初始化（测试环境）忽略 */ }
    // 离开遥控会话必须释放抢占：否则服务端一直认为本端持有遥控权，其他端进来被 XW5005 卡死
    return () => {
      stopSpeak();
      if (useRemoteStore.getState().remoteMode) void remoteSdk.release().catch(() => undefined);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!user) return;
    void (async () => {
      let sid = activeId;
      if (!sid) {
        const s = await createSession(user.userId, getDeviceId());
        sid = s.id;
      }
      await load(sid);
      await loadSessions(user.userId);
      getSyncSDK().startAuto();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeId]);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText, rStreaming, rReply]);

  const doSend = async (text: string) => {
    const t = text.trim();
    if (!t) return;
    setDraft('');
    prewarmAudio(); // 用户手势内解锁音频（否则 TTS play() 被 WebView 拦）
    // 远程模式：发给电脑执行（chat_text）
    if (remoteMode && remoteSdk.isConnected()) {
      useRemoteStore.getState().clearTurn();
      try {
        await remoteSdk.send('chat_text', { text: t, sessionId: activeId });
      } catch (e) {
        useRemoteStore.getState().setPreempted('发送失败: ' + String((e as Error).message || e));
      }
      return;
    }
    if (!activeId) return;
    const orch = getOrchestrator();
    // TTS 接线在挂载 useEffect 统一注册（根因修复：此前 onSentence 只置状态、从不调 speak）
    try {
      await send(orch, t, activeId);
    } catch {
      /* chatStore 已捕获并上屏 error，此处兜底防未预期异常 */
    }
  };

  const doVoiceStart = async () => {
    if (callActive || callOnRef.current) {
      useChatStore.setState({ error: '实时通话中：点「结束通话」后再用语音输入' });
      return;
    }
    if (!online && !isMockMode()) {
      useChatStore.setState({ error: '离线，恢复网络后再试' });
      return;
    }
    await hapticLight();
    prewarmAudio();
    if (!(await requestMic())) {
      // 根因修复：以前静默 return →「点了没反应」。必须上屏提示
      useChatStore.setState({ error: '麦克风不可用：请在系统设置授予录音权限' });
      return;
    }
    try {
      const handle = await recordStart();
      handle.onLevel(setLevel);
      recRef.current = handle;
      setRecording(true);
    } catch (e) {
      useChatStore.setState({ error: '录音启动失败: ' + String((e as Error).message || e).slice(0, 60) });
    }
  };

  const doVoiceEnd = async () => {
    const handle = recRef.current;
    if (!handle) return;
    recRef.current = null; // 立即清句柄：防二次 stop 空句柄报「录音失败」
    setRecording(false);
    setLevel(0);
    prewarmAudio();
    let wav: Uint8Array | null = null;
    try {
      wav = await handle.stop();
    } catch {
      /* 录音停止失败：走错误上屏 */
    }
    if (!wav || !wav.length) {
      useChatStore.setState({ error: '录音失败，请重试' });
      return;
    }
    // 远程模式：wav → base64 发电脑 ASR+执行
    if (remoteMode && remoteSdk.isConnected()) {
      let b64 = '';
      try {
        // 分块编码：整段展开在长录音（>10 万样本）会爆调用栈
        let s = '';
        for (let i = 0; i < wav.length; i += 0x8000) {
          s += String.fromCharCode(...wav.subarray(i, i + 0x8000));
        }
        b64 = btoa(s);
      } catch {
        useChatStore.setState({ error: '音频编码失败，请重试' });
        return;
      }
      useRemoteStore.getState().clearTurn();
      try {
        await remoteSdk.send('voice', { audio: b64 });
      } catch (e) {
        useRemoteStore.getState().setPreempted('语音发送失败: ' + String((e as Error).message || e));
      }
      return;
    }
    if (!activeId) return;
    const orch = getOrchestrator();
    try {
      await sendVoice(orch, wav, activeId);
    } catch {
      useChatStore.setState({ error: '发送失败，请重试' });
    }
  };

  /* ===== 实时通话（📞）：免按键连续对话——录音→ASR→LLM→TTS→自动再听 ===== */
  const startCall = async () => {
    if (remoteMode && remoteSdk.isConnected()) {
      useChatStore.setState({ error: '通话模式暂不支持遥控会话，请先断开遥控' });
      return;
    }
    if (!online && !isMockMode()) {
      useChatStore.setState({ error: '离线，恢复网络后再试' });
      return;
    }
    await hapticLight();
    prewarmAudio();
    if (!(await requestMic())) {
      useChatStore.setState({ error: '麦克风不可用：请在系统设置授予录音权限' });
      return;
    }
    stopSpeak(); // 进通话先清残留播报
    const gen = ++callGenRef.current;
    callOnRef.current = true;
    setCallActive(true);
    setCallPhase('listen');
    void callLoop(gen);
  };

  const stopCall = () => {
    callOnRef.current = false;
    callGenRef.current++;
    setCallActive(false);
    setCallPhase('listen');
    const h = recRef.current;
    if (h) {
      try { h.cancel(); } catch { /* ignore */ }
      recRef.current = null;
    }
    setLevel(0);
    stopSpeak();
    setSpeaking(false);
  };

  /** 通话中打断：点「说」立即停播报、循环自动续听 */
  const callInterrupt = () => {
    stopSpeak();
    interrupt(getOrchestrator());
    setSpeaking(false);
  };

  const callLoop = async (gen: number) => {
    while (callOnRef.current && gen === callGenRef.current) {
      // ① 录音：最长 15s；说过话后静音 1.2s 自动截止（说完停顿即识别）
      let handle: RecorderHandle;
      try {
        handle = await recordStart();
      } catch (e) {
        useChatStore.setState({ error: '录音启动失败: ' + String((e as Error).message || e).slice(0, 60) });
        break;
      }
      if (!callOnRef.current || gen !== callGenRef.current) {
        try { handle.cancel(); } catch { /* ignore */ }
        return;
      }
      recRef.current = handle;
      setCallPhase('listen');
      setLevel(0);
      let heard = 0;
      handle.onLevel((lv) => {
        setLevel(lv);
        if (lv > 0.08) heard = Date.now();
      });
      const started = Date.now();
      const wav = await new Promise<Uint8Array | null>((resolve) => {
        const iv = setInterval(() => {
          if (!callOnRef.current || gen !== callGenRef.current) {
            clearInterval(iv);
            try { handle.cancel(); } catch { /* ignore */ }
            resolve(null);
            return;
          }
          const now = Date.now();
          const spoken = heard > 0;
          if (now - started > 15000 || (spoken && now - heard > 1200)) {
            clearInterval(iv);
            handle.stop().then(resolve, () => resolve(null));
          }
        }, 200);
      });
      recRef.current = null;
      if (!callOnRef.current || gen !== callGenRef.current) return;
      if (!wav || !wav.length) {
        if (heard === 0 && Date.now() - started >= 15000) continue; // 纯静音轮：不报错继续听
        useChatStore.setState({ error: '录音失败，请重试' });
        continue;
      }
      // ② 发送（ASR→LLM→TTS 逐句，与语音输入同链路）
      setCallPhase('think');
      if (!activeId) break;
      try {
        await sendVoice(getOrchestrator(), wav, activeId);
      } catch { /* chatStore 已上屏 */ }
      if (!callOnRef.current || gen !== callGenRef.current) return;
      // ③ 等本轮播报收尾再续听（点「说」打断 → speaking 变 false 立即续听）
      setCallPhase('speak');
      await new Promise<void>((resolve) => {
        const t0 = Date.now();
        const iv = setInterval(() => {
          const st = useChatStore.getState();
          if (!callOnRef.current || gen !== callGenRef.current || !st.speaking || Date.now() - t0 > 30000) {
            clearInterval(iv);
            resolve();
          }
        }, 300);
      });
      if (!callOnRef.current || gen !== callGenRef.current) return;
    }
    if (gen === callGenRef.current) stopCall(); // 异常 break 收尾（用户点结束则代际已变，不重入）
  };

  return (
    <div style={pageStyles.page}>
      {/* 顶栏：[←][✎] 双行标题 [📞][🔇] */}
      <header style={pageStyles.topBar}>
        <button type="button" aria-label="会话列表" style={pageStyles.topIcon} onClick={() => nav('/sessions')}>←</button>
        <button
          type="button"
          aria-label="重命名会话"
          style={pageStyles.topIcon}
          onClick={() => {
            if (!activeId) return;
            const next = window.prompt('会话名称', sessionTitle);
            if (next && next.trim()) {
              const title = next.trim().slice(0, 30);
              void touch(activeId, title).then(() => {
                // 改名同步上云（新建/删除都有 enqueue，改名原先漏了 → 多端标题不同步）
                void getSyncSDK().enqueue({
                  deviceId: getDeviceId(),
                  entity: 'session',
                  entityId: activeId,
                  action: 'upsert',
                  payload: { id: activeId, title },
                });
              });
            }
          }}
        >
          ✎
        </button>
        <div style={pageStyles.topTitles}>
          <div style={pageStyles.titleMain}>{sessionTitle}</div>
          <div style={pageStyles.titleSub}>{remoteMode ? deviceLabel : '本机对话'}</div>
        </div>
        <button
          type="button"
          aria-label="实时通话"
          style={{ ...pageStyles.topIcon, color: callActive ? '#e5484d' : undefined }}
          onClick={() => void (callActive ? stopCall() : startCall())}
        >
          📞
        </button>
        <button
          type="button"
          aria-label="播报开关"
          style={{ ...pageStyles.topIcon, opacity: ttsOn ? 1 : 0.4 }}
          onClick={() => {
            const next = !ttsOn;
            if (!next) { stopSpeak(); setSpeaking(false); } // 关闭即刻静音（含排队句）
            void update({ ttsEnabled: next });
          }}
        >
          {ttsOn ? '🔊' : '🔇'}
        </button>
      </header>

      {/* 3D 舞台（顶部 ~40% 屏，上滑/点击收起只留消息流） */}
      {stageOpen ? (
        <div
          style={pageStyles.stageWrap}
          onClick={() => setStageOpen(false)}
          onTouchStart={(e) => { stageTouchY.current = e.touches[0].clientY; }}
          onTouchEnd={(e) => {
            const dy = e.changedTouches[0].clientY - stageTouchY.current;
            if (dy < -40) setStageOpen(false); // 上滑收起
          }}
        >
          <AvatarStage height="40vh" />
          <div style={pageStyles.stageHint}>上滑或点击收起 3D 舞台</div>
        </div>
      ) : (
        <button type="button" style={pageStyles.stageBar} onClick={() => setStageOpen(true)}>
          🧙 展开 3D 舞台
        </button>
      )}

      {/* 消息流（豆包式气泡 + AI 底排操作条） */}
      <div style={pageStyles.msgArea}>
        {messages.map((m: Message) => (
          <div key={m.id} style={{ ...pageStyles.bubbleRow, justifyContent: m.role === 'user' ? 'flex-end' : 'flex-start' }}>
            <div style={{ ...pageStyles.bubble, ...(m.role === 'user' ? pageStyles.bubbleUser : pageStyles.bubbleAi) }}>
              <div style={pageStyles.bubbleText}>{m.content}</div>
              {m.role === 'assistant' ? <BubbleActions text={m.content} /> : null}
            </div>
          </div>
        ))}
        {/* 远程会话轮次：流式/回复 + 来源徽标 + 截图/文件卡片 + 步骤计数 */}
        {remoteMode ? (
          <div style={{ ...pageStyles.bubbleRow, justifyContent: 'flex-start' }}>
            <div style={{ ...pageStyles.bubble, ...pageStyles.bubbleAi }}>
              <div style={pageStyles.badge}>在 {deviceLabel} 执行{rSteps.length ? ` · ${rSteps.length} 步` : ''}</div>
              <div style={pageStyles.bubbleText}>{rReply || rStreaming || (sending ? '小巫思考中…' : '')}</div>
              {rShot ? <img style={pageStyles.shot} src={`data:image/png;base64,${rShot}`} alt="电脑截图" /> : null}
              {rFiles.map((f, i) => (
                <div key={`${f.name}-${i}`} style={pageStyles.fileCard}>📎 {f.name}（{Math.round(f.size / 1024)} KB）</div>
              ))}
              {rReply ? <BubbleActions text={rReply} /> : null}
            </div>
          </div>
        ) : null}
        <div ref={bottomRef} />
      </div>

      <TtsStatus speaking={speaking} onStop={() => { stopSpeak(); interrupt(getOrchestrator()); setSpeaking(false); }} />
      <Waveform level={level} active={recording || (callActive && callPhase === 'listen')} />

      {/* 实时通话面板（📞 进入；与 🎙 语音输入完全独立的状态/链路） */}
      {callActive ? (
        <div style={pageStyles.callPanel}>
          <div style={pageStyles.callTitle}>
            {callPhase === 'listen'
              ? '🎙 聆听中…说完停顿即识别'
              : callPhase === 'think'
                ? '💭 思考中…'
                : '🔊 说话中…点「说」打断'}
          </div>
          <div style={pageStyles.callBtns}>
            <button type="button" style={pageStyles.callSay} onClick={callInterrupt}>🎤 说</button>
            <button type="button" style={pageStyles.callEnd} onClick={stopCall}>结束通话</button>
          </div>
        </div>
      ) : null}

      {/* 底部工具条：设备 chip + 选择项目 + ⓘ */}
      <div style={pageStyles.toolRow}>
        <button type="button" style={pageStyles.devChip} onClick={() => nav('/devices')}>
          <span style={pageStyles.dot} /> {deviceLabel}
        </button>
        <button type="button" style={pageStyles.projBtn} onClick={() => nav('/sessions')}>选择项目</button>
        <button type="button" style={pageStyles.infoBtn} aria-label="互通说明" onClick={() => nav('/settings')}>ⓘ</button>
      </div>

      {/* 隐藏文件选择器（📷/＋ 菜单共用） */}
      <input
        ref={fileRef}
        type="file"
        accept={pickAccept}
        style={{ display: 'none' }}
        onChange={(e) => {
          void (async () => {
            const f = e.target.files?.[0];
            e.target.value = ''; // 同一文件可重复选
            if (!f) return;
            setShowPlus(false);
            if (remoteMode && remoteSdk.isConnected()) {
              useChatStore.setState({ error: '' });
              const r = await remoteSdk.sendFile(f);
              if (!r.ok) useRemoteStore.getState().setPreempted('文件发送失败: ' + (r.reason || ''));
            } else {
              useChatStore.setState({ error: '附件需遥控模式：先在「设备」页连接电脑' });
            }
          })();
        }}
      />
      {showPlus ? (
        <div style={pageStyles.plusMenu}>
          <button type="button" style={pageStyles.plusItem} onClick={() => { setPickAccept('image/*'); setTimeout(() => fileRef.current?.click(), 0); }}>📷 发送图片</button>
          <button type="button" style={pageStyles.plusItem} onClick={() => { setPickAccept('*/*'); setTimeout(() => fileRef.current?.click(), 0); }}>📁 发送文件</button>
          <button type="button" style={pageStyles.plusItem} onClick={() => {
            setShowPlus(false);
            if (!(remoteMode && remoteSdk.isConnected())) {
              useChatStore.setState({ error: '截屏需遥控模式：先在「设备」页连接电脑' });
              return;
            }
            void remoteSdk.send('screenshot', {}).catch(() => undefined);
          }}>🖥 查看电脑屏幕</button>
          <button type="button" style={pageStyles.plusItem} onClick={() => { setShowPlus(false); nav('/remote-tools'); }}>🛠 电脑工具遥控</button>
          <button type="button" style={pageStyles.plusItem} onClick={() => { setShowPlus(false); nav('/remote-config'); }}>⚙ 电脑配置遥控</button>
          <button type="button" style={{ ...pageStyles.plusItem, color: '#888' }} onClick={() => setShowPlus(false)}>取消</button>
        </div>
      ) : null}
      <div className="input-dock" style={pageStyles.dock}>
        <button type="button" aria-label="拍照/图片" style={pageStyles.dockIcon} onClick={() => { setPickAccept('image/*'); setTimeout(() => fileRef.current?.click(), 0); }}>📷</button>
        <input
          style={{ ...pageStyles.dockInput, ...(!online && !isMockMode() ? pageStyles.dockInputOff : {}) }}
          placeholder={recording ? '松开发送语音' : !online && !isMockMode() ? '离线，恢复后自动补发' : remoteMode ? '发消息控制电脑' : '发消息或按住说话'}
          disabled={!online && !isMockMode()}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') void doSend(draft); }}
        />
        <button
          type="button"
          aria-label="语音输入"
          style={{ ...pageStyles.dockMic, ...(recording ? pageStyles.dockMicOn : {}) }}
          disabled={!online && !isMockMode()}
          onPointerDown={(e) => {
            // pointer 单通道：原 mouse+touch 双绑会在真机双重触发（二次 stop 报「录音失败」）
            e.preventDefault();
            try { (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId); } catch { /* 某些 WebView 不支持 */ }
            void doVoiceStart();
          }}
          onPointerUp={() => void doVoiceEnd()}
          onPointerCancel={() => void doVoiceEnd()}
        >
          🎙
        </button>
        <button
          type="button"
          aria-label="更多"
          style={pageStyles.dockIcon}
          onClick={() => {
            // 有文本→发送；无文本→展开菜单（以前空文本静默「点了没反应」）
            if (draft.trim()) void doSend(draft);
            else setShowPlus(!showPlus);
          }}
        >
          ＋
        </button>
      </div>

      {sending && !remoteMode ? (
        <div style={pageStyles.thinking}>小巫思考中…</div>
      ) : null}
      {/* 失败必上屏：吞错修复（绝不静默挂起） */}
      {error ? (
        <button type="button" style={pageStyles.errBar} onClick={clearError}>⚠ {error}（点击关闭）</button>
      ) : null}
      {preemptedMsg ? (
        <button type="button" style={pageStyles.errBar} onClick={() => setPreempted('')}>⚠ {preemptedMsg}（点击关闭）</button>
      ) : null}

      {/* 危险操作确认（电脑远程请求 → 同意/拒绝回流） */}
      <RemoteConfirmHost />
    </div>
  );
}

const pageStyles: Record<string, React.CSSProperties> = {
  page: { display: 'flex', flexDirection: 'column', height: '100vh', background: '#12081f', color: '#fff', position: 'relative' },
  topBar: { display: 'flex', alignItems: 'center', gap: 6, padding: '8px 12px', borderBottom: '1px solid rgba(255,255,255,0.1)' },
  topIcon: { border: 'none', background: 'none', color: '#fff', fontSize: 18, width: 34, height: 34 },
  topTitles: { flex: 1, minWidth: 0 },
  titleMain: { fontSize: 15, fontWeight: 600, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  titleSub: { fontSize: 11, opacity: 0.6, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' },
  msgArea: { flex: 1, overflowY: 'auto', padding: '10px 12px' },
  stageWrap: { position: 'relative', cursor: 'pointer' },
  stageHint: { position: 'absolute', bottom: 6, left: '50%', transform: 'translateX(-50%)', fontSize: 11, color: 'rgba(255,255,255,0.5)', pointerEvents: 'none' },
  stageBar: { border: 'none', background: 'rgba(42,26,74,0.8)', color: 'rgba(255,255,255,0.7)', fontSize: 12, padding: '6px 0' },
  bubbleRow: { display: 'flex', marginBottom: 10 },
  bubble: { maxWidth: '78%', borderRadius: 14, padding: '8px 12px' },
  bubbleUser: { background: '#6c5ce7', borderBottomRightRadius: 4 },
  bubbleAi: { background: '#241540', borderBottomLeftRadius: 4 },
  bubbleText: { fontSize: 15, lineHeight: 1.5, whiteSpace: 'pre-wrap', wordBreak: 'break-word' },
  badge: { fontSize: 11, color: '#b8a9f0', marginBottom: 4 },
  shot: { maxWidth: '100%', borderRadius: 8, marginTop: 6 },
  fileCard: { background: 'rgba(255,255,255,0.08)', borderRadius: 8, padding: '6px 10px', marginTop: 6, fontSize: 13 },
  toolRow: { display: 'flex', alignItems: 'center', gap: 10, padding: '6px 12px' },
  devChip: { display: 'flex', alignItems: 'center', gap: 6, border: 'none', background: 'rgba(255,255,255,0.1)', color: '#ddd', borderRadius: 14, padding: '5px 12px', fontSize: 12 },
  dot: { width: 7, height: 7, borderRadius: 4, background: '#22c55e', display: 'inline-block' },
  projBtn: { border: 'none', background: 'rgba(255,255,255,0.08)', color: '#bbb', borderRadius: 14, padding: '5px 12px', fontSize: 12 },
  infoBtn: { border: 'none', background: 'none', color: '#888', fontSize: 15, marginLeft: 'auto' },
  dock: { display: 'flex', alignItems: 'center', gap: 8, padding: '8px 10px 14px' },
  dockIcon: { border: 'none', background: 'rgba(255,255,255,0.1)', borderRadius: '50%', width: 38, height: 38, fontSize: 16, color: '#fff' },
  dockInput: { flex: 1, borderRadius: 20, border: 'none', padding: '10px 14px', fontSize: 14, background: 'rgba(255,255,255,0.12)', color: '#fff', outline: 'none' },
  dockInputOff: { opacity: 0.4 },
  dockMic: { border: 'none', borderRadius: '50%', width: 44, height: 44, fontSize: 20, background: '#6c5ce7', color: '#fff' },
  dockMicOn: { background: '#e5484d' },
  thinking: { position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', fontSize: 12, background: 'rgba(0,0,0,0.5)', borderRadius: 999, padding: '4px 12px' },
  errBar: { position: 'absolute', top: 56, left: '50%', transform: 'translateX(-50%)', fontSize: 12, background: 'rgba(229,72,77,0.85)', border: 'none', borderRadius: 999, padding: '4px 12px', color: '#fff' },
  plusMenu: { position: 'absolute', bottom: 70, left: 10, right: 10, background: '#241640', borderRadius: 12, padding: 6, zIndex: 20, display: 'flex', flexDirection: 'column', boxShadow: '0 8px 24px rgba(0,0,0,0.5)' },
  plusItem: { border: 'none', background: 'none', color: '#eee', textAlign: 'left', padding: '11px 14px', fontSize: 14, borderRadius: 8 },
  callPanel: { position: 'absolute', left: 12, right: 12, bottom: 78, background: 'rgba(36,21,64,0.96)', borderRadius: 14, padding: '12px 14px', zIndex: 15, boxShadow: '0 8px 24px rgba(0,0,0,0.5)', border: '1px solid rgba(229,72,77,0.5)' },
  callTitle: { fontSize: 13, color: '#eee', marginBottom: 10, textAlign: 'center' },
  callBtns: { display: 'flex', gap: 10, justifyContent: 'center' },
  callSay: { border: 'none', borderRadius: 999, padding: '9px 22px', fontSize: 14, background: '#6c5ce7', color: '#fff' },
  callEnd: { border: 'none', borderRadius: 999, padding: '9px 22px', fontSize: 14, background: '#e5484d', color: '#fff' },
};
