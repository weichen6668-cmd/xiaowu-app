/**
 * T06 悬浮引导页（FR-306 分步）：①悬浮窗权限 → ②电池白名单 → ③验证显示。
 * 失败回退「App 内使用」明示差异（iOS 整页隐藏入口，由路由守卫拦截）。
 */
import React, { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useOverlayStore } from '../store/overlayStore';

type StepState = 'todo' | 'done' | 'fail';

export function OverlayGuidePage(): React.ReactElement {
  const nav = useNavigate();
  const { supported, show, hide, visible } = useOverlayStore();
  const [perm, setPerm] = useState<StepState>('todo');
  const [battery, setBattery] = useState<StepState>('todo');
  const [verify, setVerify] = useState<StepState>('todo');
  const [msg, setMsg] = useState('');

  const refreshPerm = async (): Promise<void> => {
    // permissionState 经 overlay 桥直查（与 store 解耦，引导页只读判定）
    const st = await (await import('../platform/overlay')).overlay.permissionState();
    setPerm(st.overlay ? 'done' : 'todo');
    setBattery(st.battery ? 'done' : 'todo');
  };

  useEffect(() => {
    if (!supported) return;
    void refreshPerm();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [supported]);

  const onReqPerm = async (): Promise<void> => {
    try {
      const ov = await import('../platform/overlay');
      await ov.overlay.requestOverlayPermission();
      setMsg('请在系统设置中开启「显示在其他应用上层」，返回后点「已开启」');
    } catch (e) {
      setMsg('❌ 打开系统设置失败：' + ((e as Error).message || String(e)).slice(0, 60) + '（可手动到系统设置开启）');
    }
  };

  const onReqBattery = async (): Promise<void> => {
    try {
      const ov = await import('../platform/overlay');
      await ov.overlay.requestBatteryIgnore();
      setMsg('请允许「忽略电池优化」，返回后点「已开启」');
    } catch (e) {
      setMsg('❌ 打开电池白名单失败：' + ((e as Error).message || String(e)).slice(0, 60) + '（可手动到系统设置开启）');
    }
  };

  const onVerify = async (): Promise<void> => {
    setVerify('todo');
    setMsg('');
    const ok = await show('ball');
    if (ok) {
      setVerify('done');
      setMsg('✅ 悬浮球已显示——拖到边缘试试吸附，点按开迷你窗，双击切桌宠');
    } else {
      setVerify('fail');
      setMsg('❌ 未能显示悬浮窗。可回退「App 内使用」：功能一致但需保持 App 在前台。');
    }
  };

  const step = (n: number, title: string, state: StepState, action: () => void, btn: string) => (
    <div className="rounded-lg bg-white/5 p-3 mb-3">
      <div className="flex items-center justify-between">
        <p className="text-sm">
          {n}. {title}{' '}
          <span className="text-xs">
            {state === 'done' ? '✓' : state === 'fail' ? '✗' : ''}
          </span>
        </p>
        <button type="button" className="text-xs text-brand-light px-2 py-1 rounded bg-white/10" onClick={action}>
          {btn}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex flex-col min-h-screen bg-[#12081f] text-white">
      <header className="flex items-center px-4 py-3 border-b border-white/10">
        <button type="button" onClick={() => nav('/settings')} className="text-sm opacity-70 mr-3">
          ←
        </button>
        <span className="font-semibold">桌面悬浮引导</span>
      </header>

      <div className="p-4 text-sm">
        {!supported ? (
          <p className="text-xs text-amber-300/80 leading-relaxed">
            ℹ️ iOS 暂不支持桌面悬浮（系统限制）。可在 App 内使用全部功能；灵动岛形态在后续版本评估。
          </p>
        ) : (
          <>
            {step(1, '悬浮窗权限（显示在其他应用上层）', perm, () => void onReqPerm(), '去开启')}
            {step(2, '电池白名单（防进程被杀）', battery, () => void onReqBattery(), '去开启')}
            {step(3, '验证显示悬浮球', verify, () => void onVerify(), '验证')}
            <div className="flex gap-2 mb-3">
              <button type="button" className="text-xs opacity-70" onClick={() => void refreshPerm()}>
                已开启（刷新状态）
              </button>
              {visible ? (
                <button type="button" className="text-xs opacity-70" onClick={() => void hide()}>
                  收起悬浮
                </button>
              ) : null}
            </div>
            {msg ? <p className="text-xs leading-relaxed">{msg}</p> : null}
            <p className="mt-4 text-xs text-amber-300/80 leading-relaxed">
              ℹ️ 差异说明：App 内使用需保持前台；桌面悬浮可后台常驻、边缘吸附、迷你对话窗。
              RAM&lt;4GB 机型默认省电模式（8fps/静态），可在设置中手动调整（手动开关最高优先）。
            </p>
          </>
        )}
      </div>
    </div>
  );
}
