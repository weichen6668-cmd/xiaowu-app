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
async function speakText(text: string): Promise<void> {
  const t = text.slice(0, 500);
  if (!t) return;
  try {
    const key = await readApiKey('tts');
    const row = { ...useSettingsStore.getState().ttsRow(), apiKey: key };
    const audio = await createTtsClient(() => row).synthesize(t);
    if (audio && audio.length) {
      const url = URL.createObjectURL(new Blob([audio.buffer as ArrayBuffer]));
      const el = new Audio(url);
      el.onended = () => URL.revokeObjectURL(url);
      await el.play();
      return;
    }
  } catch { /* 合成失败退系统 TTS */ }
  try {
    window.speechSynthesis.speak(new SpeechSynthesisUtterance(t));
  } catch { /* 无系统 TTS 则静默（点击即触发，无挂起态） */ }
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
      {btn('播报', () => void speakText(text))}
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
  const { activeId, createSession, load: loadSessions, list } = useSessionStore();
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
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [online, setOnline] = useState(isOnline());
  const [draft, setDraft] = useState('');
  const [showPlus, setShowPlus] = useState(false);
  const [stageOpen, setStageOpen] = useState(true); // 3D 舞台收起态（T05：上滑/点击收起只留消息流）
  const stageTouchY = useRef(0);
  const recRef = useRef<RecorderHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const sessionTitle = list.find((s: { id: string; title: string }) => s.id === activeId)?.title || '小巫对话';
  const deviceLabel = remoteMode && current ? current.deviceName : '本机';
  const ttsOn = config?.ttsEnabled !== false;

  useEffect(() => {
    onNetworkChange(setOnline);
    installCmdRouter(); // 回流分发接线（幂等）
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
    orch.onSentence(() => setSpeaking(true));
    setSpeaking(true);
    try {
      await send(orch, t, activeId);
    } catch {
      /* chatStore 已捕获并上屏 error，此处兜底防未预期异常 */
    } finally {
      setSpeaking(false);
    }
  };

  const doVoiceStart = async () => {
    if (!online && !isMockMode()) return;
    await hapticLight();
    if (!(await requestMic())) return;
    const handle = await recordStart();
    handle.onLevel(setLevel);
    recRef.current = handle;
    setRecording(true);
  };

  const doVoiceEnd = async () => {
    const handle = recRef.current;
    if (!handle) return;
    setRecording(false);
    setLevel(0);
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
        b64 = btoa(String.fromCharCode(...Array.from(wav)));
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
    setSpeaking(true);
    try {
      await sendVoice(orch, wav, activeId);
    } catch {
      useChatStore.setState({ error: '发送失败，请重试' });
    } finally {
      setSpeaking(false);
    }
  };

  return (
    <div style={pageStyles.page}>
      {/* 顶栏：[←][✎] 双行标题 [📞][🔇] */}
      <header style={pageStyles.topBar}>
        <button type="button" aria-label="会话列表" style={pageStyles.topIcon} onClick={() => nav('/sessions')}>←</button>
        <button type="button" aria-label="新会话" style={pageStyles.topIcon} onClick={() => void createSession(user?.userId || '', getDeviceId())}>✎</button>
        <div style={pageStyles.topTitles}>
          <div style={pageStyles.titleMain}>{sessionTitle}</div>
          <div style={pageStyles.titleSub}>{remoteMode ? deviceLabel : '本机对话'}</div>
        </div>
        <button type="button" aria-label="语音通话" style={pageStyles.topIcon} onClick={() => void doVoiceStart()}>📞</button>
        <button
          type="button"
          aria-label="播报开关"
          style={{ ...pageStyles.topIcon, opacity: ttsOn ? 1 : 0.4 }}
          onClick={() => void update({ ttsEnabled: !ttsOn })}
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

      <TtsStatus speaking={speaking} onStop={() => interrupt(getOrchestrator())} />
      <Waveform level={level} active={recording} />

      {/* 底部工具条：设备 chip + 选择项目 + ⓘ */}
      <div style={pageStyles.toolRow}>
        <button type="button" style={pageStyles.devChip} onClick={() => nav('/devices')}>
          <span style={pageStyles.dot} /> {deviceLabel}
        </button>
        <button type="button" style={pageStyles.projBtn} onClick={() => nav('/sessions')}>选择项目</button>
        <button type="button" style={pageStyles.infoBtn} aria-label="互通说明" onClick={() => nav('/settings')}>ⓘ</button>
      </div>

      {/* 输入坞：[📷][发消息或按住说话][语音圆钮][＋] */}
      <div className="input-dock" style={pageStyles.dock}>
        <button type="button" aria-label="拍照/图片" style={pageStyles.dockIcon} onClick={() => setShowPlus(!showPlus)}>📷</button>
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
          aria-label="语音"
          style={{ ...pageStyles.dockMic, ...(recording ? pageStyles.dockMicOn : {}) }}
          disabled={!online && !isMockMode()}
          onMouseDown={() => void doVoiceStart()}
          onMouseUp={() => void doVoiceEnd()}
          onTouchStart={(e) => { e.preventDefault(); void doVoiceStart(); }}
          onTouchEnd={(e) => { e.preventDefault(); void doVoiceEnd(); }}
        >
          🎙
        </button>
        <button type="button" aria-label="更多" style={pageStyles.dockIcon} onClick={() => void doSend(draft)}>＋</button>
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
};
