/**
 * T07 形象库 store（FR-304/305/308）：importAvatar（校验→拷贝入沙箱→hash 去重→
 * 元数据入库）/ apply（写 config.avatarSpec + enqueue user_config op LWW）/ remove / list。
 * 红线：资源本体仅本地（IndexedDB blob），不进 oplog/云表（§7 共享知识 1）；
 * 元数据（AvatarSpec）随 user_config 走 LWW。
 */
import { create } from 'zustand';
import type { AvatarSpec } from '@xw/shared';
import { validate } from '../avatar/avatar-validator';
import { hashFile } from '../avatar/avatar-loader';
import { useSettingsStore } from './settingsStore';
import { getSyncSDK } from '../platform/runtime';

const LS_META = 'xw.avatars.v1';
const IDB_NAME = 'xw-avatar';
const IDB_STORE = 'files';

interface AvatarRecord {
  spec: AvatarSpec;
  createdAt: string;
}

/* ============ IndexedDB blob 持久化（WebView 标准 API；重启后重建 blob: URL） ============ */

function idbOpen(): Promise<IDBDatabase> {
  return new Promise((res, rej) => {
    const req = indexedDB.open(IDB_NAME, 1);
    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(IDB_STORE)) req.result.createObjectStore(IDB_STORE);
    };
    req.onsuccess = () => res(req.result);
    req.onerror = () => rej(req.error || new Error('IndexedDB 打开失败'));
  });
}

async function idbPut(id: string, blob: Blob): Promise<void> {
  const db = await idbOpen();
  await new Promise<void>((res, rej) => {
    const tx = db.transaction(IDB_STORE, 'readwrite');
    tx.objectStore(IDB_STORE).put(blob, id);
    tx.oncomplete = () => res();
    tx.onerror = () => rej(tx.error || new Error('写入失败'));
  });
  db.close();
}

async function idbGet(id: string): Promise<Blob | null> {
  try {
    const db = await idbOpen();
    const out = await new Promise<Blob | null>((res) => {
      const tx = db.transaction(IDB_STORE, 'readonly');
      const r = tx.objectStore(IDB_STORE).get(id);
      r.onsuccess = () => res((r.result as Blob) || null);
      r.onerror = () => res(null);
    });
    db.close();
    return out;
  } catch {
    return null;
  }
}

async function idbDelete(id: string): Promise<void> {
  try {
    const db = await idbOpen();
    await new Promise<void>((res) => {
      const tx = db.transaction(IDB_STORE, 'readwrite');
      tx.objectStore(IDB_STORE).delete(id);
      tx.oncomplete = () => res();
      tx.onerror = () => res();
    });
    db.close();
  } catch {
    /* 删除失败不阻塞 */
  }
}

function loadMeta(): AvatarRecord[] {
  try {
    return JSON.parse(localStorage.getItem(LS_META) || '[]') as AvatarRecord[];
  } catch {
    return [];
  }
}

function saveMeta(list: AvatarRecord[]): void {
  localStorage.setItem(LS_META, JSON.stringify(list));
}

/** 为 spec 重建 blob: URL（重启后 uri 失效，加载前调用） */
async function resolveUri(spec: AvatarSpec): Promise<AvatarSpec> {
  if (spec.uri.startsWith('blob:') || spec.uri.startsWith('idb://')) {
    const blob = await idbGet(spec.hash);
    if (blob) return { ...spec, uri: URL.createObjectURL(blob) };
  }
  return spec;
}

interface AvatarState {
  list: AvatarRecord[];
  importError: string;
  importing: boolean;
  /** 导入：校验→hash 去重→blob 持久→元数据入库。失败返回 null（importError 给三态文案） */
  importAvatar(file: File, name?: string): Promise<AvatarSpec | null>;
  /** 应用为当前形象：config.avatarSpec + user_config op（LWW） */
  apply(spec: AvatarSpec): Promise<void>;
  remove(hash: string): Promise<void>;
  /** 取可加载 spec（重建 blob URL） */
  resolve(spec: AvatarSpec): Promise<AvatarSpec>;
  clearError(): void;
}

export const useAvatarStore = create<AvatarState>((set, get) => ({
  list: loadMeta(),
  importError: '',
  importing: false,

  async importAvatar(file, name): Promise<AvatarSpec | null> {
    set({ importing: true, importError: '' });
    try {
      const v = await validate(file);
      if (!v.ok || !v.kind || !v.form) {
        set({ importing: false, importError: v.reason || '导入失败' });
        return null;
      }
      const hash = await hashFile(file);
      const exist = get().list.find((r) => r.spec.hash === hash);
      if (exist) {
        set({ importing: false });
        return exist.spec; // 去重：同 hash 直接复用
      }
      await idbPut(hash, file);
      const spec: AvatarSpec = {
        form: v.form,
        kind: v.kind,
        uri: 'idb://' + hash,
        hash,
        scale: 1,
        offsetY: 0,
        name: name || file.name.replace(/\.[a-z0-9]+$/i, '').slice(0, 20) || '自定义形象',
      };
      const rec: AvatarRecord = { spec, createdAt: new Date().toISOString() };
      const list = [...get().list, rec];
      saveMeta(list);
      set({ list, importing: false });
      return spec;
    } catch (e) {
      set({ importing: false, importError: '文件损坏：' + ((e as Error).message || '读取失败').slice(0, 60) });
      return null;
    }
  },

  async apply(spec): Promise<void> {
    const resolved = await resolveUri(spec);
    const cfg = useSettingsStore.getState().config;
    await useSettingsStore.getState().update({ avatarSpec: { ...resolved, uri: spec.uri } });
    // FR-308：元数据进 user_config op（LWW）；资源本体不同步
    if (cfg) {
      void getSyncSDK().enqueue({
        deviceId: cfg.deviceId,
        entity: 'user_config',
        entityId: cfg.userId,
        action: 'upsert',
        payload: {
          userId: cfg.userId,
          deviceId: cfg.deviceId,
          avatarSpec: { ...spec, uri: '' }, // uri 本地路径脱敏（跨端无意义，Q14 近似映射只看 form/kind/hash）
        } as Record<string, unknown>,
      });
    }
  },

  async remove(hash): Promise<void> {
    await idbDelete(hash);
    const list = get().list.filter((r) => r.spec.hash !== hash);
    saveMeta(list);
    set({ list });
    // 删除当前 → 自动回退默认（FR-310）
    const cur = useSettingsStore.getState().config?.avatarSpec;
    if (cur && cur.hash === hash) {
      await useSettingsStore.getState().update({ avatarSpec: null });
    }
  },

  async resolve(spec): Promise<AvatarSpec> {
    return resolveUri(spec);
  },

  clearError(): void {
    set({ importError: '' });
  },
}));
