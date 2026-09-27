/**
 * 形象帧快照注册表（悬浮窗贴图源）。
 * AvatarStage 挂载时注册 provider（返回 dataURL 或 null），卸载时清空。
 * overlayStore.pushAvatarTexture 读取后 base64 推原生 GL 面（Q14 近似渲染）。
 */
let provider: (() => string | null) | null = null;

export function setSnapshotProvider(fn: (() => string | null) | null): void {
  provider = fn;
}

export function getAvatarSnapshot(): string | null {
  try {
    return provider ? provider() : null;
  } catch {
    return null;
  }
}
