/**
 * 6 个内置技能 schema + 纯 JS 实现（FR-105）：
 * set_animation / get_animation_list / idle_forever / get_current_time / get_weather / get_app_version
 * function calling 注册制；纯逻辑无 Node/Electron 依赖，动画经回调桥接到 AvatarRenderer。
 */
import type { ToolDef } from './types';

export interface SkillContext {
  /** 动画触发桥（mobile: AvatarRenderer.playClip；Electron: mageAPI.onSkillAnimation 同源） */
  triggerAnimation: (clip: string) => void;
  /** set_animation / idle_forever 的动画清单（与 CLIP_ALIAS 对齐） */
  animationList: string[];
  /** get_weather 用（M1 简化：可注入 mock 或真实实现） */
  weatherProvider?: (city: string) => string;
  /** get_app_version */
  appVersion: string;
}

export interface SkillImpl {
  name: string;
  toolDef: ToolDef;
  execute: (args: Record<string, unknown>, ctx: SkillContext) => Promise<string> | string;
}

const ANIMATION_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'set_animation',
    description: '让数字人播放指定动画/动作（如跳舞 dance、打招呼 greet、施法 cast）。用户要求做动作时调用。',
    parameters: {
      type: 'object',
      properties: {
        name: {
          type: 'string',
          description: '动画名：idle/greet/dance/cast/call/angry/happy/sad/agree/walk/fight/play/sit/talk/basketball',
        },
      },
      required: ['name'],
    },
  },
};

const LIST_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'get_animation_list',
    description: '列出数字人全部可用动画名称。',
    parameters: { type: 'object', properties: {} },
  },
};

const IDLE_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'idle_forever',
    description: '让数字人回到待机（idle）状态并一直保持。',
    parameters: { type: 'object', properties: {} },
  },
};

const TIME_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'get_current_time',
    description: '获取当前日期与时间。用户问“现在几点/今天几号”时调用。',
    parameters: { type: 'object', properties: {} },
  },
};

const WEATHER_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'get_weather',
    description: '查询指定城市当前天气。用户问天气时调用。',
    parameters: {
      type: 'object',
      properties: { city: { type: 'string', description: '城市名，如：北京' } },
      required: ['city'],
    },
  },
};

const VERSION_TOOL: ToolDef = {
  type: 'function',
  function: {
    name: 'get_app_version',
    description: '获取小巫智能应用版本号。',
    parameters: { type: 'object', properties: {} },
  },
};

/** 全部 6 个内置技能实现 */
export const BUILTIN_SKILLS: SkillImpl[] = [
  {
    name: 'set_animation',
    toolDef: ANIMATION_TOOL,
    execute(args, ctx) {
      const name = String(args.name || '').toLowerCase();
      if (ctx.animationList.includes(name) || name) {
        ctx.triggerAnimation(name);
        return `动画 ${name} 已播放`;
      }
      return '未知动画名';
    },
  },
  {
    name: 'get_animation_list',
    toolDef: LIST_TOOL,
    execute(_args, ctx) {
      return `可用动画：${ctx.animationList.join('、')}`;
    },
  },
  {
    name: 'idle_forever',
    toolDef: IDLE_TOOL,
    execute(_args, ctx) {
      ctx.triggerAnimation('idle');
      return '已进入待机状态';
    },
  },
  {
    name: 'get_current_time',
    toolDef: TIME_TOOL,
    execute() {
      const now = new Date();
      const week = ['日', '一', '二', '三', '四', '五', '六'][now.getDay()];
      const pad = (n: number) => String(n).padStart(2, '0');
      return `现在是 ${now.getFullYear()} 年 ${now.getMonth() + 1} 月 ${now.getDate()} 日 星期${week} ${pad(now.getHours())}:${pad(now.getMinutes())}`;
    },
  },
  {
    name: 'get_weather',
    toolDef: WEATHER_TOOL,
    async execute(args, ctx) {
      const city = String(args.city || '').trim() || '北京';
      if (ctx.weatherProvider) return ctx.weatherProvider(city);
      // 默认 Mock（离线可走查）：真实天气接 API 由注入的 weatherProvider 完成
      return `${city} 晴 25℃ 湿度 40%`;
    },
  },
  {
    name: 'get_app_version',
    toolDef: VERSION_TOOL,
    execute(_args, ctx) {
      return `小巫智能 ${ctx.appVersion}`;
    },
  },
];

/** 全部工具 schema（传给 LLM tools 参数） */
export function builtinToolDefs(): ToolDef[] {
  return BUILTIN_SKILLS.map((s) => s.toolDef);
}

/** 按 name 执行技能；未命中返回 null */
export async function runBuiltinSkill(
  name: string,
  args: Record<string, unknown>,
  ctx: SkillContext,
): Promise<string | null> {
  const skill = BUILTIN_SKILLS.find((s) => s.name === name);
  if (!skill) return null;
  return skill.execute(args, ctx);
}

/** CLIP_ALIAS 简表（动画分类 → 候选 clip），与 renderer/app.js 对齐 */
export const ANIMATION_CATEGORIES = [
  'idle', 'greet', 'dance', 'cast', 'call', 'angry', 'happy', 'sad',
  'agree', 'walk', 'fight', 'play', 'sit', 'talk', 'basketball',
];
