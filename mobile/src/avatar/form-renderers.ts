/**
 * T08 四形态渲染器（FR-309~312 / Q10/Q11）：
 * 3d=ThreeStage 复用；2d=PNG 立绘 + CSS 动效；live2d=Pixi（与 three 互斥初始化，
 * 仅用户自备授权模型 + 免责，Q10）；video=WebM alpha 循环（≤50MB/≤30s，Q11）。
 * 统一接口 {mount, unmount, setMouth, playClip, dispose}。
 * 渲染栈互斥（§7 共享知识 3）：同一时刻只启一个渲染栈——切形态先 dispose 再 mount。
 */
import type { AvatarSpec } from '@xw/shared';
import { ThreeStage } from '../three/renderer';
import { loadAvatar } from './avatar-loader';

export interface FormRenderer {
  mount(container: HTMLElement): Promise<void>;
  unmount(): void;
  setMouth(open: number): void;
  playClip(name: string): void;
  /** 当前帧快照 dataURL（悬浮窗贴图源；不可快照返回 null） */
  snapshot(): string | null;
  dispose(): void;
}

/* ============ 渲染栈互斥闸（three 与 Pixi 同刻只活一个） ============ */
type StackKind = 'three' | 'pixi' | 'dom';
let activeStack: StackKind | null = null;

function occupyStack(stack: StackKind): void {
  if (activeStack && activeStack !== stack) {
    throw new Error(`渲染栈互斥冲突：${activeStack} 未释放不得初始化 ${stack}（先 dispose 再 mount）`);
  }
  activeStack = stack;
}

function releaseStack(stack: StackKind): void {
  if (activeStack === stack) activeStack = null;
}

/* ============ 3D：ThreeStage 复用（loadModel 居中勿回退） ============ */

class ThreeFormRenderer implements FormRenderer {
  private stage: ThreeStage | null = null;
  private canvas: HTMLCanvasElement | null = null;
  private spec: AvatarSpec;

  constructor(spec: AvatarSpec) {
    this.spec = spec;
  }

  async mount(container: HTMLElement): Promise<void> {
    occupyStack('three');
    this.canvas = document.createElement('canvas');
    this.canvas.className = 'w-full h-full touch-none';
    container.appendChild(this.canvas);
    this.stage = new ThreeStage(this.canvas);
    if (this.spec.kind === 'glb' || this.spec.kind === 'gltf' || this.spec.kind === 'fbx' || this.spec.kind === 'vrm') {
      const resolved = await loadAvatar(this.spec);
      await this.stage.loadAvatarHandle(resolved);
    } else {
      await this.stage.loadModel(this.spec.uri || '/models/mage-a.glb');
    }
  }

  unmount(): void {
    this.stage?.dispose();
    this.stage = null;
    this.canvas?.remove();
    this.canvas = null;
    releaseStack('three');
  }

  setMouth(open: number): void {
    // three 形态口型走 setSpeaking 微动（Head 节点）；open>0.3 视作说话
    this.stage?.setSpeaking(open > 0.3);
  }

  playClip(name: string): void {
    this.stage?.playClip(name);
  }

  snapshot(): string | null {
    return this.stage?.snapshot() ?? null;
  }

  dispose(): void {
    this.unmount();
  }
}

/* ============ 2D：PNG 立绘 + CSS 动效（Waveform 语音反馈由外层叠） ============ */

class SpriteFormRenderer implements FormRenderer {
  private img: HTMLImageElement | null = null;
  private wrap: HTMLDivElement | null = null;
  private spec: AvatarSpec;
  private raf = 0;

  constructor(spec: AvatarSpec) {
    this.spec = spec;
  }

  async mount(container: HTMLElement): Promise<void> {
    occupyStack('dom');
    const wrap = document.createElement('div');
    wrap.className = 'w-full h-full flex items-center justify-center overflow-hidden';
    const img = document.createElement('img');
    img.src = this.spec.uri;
    img.alt = this.spec.name || 'avatar';
    img.style.height = '92%';
    img.style.transformOrigin = 'bottom center';
    img.style.transition = 'transform 0.3s ease';
    wrap.appendChild(img);
    container.appendChild(wrap);
    this.wrap = wrap;
    this.img = img;
    // Q15 兜底呼吸/摆动动效（CSS 立绘通用）
    const start = performance.now();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      if (!this.img) return;
      const t = (performance.now() - start) / 1000;
      const s = (this.spec.scale || 1) * (1 + Math.sin(t * 2.2) * 0.012);
      const sway = Math.sin(t * 1.5) * 1.2;
      this.img.style.transform = `translateY(${(this.spec.offsetY || 0) * 10}px) rotate(${sway}deg) scale(${s})`;
    };
    tick();
  }

  unmount(): void {
    cancelAnimationFrame(this.raf);
    this.wrap?.remove();
    this.wrap = null;
    this.img = null;
    releaseStack('dom');
  }

  setMouth(open: number): void {
    // 立绘口型：轻微缩放脉冲近似（Waveform 波形由外层语音反馈）
    if (this.img) this.img.style.filter = open > 0.4 ? 'brightness(1.06)' : '';
  }

  playClip(name: string): void {
    if (!this.img) return;
    // 简表动效映射：happy=弹跳 / sad=下垂 / dance=左右摆
    const map: Record<string, string> = {
      happy: 'translateY(-4px) scale(1.03)',
      sad: 'translateY(4px) scale(0.98)',
      dance: 'rotate(4deg)',
    };
    const one = map[name] || '';
    if (one) {
      this.img.style.transform = one;
      setTimeout(() => {
        if (this.img) this.img.style.transform = '';
      }, 600);
    }
  }

  snapshot(): string | null {
    const img = this.img;
    if (!img || !img.complete || !img.naturalWidth) return null;
    try {
      const c = document.createElement('canvas');
      c.width = img.naturalWidth;
      c.height = img.naturalHeight;
      c.getContext('2d')?.drawImage(img, 0, 0);
      return c.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.unmount();
  }
}

/* ============ Live2D：Pixi（Q10 用户自备授权 + 免责；与 three 互斥） ============ */

class Live2dFormRenderer implements FormRenderer {
  private app: { destroy: (v: boolean) => void; stage: { removeChildren: () => void }; ticker: { stop: () => void } } | null = null;
  private pixiCanvas: HTMLCanvasElement | null = null;
  private model: { destroy?: () => void; speak?: (v?: string) => void; motion?: (g: string, i?: number) => void } | null = null;
  private spec: AvatarSpec;

  constructor(spec: AvatarSpec) {
    this.spec = spec;
  }

  async mount(container: HTMLElement): Promise<void> {
    occupyStack('pixi');
    let PIXI: typeof import('pixi.js');
    let live2dMod: { Live2DModel: new () => { autoInteract: boolean; scale: { set: (n: number) => void }; anchor: { set: (x: number, y: number) => void }; x: number; y: number; width: number; destroy?: () => void; speak?: (v?: string) => void; motion?: (g: string, i?: number) => void; on: (e: string, cb: () => void) => void } };
    try {
      PIXI = await import('pixi.js');
      live2dMod = (await import('pixi-live2d-display')) as never;
    } catch {
      throw new Error('Live2D 运行时组件缺失：请安装 pixi.js 与 pixi-live2d-display（Q10 需用户自备授权模型）');
    }
    const canvas = document.createElement('canvas');
    canvas.className = 'w-full h-full';
    container.appendChild(canvas);
    this.pixiCanvas = canvas;
    const app = new PIXI.Application();
    await (app as unknown as { init: (o: unknown) => Promise<void> }).init({
      canvas,
      backgroundAlpha: 0,
      resizeTo: container,
    });
    this.app = app as never;
    const model = new live2dMod.Live2DModel();
    model.autoInteract = false;
    await (model as unknown as { from: (u: string, o?: unknown) => Promise<unknown> }).constructor === undefined
      ? Promise.resolve()
      : Promise.resolve();
    // 加载用户自备模型（.model3.json）；失败给免责文案
    try {
      const m = await (live2dMod.Live2DModel as unknown as { from: (u: string) => Promise<typeof model> }).from(this.spec.uri);
      m.scale.set(this.spec.scale || 1);
      m.anchor.set(0.5, 1);
      m.x = container.clientWidth / 2;
      m.y = container.clientHeight * (0.92 - (this.spec.offsetY || 0) * 0.1);
      (this.app as unknown as { stage: { addChild: (o: unknown) => void } }).stage.addChild(m);
      this.model = m as never;
    } catch {
      throw new Error('Live2D 模型加载失败：仅支持用户自备授权的 Cubism 4 模型（含 .model3.json）');
    }
  }

  unmount(): void {
    try {
      this.model?.destroy?.();
      this.app?.ticker.stop();
      this.app?.destroy(true);
    } catch {
      /* 释放异常不阻塞切形态 */
    }
    this.model = null;
    this.app = null;
    this.pixiCanvas?.remove();
    this.pixiCanvas = null;
    releaseStack('pixi');
  }

  setMouth(open: number): void {
    if (open > 0.3) this.model?.speak?.();
  }

  playClip(name: string): void {
    this.model?.motion?.(name || 'Idle', 0);
  }

  snapshot(): string | null {
    try {
      return this.pixiCanvas ? this.pixiCanvas.toDataURL('image/png') : null;
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.unmount();
  }
}

/* ============ 视频：WebM alpha 循环（Q11：≤50MB、≤30s） ============ */

class VideoFormRenderer implements FormRenderer {
  private video: HTMLVideoElement | null = null;
  private wrap: HTMLDivElement | null = null;
  private spec: AvatarSpec;

  constructor(spec: AvatarSpec) {
    this.spec = spec;
  }

  async mount(container: HTMLElement): Promise<void> {
    occupyStack('dom');
    const wrap = document.createElement('div');
    wrap.className = 'w-full h-full flex items-center justify-center overflow-hidden';
    const v = document.createElement('video');
    v.src = this.spec.uri;
    v.loop = true;
    v.muted = true;
    v.autoplay = true;
    v.playsInline = true;
    v.style.height = '92%';
    v.style.transform = `scale(${this.spec.scale || 1})`;
    wrap.appendChild(v);
    container.appendChild(wrap);
    this.wrap = wrap;
    this.video = v;
    await v.play().catch(() => undefined);
    // Q11：≤30s 循环约束在 validator/loader 复检；超长按损坏退（导入流程给文案）
    v.onloadedmetadata = () => {
      if (Number.isFinite(v.duration) && v.duration > 30) {
        v.currentTime = 0;
        v.loop = true;
      }
    };
  }

  unmount(): void {
    if (this.video) {
      this.video.pause();
      this.video.removeAttribute('src');
      this.video.load();
    }
    this.wrap?.remove();
    this.wrap = null;
    this.video = null;
    releaseStack('dom');
  }

  setMouth(_open: number): void {
    // 视频口型内嵌于素材（WebM alpha 自带表演），不外部驱动
  }

  playClip(name: string): void {
    // 视频单 clip 循环；name 事件忽略（或由素材侧分段）
    void name;
  }

  snapshot(): string | null {
    const v = this.video;
    if (!v || !v.videoWidth) return null;
    try {
      const c = document.createElement('canvas');
      c.width = v.videoWidth;
      c.height = v.videoHeight;
      c.getContext('2d')?.drawImage(v, 0, 0);
      return c.toDataURL('image/png');
    } catch {
      return null;
    }
  }

  dispose(): void {
    this.unmount();
  }
}

/* ============ 工厂（AvatarStage / PetRenderer 分发用） ============ */

export function createFormRenderer(spec: AvatarSpec, _container?: HTMLElement | null): FormRenderer {
  switch (spec.form) {
    case '2d':
      return new SpriteFormRenderer(spec);
    case 'live2d':
      return new Live2dFormRenderer(spec);
    case 'video':
      return new VideoFormRenderer(spec);
    case '3d':
    default:
      return new ThreeFormRenderer(spec);
  }
}
