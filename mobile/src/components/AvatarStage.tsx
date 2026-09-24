/**
 * 3D 舞台容器（FR-103）：ThreeStage + 手势绑定 + 动画桥注册。
 */
import React, { useEffect, useRef } from 'react';
import { ThreeStage } from '../three/renderer';
import { bindGestures } from '../three/gestures';
import { setAnimationTrigger } from '../platform/runtime';
import { useSettingsStore } from '../store/settingsStore';

export interface AvatarStageProps {
  onReady?: (stage: ThreeStage) => void;
}

export function AvatarStage({ onReady }: AvatarStageProps): React.ReactElement {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const stageRef = useRef<ThreeStage | null>(null);
  const avatarModel = useSettingsStore((s) => s.config?.avatarModel || 'mage-a');

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const stage = new ThreeStage(canvas);
    stageRef.current = stage;
    // 内置 2 个 GLB（mage-b 现为 mage-a 占位复制品，待美术替换）
    const url = avatarModel === 'mage-b' ? '/models/mage-b.glb' : '/models/mage-a.glb';
    void stage.loadModel(url);
    const unbind = bindGestures(canvas, stage);
    // 动画桥（skills/编排层 → 3D）
    setAnimationTrigger((clip: string) => stage.playClip(clip));
    onReady?.(stage);
    return () => {
      unbind();
      stage.dispose();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [avatarModel]);

  return (
    <div className="relative w-full h-[50vh] bg-gradient-to-b from-[#2a1a4a] to-[#12081f]" data-testid="avatar-stage">
      <canvas ref={canvasRef} className="w-full h-full touch-none" />
    </div>
  );
}
