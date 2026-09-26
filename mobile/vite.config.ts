import { defineConfig, loadEnv } from 'vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';

// 读取 .env.local / .env（VITE_ 前缀）：VITE_DATA_BACKEND=mock|supabase|xiaowu、
// VITE_SUPABASE_URL、VITE_SUPABASE_ANON_KEY —— 密钥只在 env，禁止硬编码进源文件
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, __dirname, 'VITE_');
  const raw = env.VITE_DATA_BACKEND;
  const dataBackend = raw === 'supabase' ? 'supabase' : raw === 'xiaowu' ? 'xiaowu' : 'mock';

  return {
    plugins: [react()],
    define: {
      __DATA_BACKEND__: JSON.stringify(dataBackend),
      __SUPABASE_URL__: JSON.stringify(env.VITE_SUPABASE_URL || ''),
      __SUPABASE_ANON__: JSON.stringify(env.VITE_SUPABASE_ANON_KEY || ''),
    },
    resolve: {
      alias: {
        // 源码直编 shared（Vite 编译 TS 源，免先跑 tsc）
        '@xw/shared': path.resolve(__dirname, '../shared/src/index.ts'),
      },
    },
    server: {
      port: 5173,
      host: true,
      // 放行公网隧道随机域名（SSH 反向隧道），供手机外网访问开发服务器；
      // 前缀点号表示放行该域名下所有子域名（隧道子域随机，无法写死单个）。
      // 仅限开发期使用，切勿照搬到生产环境。
      allowedHosts: [
        '.lhr.life',
        '.localhost.run',
        '.serveousercontent.com',
        '.serveo.net',
        '.ngrok-free.app',
        '.ngrok.io',
        '.trycloudflare.com',
      ],
    },
    build: {
      outDir: 'www',
      emptyOutDir: true,
      chunkSizeWarningLimit: 2200,
    },
  };
});
