/**
 * AvatarStage — 形象渲染舞台（T08 形态分发）。
 * 按 settings.avatarSpec.form 分发到 form-renderers：
 *   3d(默认/glb/gltf/fbx/vrm) → three 栈 · 2d → DOM 立绘 · live2d → Pixi · video → WebM。
 * 悬浮/主端/预览共用；切形态走 occupyStack 栈互斥（先 dispose 再 mount）。
 * 红线：loadModel 居中逻辑在 three/renderer.ts 未回退（本文件仅委托）。
 */
import React, { useEffect, useRef, useState } from 'react';
import type { AvatarSpec } from '@xw/shared';
import { useSettingsStore } from '../store/settingsStore';
import { useAvatarStore } from '../store/avatarStore';
import { createFormRenderer, type FormRenderer } from '../avatar/form-renderers';

/** 内置默认 spec（无自定义形象时走 three 内置 GLB——由 ThreeStage.loadModel 承载） */
const BUILTIN_SPEC: AvatarSpec = { form: '3d', kind: 'glb', uri: '/models/mage-a.glb', hash: 'builtin', scale: 1, offsetY: 0 };

type Props = {
  /** 渲染高度（CSS 字符串 "40vh" 或数字=vh 数，默认 62） */
  height?: string | number;
  /** 手势回调（保留 T07 签名；2D/视频形态不绑 3D 手势但保留回调位） */
  onGesture?: (g: string) => void;
  /** 形象变更回调（悬浮同步 FR-311） */
  onAvatarChange?: (spec: AvatarSpec | null) => void;
};

/**
 * 形象舞台组件。form=3d 或缺省走内置 3D（ThreeFormRenderer 内部 loadModel 兜底）。
 * 2D/视频形态的 Waveform 语音反馈由外层（ChatPage）叠加，FR-309。
 */
export function AvatarStage({ height = 62, onGesture, onAvatarChange }: Props): React.ReactElement {
  const hostRef = useRef<HTMLDivElement | null>(null);
  const rendererRef = useRef<FormRenderer | null>(null);
  const [spec, setSpec] = useState<AvatarSpec | null>(null);
  const [err, setErr] = useState<string>('');
  const heightCss = typeof height === 'number' ? `${height}vh` : height;

  useEffect(() => {
    // 初始读 + 订阅 config.avatarSpec 变化（zustand subscribe，字段级比较防抖重渲）
    const cur = useSettingsStore.getState().config;
    setSpec(cur?.avatarSpec ?? null);
    const off = useSettingsStore.subscribe((c) => {
      const next = c.config?.avatarSpec ?? null;
      setSpec((prev) => {
        if (prev?.hash === next?.hash && prev?.form === next?.form && prev?.uri === next?.uri) return prev;
        return next;
      });
      if (onAvatarChange) onAvatarChange(next);
    });
    return () => off();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const host = hostRef.current;
    if (!host) return undefined;
    let cancelled = false;
    // T08 栈互斥在 createFormRenderer.mount 内部 occupyStack 处理——此处先卸旧再挂新
    const prev = rendererRef.current;
    if (prev) {
      try { prev.unmount(); prev.dispose(); } catch { /* noop */ }
      rendererRef.current = null;
    }
    setErr('');
    const active = spec ?? BUILTIN_SPEC;
    (async () => {
      try {
        // idb:// 资源先重建 blob: URL（重启后持久 URI 失效，T07 avatarStore.resolve）
        const resolved = await useAvatarStore.getState().resolve(active);
        if (cancelled) return;
        const r = await createFormRenderer(resolved, host);
        if (cancelled) { r.dispose(); return; }
        await r.mount(host);
        rendererRef.current = r;
      } catch (e) {
        if (!cancelled) setErr(e instanceof Error ? e.message : String(e));
      }
    })();
    // 口型/动作事件总线（avatarSetMouth / avatarPlayClip → 当前 renderer）
    const onMouth = (ev: Event) => {
      const open = (ev as CustomEvent<{ open: number }>).detail?.open ?? 0;
      rendererRef.current?.setMouth(open);
    };
    const onClip = (ev: Event) => {
      const clip = (ev as CustomEvent<{ clip: string }>).detail?.clip ?? 'idle';
      rendererRef.current?.playClip(clip);
    };
    window.addEventListener('xw.avatar.mouth', onMouth);
    window.addEventListener('xw.avatar.clip', onClip);
    return () => {
      cancelled = true;
      window.removeEventListener('xw.avatar.mouth', onMouth);
      window.removeEventListener('xw.avatar.clip', onClip);
      const r = rendererRef.current;
      if (r) {
        try { r.unmount(); r.dispose(); } catch { /* noop */ }
        rendererRef.current = null;
      }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [spec?.form, spec?.hash, spec?.uri]);

  // 手势：保留回调位（3D 形态由 renderer 内部事件上抛的扩展点——当前统一 DOM 轻量手势）
  useEffect(() => {
    if (!onGesture) return undefined;
    const host = hostRef.current;
    if (!host) return undefined;
    const onTap = () => onGesture('tap');
    host.addEventListener('pointerup', onTap);
    return () => host.removeEventListener('pointerup', onTap);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [onGesture]);

  return (
    <div
      ref={hostRef}
      data-testid="avatar-stage"
      style={{ width: '100%', height: heightCss, position: 'relative', overflow: 'hidden' }}
    >
      {err ? (
        <div className="absolute inset-0 flex items-center justify-center text-xs text-red-300 px-4 text-center">
          渲染失败：{err}
        </div>
      ) : null}
    </div>
  );
}

/** 口型开合（悬浮/主端音频桥调用） */
export function avatarSetMouth(open: number): void {
  window.dispatchEvent(new CustomEvent('xw.avatar.mouth', { detail: { open } }));
}
/** 动作播放（tap/doubletap/…） */
export function avatarPlayClip(clip: string): void {
  window.dispatchEvent(new CustomEvent('xw.avatar.clip', { detail: { clip } }));
}
