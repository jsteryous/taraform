import { useApp } from '../../context/AppContext';

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  return (
    <div className="toast" style={{
      position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
      padding: '0.5rem 1.25rem', borderRadius: '20px', fontSize: '0.8rem',
      zIndex: 99999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
    }}>
      {toast}
    </div>
  );
}