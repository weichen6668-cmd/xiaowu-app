/**
 * Three.js 场景/灯光/GLB+meshopt 加载（移植 renderer/app.js 36~225 行段）。
 * WebGL2 + meshopt；目标高度 4.4，FOV 38，相机距离 8。
 */
import * as THREE from 'three';
import { GLTFLoader } from 'three/examples/jsm/loaders/GLTFLoader.js';
import { MeshoptDecoder } from 'three/examples/jsm/libs/meshopt_decoder.module.js';
import type { AvatarRenderer } from '@xw/shared';
import type { AvatarHandle } from '../avatar/avatar-loader';

const FOV = 38;
const CAM_DIST = 8;
const TARGET_HEIGHT = 4.4;
const FACING = 0;

export type MuxReady = (ready: boolean) => void;

export class ThreeStage implements AvatarRenderer {
  private renderer: THREE.WebGLRenderer;
  private scene = new THREE.Scene();
  private camera: THREE.PerspectiveCamera;
  private loader = new GLTFLoader();
  private modelRoot = new THREE.Group();
  private mixer: THREE.AnimationMixer | null = null;
  private actions: Record<string, THREE.AnimationAction> = {};
  private currentAction: THREE.AnimationAction | null = null;
  private currentClip = '';
  private headNode: THREE.Object3D | null = null;
  private raf = 0;
  private onReadyCb: MuxReady | null = null;
  private speaking = false;
  /** T07 Q15：非标骨骼兜底摆动（无骨架时整体轻微摇摆/呼吸） */
  private fallbackSway = false;
  private fallbackSwayStart = 0;
  zoom = 1;

  constructor(canvas: HTMLCanvasElement) {
    this.loader.setMeshoptDecoder(MeshoptDecoder as never);
    this.renderer = new THREE.WebGLRenderer({ canvas, alpha: true, antialias: true });
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio, 1.5));
    this.renderer.setClearColor(0x000000, 0);
    this.scene.add(this.modelRoot);

    this.camera = new THREE.PerspectiveCamera(FOV, 1, 0.1, 100);
    this.camera.position.set(0, TARGET_HEIGHT / 2, CAM_DIST);
    this.camera.lookAt(0, TARGET_HEIGHT / 2, 0);

    // 灯光（与 app.js 对齐）
    this.scene.add(new THREE.HemisphereLight(0xbfd4ff, 0x2a1a3a, 0.85));
    const key = new THREE.DirectionalLight(0xfff2e0, 1.6);
    key.position.set(4, 6, 5);
    this.scene.add(key);
    const rim = new THREE.DirectionalLight(0x8f6bff, 1.1);
    rim.position.set(-5, 3, -4);
    this.scene.add(rim);
    const fill = new THREE.DirectionalLight(0x88ccff, 0.4);
    fill.position.set(0, 2, -6);
    this.scene.add(fill);

    this.resize();
    window.addEventListener('resize', () => this.resize());
    this.loop();
  }

  onReady(cb: MuxReady): void {
    this.onReadyCb = cb;
  }

  private resize(): void {
    const canvas = this.renderer.domElement;
    const parent = canvas.parentElement;
    const w = parent ? parent.clientWidth : window.innerWidth;
    const h = parent ? parent.clientHeight : window.innerHeight * 0.5;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / Math.max(1, h);
    this.camera.updateProjectionMatrix();
  }

  private loop(): void {
    const clock = new THREE.Clock();
    const tick = () => {
      this.raf = requestAnimationFrame(tick);
      const dt = clock.getDelta();
      if (this.mixer) this.mixer.update(dt);
      // 口型微动（Head）
      if (this.speaking && this.headNode) {
        const t = performance.now() / 120;
        this.headNode.rotation.x = Math.sin(t) * 0.02;
      }
      // Q15 兜底摆动：无骨架/非标骨骼 → 整体轻微摆动 + 呼吸缩放
      if (this.fallbackSway) {
        const t = (performance.now() - this.fallbackSwayStart) / 1000;
        this.modelRoot.rotation.z = Math.sin(t * 1.6) * 0.03;
        const b = this.zoom * (1 + Math.sin(t * 2.2) * 0.015);
        this.modelRoot.scale.setScalar(b);
      }
      this.renderer.render(this.scene, this.camera);
    };
    tick();
  }

  private disposeModel(): void {
    if (this.mixer) {
      this.mixer.stopAllAction();
      this.mixer = null;
    }
    this.modelRoot.clear();
    this.modelRoot.rotation.z = 0;
    this.actions = {};
    this.currentAction = null;
    this.currentClip = '';
    this.headNode = null;
    this.fallbackSway = false;
  }

  async loadModel(url: string): Promise<void> {
    this.disposeModel();
    const g = await new Promise<{ scene: THREE.Group; animations: THREE.AnimationClip[] }>((resolve, reject) => {
      this.loader.load(url, (gtf) => resolve(gtf as never), undefined, (err) => reject(err));
    });
    const model = g.scene;
    model.rotation.y = FACING;
    this.modelRoot.add(model);

    // 适配尺寸：目标高度，X/Z 居中 + 底部对齐 y=0
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = TARGET_HEIGHT / size.y;
    model.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    this.zoom = 1;

    model.traverse((o) => {
      if (o.name === 'Head') this.headNode = o;
    });

    this.mixer = new THREE.AnimationMixer(model);
    g.animations.forEach((clip) => {
      this.actions[clip.name] = this.mixer!.clipAction(clip);
    });
    this.mixer.addEventListener('finished', () => {
      this.playClip('preset:biped:idle');
    });
    this.playClip('preset:biped:idle');
    this.onReadyCb?.(true);
  }

  /** T07：自定义形象（AvatarHandle——GLB/GLTF/FBX/VRM 统一产物）挂载。
   *  居中/归一化与 loadModel 完全一致（X/Z 居中 + 底部对齐 y=0），勿回退。 */
  async loadAvatarHandle(handle: AvatarHandle): Promise<void> {
    this.disposeModel();
    this.fallbackSway = false;
    const model = handle.scene;
    model.rotation.y = FACING;
    this.modelRoot.add(model);

    // 适配尺寸：目标高度，X/Z 居中 + 底部对齐 y=0（与 loadModel 同段落，保持一致）
    const box = new THREE.Box3().setFromObject(model);
    const size = box.getSize(new THREE.Vector3());
    const scale = TARGET_HEIGHT / size.y;
    model.scale.setScalar(scale);
    const center = box.getCenter(new THREE.Vector3());
    model.position.set(-center.x * scale, -box.min.y * scale, -center.z * scale);
    this.zoom = 1;

    model.traverse((o) => {
      if (o.name === 'Head') this.headNode = o;
    });

    // Q15：非标骨骼兜底——无骨架时不装配 mixer，走整体摆动/呼吸兜底动效
    if (!handle.hasSkeleton) {
      this.fallbackSway = true;
      this.fallbackSwayStart = performance.now();
      this.onReadyCb?.(true);
      return;
    }

    this.mixer = new THREE.AnimationMixer(model);
    handle.animations.forEach((clip) => {
      this.actions[clip.name] = this.mixer!.clipAction(clip);
    });
    if (handle.animations.length) {
      this.mixer.addEventListener('finished', () => {
        this.playClip('idle');
      });
      this.playClip('idle');
    }
    this.onReadyCb?.(true);
  }

  /** 解析 clip 名（含类别→候选池随机） */
  resolveClip(name: string): string | null {
    const key = String(name || '').toLowerCase();
    if (this.actions[key]) return key;
    // 简表类别池（与 skills-core ANIMATION_CATEGORIES 对齐）
    const pools: Record<string, string[]> = {
      idle: ['preset:biped:idle', 'preset:biped:wait', 'preset:biped:standing_relax'],
      greet: ['preset:biped:greet_03', 'preset:biped:greet_04', 'preset:biped:bow'],
      dance: ['preset:biped:dance_04', 'preset:biped:dance_03', 'preset:biped:dance_05'],
      cast: ['preset:biped:cast_a_spell'],
      call: ['preset:biped:make_a_call_01', 'preset:biped:make_a_call_02'],
      happy: ['preset:biped:cheer', 'preset:biped:clap', 'preset:biped:laugh_01'],
      sad: ['preset:biped:depressed', 'preset:biped:afraid'],
      fight: ['preset:biped:slash', 'preset:biped:box_01'],
      walk: ['preset:biped:walk', 'preset:biped:run'],
      talk: ['preset:biped:sing_03'],
    };
    const pool = pools[key];
    if (pool) {
      const cands = pool.filter((c) => this.actions[c]);
      if (cands.length) return cands[Math.floor(Math.random() * cands.length)];
    }
    const hit = Object.keys(this.actions).find((c) => c.toLowerCase().includes(key));
    return hit || null;
  }

  playClip(name: string): void {
    if (!this.mixer) return;
    const clip = this.resolveClip(name);
    if (!clip) return;
    const next = this.actions[clip];
    if (this.currentAction && this.currentAction !== next) this.currentAction.fadeOut(0);
    next.reset().fadeIn(0);
    const once = clip !== 'preset:biped:idle' && clip !== 'preset:biped:talk';
    next.setLoop(once ? THREE.LoopOnce : THREE.LoopRepeat, once ? 1 : Infinity);
    next.clampWhenFinished = once;
    next.play();
    this.currentAction = next;
    this.currentClip = clip;
  }

  /** 中文/英文触发词 → 动画（47 段映射精简表，触发词与 app.js ZH_TRIGGERS 对齐） */
  triggerByText(text: string): void {
    const t = String(text || '');
    const triggers: Record<string, string[]> = {
      dance: ['跳舞', '蹦迪', '跳个舞', '唱跳'],
      greet: ['你好', '您好', '嗨', '再见', '打招呼'],
      cast: ['施法', '魔法', '变魔术', '咒语'],
      call: ['打电话', '接电话', '拨号'],
      angry: ['生气', '愤怒', '气死', '烦'],
      happy: ['开心', '高兴', '太棒', '耶', '欢呼'],
      sad: ['难过', '伤心', '害怕', '哭'],
      agree: ['同意', '好的', '没问题', '点头'],
      walk: ['散步', '跑步', '走路'],
      fight: ['打架', '战斗', '踢', '挥拳'],
      play: ['玩手机', '玩游戏'],
      sit: ['坐下', '坐着'],
      talk: ['唱歌', '哼歌'],
      basketball: ['篮球', '投篮'],
    };
    for (const [cat, words] of Object.entries(triggers)) {
      if (words.some((w) => t.includes(w))) {
        this.playClip(cat);
        return;
      }
    }
  }

  /** 口型同步开关（说话微动 + talk clip） */
  setSpeaking(on: boolean): void {
    this.speaking = on;
    if (on) {
      this.playClip('talk');
    } else {
      if (this.headNode) this.headNode.rotation.set(0, 0, 0);
      this.playClip('idle');
    }
  }

  /** 手势：缩放（gestures.ts 调） */
  applyZoom(scale: number): void {
    this.zoom = Math.max(0.55, Math.min(1.8, scale));
    this.modelRoot.scale.setScalar(this.zoom);
  }

  applyRotateY(delta: number): void {
    this.modelRoot.rotation.y += delta;
  }

  resetPose(): void {
    this.modelRoot.rotation.y = 0;
    this.applyZoom(1);
  }

  dispose(): void {
    cancelAnimationFrame(this.raf);
    this.disposeModel();
  }
}
