/**
 * 触控手势：单指旋转 / 双指缩放 / 双击归位（触控版拖拽缩放，FR-103）。
 */
import type { ThreeStage } from './renderer';

export function bindGestures(el: HTMLElement, stage: ThreeStage): () => void {
  let lastX = 0;
  let lastY = 0;
  let rotating = false;
  let pinchStartDist = 0;
  let pinchStartZoom = 1;
  let lastTap = 0;

  const dist = (t: TouchList): number => {
    const a = t[0];
    const b = t[1];
    return Math.hypot(a.clientX - b.clientX, a.clientY - b.clientY);
  };

  const onTouchStart = (e: TouchEvent) => {
    if (e.touches.length === 1) {
      rotating = true;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      const now = Date.now();
      if (now - lastTap < 300) {
        stage.resetPose(); // 双击归位
        lastTap = 0;
      } else {
        lastTap = now;
      }
    } else if (e.touches.length === 2) {
      rotating = false;
      pinchStartDist = dist(e.touches);
      pinchStartZoom = stage.zoom;
    }
  };

  const onTouchMove = (e: TouchEvent) => {
    e.preventDefault();
    if (e.touches.length === 1 && rotating) {
      const dx = e.touches[0].clientX - lastX;
      lastX = e.touches[0].clientX;
      lastY = e.touches[0].clientY;
      stage.applyRotateY(dx * 0.01);
    } else if (e.touches.length === 2 && pinchStartDist > 0) {
      const d = dist(e.touches);
      stage.applyZoom((pinchStartZoom * d) / pinchStartDist);
    }
  };

  const onTouchEnd = () => {
    rotating = false;
    pinchStartDist = 0;
    void lastY;
  };

  el.addEventListener('touchstart', onTouchStart, { passive: true });
  el.addEventListener('touchmove', onTouchMove, { passive: false });
  el.addEventListener('touchend', onTouchEnd, { passive: true });

  return () => {
    el.removeEventListener('touchstart', onTouchStart);
    el.removeEventListener('touchmove', onTouchMove);
    el.removeEventListener('touchend', onTouchEnd);
  };
}
