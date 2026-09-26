/**
 * PairDialog — 配对码输入弹窗（T05 P0：手输 16-hex；扫码 P1 预留入口）
 * 确认 → deviceStore.pair(code, room)；失败展示 pairError（XW5002 等中文）。
 * 红线：配对码只留电脑端——本弹窗输入值仅内存传递，不持久化。
 */
import { useState } from 'react';
import { useDeviceStore } from '../store/deviceStore';

export interface PairDialogProps {
  open: boolean;
  room: string;
  onClose: () => void;
}

export default function PairDialog({ open, room, onClose }: PairDialogProps) {
  const [code, setCode] = useState('');
  const pairStep = useDeviceStore((s) => s.pairStep);
  const pairError = useDeviceStore((s) => s.pairError);
  const pair = useDeviceStore((s) => s.pair);

  if (!open) return null;

  const clean = code.trim().toLowerCase();
  const valid = /^[0-9a-f]{16}$/.test(clean);

  const submit = async () => {
    if (!valid) return;
    const r = await pair(clean, room);
    if (r.ok) {
      setCode(''); // 用完即弃（红线：不持久化）
      onClose();
    }
  };

  return (
    <div style={styles.mask}>
      <div style={styles.card}>
        <div style={styles.title}>配对电脑</div>
        <div style={styles.hint}>请输入电脑端显示的 16 位配对码</div>
        <input
          style={{ ...styles.input, ...(valid ? {} : code ? styles.inputBad : {}) }}
          value={code}
          maxLength={16}
          placeholder="16 位十六进制，如 a1b2c3d4e5f60708"
          onChange={(e) => setCode(e.target.value.replace(/[^0-9a-fA-F]/g, '').toLowerCase())}
        />
        {pairError ? <div style={styles.err}>{pairError}</div> : null}
        <div style={styles.row}>
          <button style={styles.btnGhost} onClick={onClose}>取消</button>
          <button
            style={{ ...styles.btn, opacity: valid && pairStep !== 'connecting' ? 1 : 0.5 }}
            disabled={!valid || pairStep === 'connecting'}
            onClick={() => void submit()}
          >
            {pairStep === 'connecting' ? '连接中…' : '配对'}
          </button>
        </div>
        <div style={styles.scanHint}>扫码配对（P1 敬请期待）</div>
      </div>
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  mask: { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 60 },
  card: { width: 300, background: '#fff', borderRadius: 14, padding: 18, display: 'flex', flexDirection: 'column', gap: 10 },
  title: { fontSize: 17, fontWeight: 600, color: '#222' },
  hint: { fontSize: 13, color: '#888' },
  input: { width: '100%', boxSizing: 'border-box', padding: '10px 12px', borderRadius: 8, border: '1px solid #d0d0d0', fontSize: 15, letterSpacing: 1, fontFamily: 'monospace' },
  inputBad: { borderColor: '#e5484d' },
  err: { color: '#e5484d', fontSize: 12 },
  row: { display: 'flex', gap: 10, marginTop: 4 },
  btn: { flex: 1, padding: '10px 0', borderRadius: 8, border: 'none', background: '#6c5ce7', color: '#fff', fontSize: 15 },
  btnGhost: { flex: 1, padding: '10px 0', borderRadius: 8, border: '1px solid #d0d0d0', background: '#fff', color: '#666', fontSize: 15 },
  scanHint: { textAlign: 'center', fontSize: 11, color: '#bbb', marginTop: 2 },
};
