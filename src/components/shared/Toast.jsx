import { Check, X, AlertTriangle } from 'lucide-react';
import { useApp } from '../../context/AppContext';

const ICONS = {
  success: <Check size={14} className="toast-icon toast-icon-success" />,
  error:   <X size={14} className="toast-icon toast-icon-error" />,
  warning: <AlertTriangle size={14} className="toast-icon toast-icon-warning" />,
};

export default function Toast() {
  const { toast } = useApp();
  if (!toast) return null;
  const { msg, variant } = toast;
  return (
    <div className={`toast toast-${variant}`} style={{
      position: 'fixed', bottom: '1.5rem', left: '50%', transform: 'translateX(-50%)',
      background: 'var(--surface)', border: '1px solid var(--border)', color: 'var(--text)',
      padding: '0.5rem 1.25rem', borderRadius: '20px', fontSize: 'var(--text-sm)',
      zIndex: 99999, boxShadow: '0 4px 16px rgba(0,0,0,0.2)', whiteSpace: 'nowrap',
    }}>
      {ICONS[variant] ?? null}
      {msg}
    </div>
  );
}
