import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.xiaowu.mage',
  appName: '小巫智能',
  webDir: 'www',
  android: {
    allowMixedContent: true,
  },
  plugins: {
    SplashScreen: {
      launchShowDuration: 0,
    },
    // 根因修复：接管原生 fetch/XHR 走 OkHttp，绕过 WebView CORS——
    // LLM/ASR/TTS API 无 Access-Control-Allow-Origin 头时 WebView fetch 被拦，
    // link-test 误报「DNS/网络不可达」（实测三端点均 200，仅缺 CORS 头）。
    CapacitorHttp: {
      enabled: true,
    },
  },
};

export default config;
