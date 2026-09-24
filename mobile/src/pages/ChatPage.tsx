/**
 * 主对话页（FR-103/104/106）：3D 舞台 + 对话流 + 输入条（按住说话/文字切换）。
 * 键盘弹起输入条上移不遮挡；断网置灰提示（Q7）。
 */
import React, { useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AvatarStage } from '../components/AvatarStage';
import { BubbleList } from '../components/BubbleList';
import { InputBar } from '../components/InputBar';
import { Waveform } from '../components/Waveform';
import { TtsStatus } from '../components/TtsStatus';
import { useChatStore } from '../store/chatStore';
import { useSessionStore } from '../store/sessionStore';
import { useAuthStore } from '../store/authStore';
import { getOrchestrator, getDeviceId, getSyncSDK } from '../platform/runtime';
import { recordStart, isOnline, onNetworkChange, hapticLight, requestMic, isMockMode } from '../platform/bridge';
import type { RecorderHandle } from '../platform/bridge';

export function ChatPage(): React.ReactElement {
  const nav = useNavigate();
  const user = useAuthStore((s) => s.user);
  const { messages, sending, speaking, streamingText, load, send, sendVoice, setSpeaking, interrupt } =
    useChatStore();
  const { activeId, createSession } = useSessionStore();
  const [recording, setRecording] = useState(false);
  const [level, setLevel] = useState(0);
  const [online, setOnline] = useState(isOnline());
  const recRef = useRef<RecorderHandle | null>(null);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  // 网络状态监听（断网置灰）
  useEffect(() => {
    onNetworkChange(setOnline);
  }, []);

  // 会话就绪 + 加载历史
  useEffect(() => {
    if (!user) return;
    void (async () => {
      let sid = activeId;
      if (!sid) {
        const s = await createSession(user.userId, getDeviceId());
        sid = s.id;
      }
      await load(sid);
      getSyncSDK().startAuto();
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user, activeId]);

  // 键盘弹起：visualViewport 缩放 → 输入条上移不遮挡
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const onResize = () => {
      const el = document.querySelector('.input-dock');
      if (el) {
        (el as HTMLElement).style.transform = `translateY(-${Math.max(0, window.innerHeight - vv.height - vv.offsetTop)}px)`;
      }
    };
    vv.addEventListener('resize', onResize);
    return () => vv.removeEventListener('resize', onResize);
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages.length, streamingText]);

  const doSend = async (text: string) => {
    if (!activeId) return;
    const orch = getOrchestrator();
    orch.onSentence(() => setSpeaking(true));
    setSpeaking(true);
    await send(orch, text, activeId);
    setSpeaking(false);
  };

  const doVoiceStart = async () => {
    if (!online) return;
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
    const wav = await handle.stop();
    // Q1：wav 转写后即删本地临时，不上云（局部引用直接丢弃）
    if (!activeId) return;
    const orch = getOrchestrator();
    setSpeaking(true);
    await sendVoice(orch, wav, activeId);
    setSpeaking(false);
  };

  return (
    <div className="flex flex-col h-screen bg-[#12081f] text-white">
      {/* 顶栏 */}
      <header className="flex items-center justify-between px-4 py-3 border-b border-white/10">
        <button type="button" aria-label="会话列表" className="text-xl" onClick={() => nav('/sessions')}>
          ☰
        </button>
        <span className="font-semibold">小巫智能</span>
        <button type="button" aria-label="设置" className="text-xl" onClick={() => nav('/settings')}>
          ⚙️
        </button>
      </header>

      {/* 3D 舞台（~50% 屏） */}
      <AvatarStage />

      {/* 对话流 */}
      <BubbleList messages={messages} streamingText={streamingText} />
      <div ref={bottomRef} />

      <TtsStatus speaking={speaking} onStop={() => interrupt(getOrchestrator())} />
      <Waveform level={level} active={recording} />

      {/* 输入条 */}
      <InputBar
        disabled={!online && !isMockMode()}
        disabledTip="离线，恢复后自动补发"
        recording={recording}
        level={level}
        onSendText={(t) => void doSend(t)}
        onVoiceStart={() => void doVoiceStart()}
        onVoiceEnd={() => void doVoiceEnd()}
      />

      {sending ? (
        <div className="absolute top-14 left-1/2 -translate-x-1/2 text-xs bg-black/50 rounded-full px-3 py-1">
          小巫思考中…
        </div>
      ) : null}
    </div>
  );
}
