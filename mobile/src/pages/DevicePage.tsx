/**
 * DevicePage — 设备页（T05 P0，PRD UI）
 * 卡片列表：设备名 / 系统图标 / 在线点 / 最后在线；「连接」；配对弹窗入口。
 * 数据源：deviceStore（ECS /api/devices + MQTT presence）。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useDeviceStore } from '../store/deviceStore';
import { useRemoteStore } from '../store/remoteStore';
import PairDialog from '../components/PairDialog';

function osIcon(os: string): string {
  const s = String(os || '').toLowerCase();
  if (s.includes('mac') || s.includes('darwin')) return '';
  if (s.includes('win')) return '🪟';
  if (s.includes('linux')) return '🐧';
  return '💻';
}

function fmtTime(iso: string): string {
  if (!iso) return '从未在线';
  const t = new Date(iso).getTime();
  if (!Number.isFinite(t)) return '未知';
  const diff = Date.now() - t;
  if (diff < 90 * 1000) return '刚刚';
  if (diff < 3600 * 1000) return Math.floor(diff / 60000) + ' 分钟前';
  return new Date(t).toLocaleString('zh-CN');
}

export default function DevicePage() {
  const navigate = useNavigate();
  const devices = useDeviceStore((s) => s.devices);
  const refresh = useDeviceStore((s) => s.refresh);
  const setCurrent = useDeviceStore((s) => s.setCurrent);
  const setRemoteMode = useRemoteStore((s) => s.setRemoteMode);
  const [pairOpen, setPairOpen] = useState(false);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const connect = (d: typeof devices[number]) => {
    setCurrent(d);
    setRemoteMode(true);
    navigate('/'); // 进入遥控会话（ChatPage）
  };

  return (
    <div style={styles.page}>
      <div style={styles.topBar}>
        <button style={styles.back} onClick={() => navigate(-1)}>←</button>
        <div style={styles.topTitle}>设备管理</div>
        <button style={styles.pairBtn} onClick={() => setPairOpen(true)}>配对</button>
      </div>

      {devices.length === 0 ? (
        <div style={styles.empty}>
          <div style={styles.emptyIcon}>💻</div>
          <div style={styles.emptyText}>还没有设备，点右上角「配对」连接你的电脑</div>
        </div>
      ) : (
        devices.map((d) => {
          const online = d.online || Date.now() - new Date(d.lastSeenAt).getTime() < 90 * 1000;
          return (
            <div key={d.id} style={styles.card}>
              <div style={styles.cardIcon}>{osIcon(d.os)}</div>
              <div style={styles.cardMid}>
                <div style={styles.cardName}>{d.deviceName || '未命名设备'}</div>
                <div style={styles.cardSub}>
                  <span style={{ ...styles.dot, background: online ? '#22c55e' : '#c4c4c4' }} />
                  {online ? '在线' : '离线'} · {fmtTime(d.lastSeenAt)}
                </div>
              </div>
              <button style={styles.connBtn} onClick={() => connect(d)}>连接</button>
            </div>
          );
        })
      )}

      <PairDialog open={pairOpen} room="" onClose={() => setPairOpen(false)} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  page: { minHeight: '100vh', background: '#f5f5f7', paddingBottom: 30 },
  topBar: { display: 'flex', alignItems: 'center', padding: '12px 16px', gap: 12, background: '#fff' },
  back: { border: 'none', background: 'none', fontSize: 22, color: '#333', width: 36, height: 36 },
  topTitle: { flex: 1, fontSize: 17, fontWeight: 600, color: '#222' },
  pairBtn: { border: 'none', background: '#6c5ce7', color: '#fff', borderRadius: 8, padding: '6px 14px', fontSize: 13 },
  empty: { display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12, paddingTop: 100 },
  emptyIcon: { fontSize: 48, opacity: 0.4 },
  emptyText: { fontSize: 14, color: '#999' },
  card: { display: 'flex', alignItems: 'center', gap: 12, background: '#fff', margin: '10px 14px', padding: 14, borderRadius: 12 },
  cardIcon: { fontSize: 30 },
  cardMid: { flex: 1 },
  cardName: { fontSize: 16, fontWeight: 600, color: '#222' },
  cardSub: { fontSize: 12, color: '#999', display: 'flex', alignItems: 'center', gap: 6, marginTop: 4 },
  dot: { width: 8, height: 8, borderRadius: 4, display: 'inline-block' },
  connBtn: { border: 'none', background: '#eef0ff', color: '#6c5ce7', borderRadius: 8, padding: '8px 16px', fontSize: 14 },
};
