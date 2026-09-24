/**
 * 入口挂载（T01/T12）：首启权限引导（麦克风/通知，FR-101）+ runtime 初始化。
 */
import React from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initRuntime } from './platform/runtime';
import { initNetworkWatch, requestMic, isMockMode } from './platform/bridge';
import { openDb } from './db/repo';
import './index.css';

/** 首启权限引导：麦克风（+通知），每项最多弹一次（localStorage 标记） */
async function firstLaunchGuide(): Promise<void> {
  const seen = localStorage.getItem('xw.perm.guide') === '1';
  if (seen || isMockMode()) return;
  await requestMic();
  try {
    if (typeof Notification !== 'undefined' && Notification.permission === 'default') {
      await Notification.requestPermission();
    }
  } catch {
    /* WebView 不支持通知时忽略 */
  }
  localStorage.setItem('xw.perm.guide', '1');
}

async function bootstrap(): Promise<void> {
  await openDb();
  await initNetworkWatch();
  await initRuntime();
  void firstLaunchGuide();
  const el = document.getElementById('root');
  if (el) {
    createRoot(el).render(
      <React.StrictMode>
        <App />
      </React.StrictMode>,
    );
  }
}

void bootstrap();
