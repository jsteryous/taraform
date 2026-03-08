import { useState, useEffect } from 'react';
import Modal from '../shared/Modal';
import { useApp } from '../../context/AppContext';
import { getSetting, putSetting } from '../../lib/api';

export default function SmsSettingsModal({ open, onClose }) {
  const { currentClientId, showToast } = useApp();
  const [start, setStart]   = useState('8');
  const [end, setEnd]       = useState('17');
  const [limit, setLimit]   = useState('50');

  useEffect(() => {
    if (!open || !currentClientId) return;
    Promise.all([
      getSetting('send_start_hour', currentClientId),
      getSetting('send_end_hour', currentClientId),
      getSetting('daily_limit', currentClientId),
    ]).then(([s, e, l]) => {
      setStart(s.value || '8');
      setEnd(e.value || '17');
      setLimit(l.value || '50');
    }).catch(() => {});
  }, [open, currentClientId]);

  async function save() {
    if (parseInt(end) <= parseInt(start)) { alert('End hour must be after start hour.'); return; }
    await Promise.all([
      putSetting('send_start_hour', start, currentClientId),
      putSetting('send_end_hour', end, currentClientId),
      putSetting('daily_limit', limit, currentClientId),
    ]);
    showToast('Schedule saved');
    onClose();
  }

  return (
    <Modal open={open} onClose={onClose} title="SMS Schedule" width="420px"
      footer={<><button onClick={onClose}>Cancel</button><button className="btn-primary" onClick={save}>Save</button></>}>
      <p style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginBottom: '1.25rem' }}>
        All times Eastern. Scheduler runs Mon–Fri only.
      </p>
      <div className="form-grid">
        <div className="form-group">
          <label>Send Window Start</label>
          <select value={start} onChange={e => setStart(e.target.value)}>
            {[7,8,9,10].map(h => <option key={h} value={h}>{h}:00 {h < 12 ? 'AM' : 'PM'}</option>)}
          </select>
        </div>
        <div className="form-group">
          <label>Send Window End</label>
          <select value={end} onChange={e => setEnd(e.target.value)}>
            {[15,16,17,18,19,20].map(h => <option key={h} value={h}>{h > 12 ? h-12 : h}:00 {h < 12 ? 'AM' : 'PM'}</option>)}
          </select>
        </div>
        <div className="form-group full-width">
          <label>Daily Send Limit</label>
          <input type="number" value={limit} min={1} max={500} onChange={e => setLimit(e.target.value)} />
          <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '0.25rem' }}>Max messages per day for this client.</div>
        </div>
      </div>
    </Modal>
  );
}