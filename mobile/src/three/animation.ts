/**
 * 47 段动画情境映射 + triggerByText + 口型 setSpeaking（移植 renderer/app.js 227~415 行段）。
 * 本文件导出纯映射表与调度器，渲染桥接由 ThreeStage 承担。
 */

/** 情境类别（15 类，47 段 clip 分布于各类候选池） */
export const CLIP_ALIAS: Record<string, string[]> = {
  idle: ['preset:biped:idle', 'preset:biped:wait', 'preset:biped:standing_relax'],
  greet: ['preset:biped:greet_03', 'preset:biped:greet_04', 'preset:biped:bow'],
  dance: ['preset:biped:dance_04', 'preset:biped:dance_03', 'preset:biped:dance_05'],
  cast: ['preset:biped:cast_a_spell'],
  call: ['preset:biped:make_a_call_01', 'preset:biped:make_a_call_02'],
  angry: ['preset:biped:angry_01', 'preset:biped:angry_02', 'preset:biped:angry_03',
    'preset:biped:frustrated_01', 'preset:biped:frustrated_02', 'preset:biped:complain_01'],
  happy: ['preset:biped:cheer', 'preset:biped:clap', 'preset:biped:laugh_01', 'preset:biped:heart_pose'],
  sad: ['preset:biped:depressed', 'preset:biped:afraid', 'preset:biped:frightened'],
  agree: ['preset:biped:agree'],
  walk: ['preset:biped:walk', 'preset:biped:run', 'preset:biped:swagger'],
  fight: ['preset:biped:slash', 'preset:biped:front_kick_01', 'preset:biped:front_kick_02',
    'preset:biped:box_01', 'preset:biped:box_02', 'preset:biped:box_03', 'preset:biped:chop',
    'preset:biped:press-up', 'preset:biped:lift_heavy', 'preset:biped:flip', 'preset:biped:fall',
    'preset:biped:defeat_03', 'preset:biped:freaky'],
  play: ['preset:biped:play_mobile_game', 'preset:biped:play_video_game'],
  sit: ['preset:biped:sit'],
  talk: ['preset:biped:sing_03'],
  basketball: ['preset:biped:basketball_shot'],
};

/** 中文触发词 → 情境类别（与 app.js ZH_TRIGGERS 对齐） */
export const ZH_TRIGGERS: Record<string, string[]> = {
  idle: ['待机', '发呆', '休息', '闲着', '没事'],
  greet: ['你好', '您好', '嗨', '哈喽', 'hi', '拜拜', '再见', '打招呼', '鞠躬', '欢迎', '好久不见'],
  dance: ['跳舞', '舞蹈', '斗舞', '蹦迪', '扭秧歌', '跳个舞', '来一段', '舞一曲', '摇摆', '跳个', '唱跳'],
  cast: ['施法', '念咒', '魔法', '变魔术', '发波', '放个技能', '巫术', '咒语'],
  call: ['打电话', '通话', '接电话', '拨号', '打个电话', '联络'],
  angry: ['生气', '愤怒', '气死', '火大', '抱怨', '烦躁', '不爽', '恼火', '讨厌', '烦死'],
  happy: ['开心', '高兴', '快乐', '鼓掌', '欢呼', '耶', '太好了', '太棒了', '大笑', '庆祝', '爽了'],
  sad: ['难过', '伤心', '害怕', '恐惧', '委屈', '哭', '失落', '沮丧', '担心', '慌', '怕'],
  agree: ['同意', '好的', '行', '点头', '可以', '没问题', '赞成', '好呀', '行啊'],
  walk: ['走路', '散步', '跑步', '走', '溜达', '漫步', '小跑', '走两步', '出去走走'],
  fight: ['打架', '战斗', '挥拳', '踢', '打', '搏斗', '拳击', '劈砍', '练武', '打拳', '揍', '踢腿'],
  play: ['玩手机', '玩游戏', '看手机', '刷手机', '玩一会', '刷抖音', '看视频'],
  sit: ['坐下', '坐', '蹲着', '坐着', '落座', '坐会', '坐一下'],
  talk: ['唱歌', '说话', '讲话', '聊聊', '唱', '说几句', '哼歌', '高歌'],
  basketball: ['篮球', '投篮', '打球', '投球', '三分', '扣篮'],
};

/** 文本 → 类别（同轮去重由 caller 用 firedSet 控制） */
export function categoryByText(text: string): string | null {
  const t = String(text || '');
  for (const [cat, words] of Object.entries(ZH_TRIGGERS)) {
    if (cat === 'idle') continue;
    if (words.some((w) => t.includes(w))) return cat;
  }
  return null;
}

/** 空闲动作调度器（40~90s 随机生活小动作，播完回 idle） */
export class IdleScheduler {
  private timer: ReturnType<typeof setTimeout> | null = null;
  private busy = false;

  constructor(private play: (clip: string) => void) {}

  schedule(): void {
    if (this.timer) clearTimeout(this.timer);
    const delay = 40000 + Math.random() * 50000;
    this.timer = setTimeout(() => {
      this.timer = null;
      if (this.busy) {
        this.schedule();
        return;
      }
      const acts = [
        'preset:biped:play_mobile_game',
        'preset:biped:play_video_game',
        'preset:biped:standing_relax',
        'preset:biped:wait',
        'preset:biped:agree',
        'preset:biped:heart_pose',
        'preset:biped:bow',
      ];
      this.play(acts[Math.floor(Math.random() * acts.length)]);
      this.schedule();
    }, delay);
  }

  setBusy(b: boolean): void {
    this.busy = b;
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
  }
}
