import { useState, useEffect, useCallback } from 'react';
import Modal from '../shared/Modal';
import { useConfirm } from '../shared/ConfirmDialog';
import { useApp } from '../../context/AppContext';
import {
  isConfigured, connectGoogleContacts, disconnectGoogleContacts,
  syncContactsNow, getContactSyncStatus, setContactSyncEnabled,
} from '../../lib/googleContacts';
import { Smartphone, RefreshCw, Link2Off, TriangleAlert, Check } from 'lucide-react';

const row = { fontSize: 'var(--text-base)', color: 'var(--text)', lineHeight: 1.6 };
const muted = { fontSize: 'var(--text-sm)', color: 'var(--text-muted)' };

function relative(iso) {
  if (!iso) return 'never';
  const mins = Math.round((Date.now() - new Date(iso).getTime()) / 60000);
  if (mins < 2) return 'just now';
  if (mins < 60) return `${mins} minutes ago`;
  const hours = Math.round(mins / 60);
  if (hours < 24) return `${hours} hour${hours === 1 ? '' : 's'} ago`;
  const days = Math.round(hours / 24);
  return `${days} day${days === 1 ? '' : 's'} ago`;
}

export default function PhoneSyncModal({ open, onClose }) {
  const { showToast } = useApp();
  const [confirm, confirmDialog] = useConfirm();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');

  const refresh = useCallback(async () => {
    try {
      setStatus(await getContactSyncStatus());
    } catch {
      showToast('Could not load sync status');
    } finally {
      setLoading(false);
    }
  }, [showToast]);

  useEffect(() => {
    if (!open) return;
    setLoading(true);
    refresh();
  }, [open, refresh]);

  async function run(label, fn, success) {
    setBusy(label);
    try {
      const result = await fn();
      await refresh();
      showToast(typeof success === 'function' ? success(result) : success);
    } catch (err) {
      showToast(err.message || 'Something went wrong');
    } finally {
      setBusy('');
    }
  }

  const handleConnect = () => run('connect', connectGoogleContacts,
    (r) => `Connected ${r.google_email}. Syncing tonight — or hit "Sync now".`);

  const handleSync = () => run('sync', syncContactsNow,
    (r) => `Synced ${r.synced} contacts (${r.created} new, ${r.updated} updated, ${r.deleted} removed).`);

  async function handleDisconnect() {
    const ok = await confirm(
      'Disconnect Google Contacts? Taraform stops syncing and revokes its access. '
      + 'Contacts already on your phone stay there until you remove them.',
    );
    if (!ok) return;
    run('disconnect', disconnectGoogleContacts, 'Disconnected from Google Contacts.');
  }

  const handleToggle = () => run('toggle',
    () => setContactSyncEnabled(!status.enabled),
    status.enabled ? 'Sync paused.' : 'Sync resumed.');

  const connected = Boolean(status);
  const stats = status?.last_stats;

  return (
    <>
      <Modal open={open} onClose={onClose} title="Caller ID on your phone" width="520px"
        footer={<button onClick={onClose}>Close</button>}
      >
        <p style={{ ...row, marginTop: 0, marginBottom: '1rem' }}>
          Taraform keeps your Google Contacts up to date with the people in your lists, so an
          incoming call shows <strong>John Parker (Offer Made)</strong> instead of an unknown
          number. Both iPhone and Android sync Google Contacts natively — nothing to install.
        </p>

        {!isConfigured() && (
          <p style={{ ...muted, margin: 0 }}>
            <TriangleAlert size={14} style={{ verticalAlign: '-2px', marginRight: '0.4rem' }} />
            Not configured for this deployment — <code>VITE_GOOGLE_CLIENT_ID</code> is unset.
            See <code>scripts/PHONE_SYNC_MULTIUSER.md</code>.
          </p>
        )}

        {isConfigured() && loading && <p style={{ ...muted, margin: 0 }}>Loading…</p>}

        {isConfigured() && !loading && !connected && (
          <>
            <button className="btn-primary" onClick={handleConnect} disabled={busy === 'connect'}
              style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
            >
              <Smartphone size={14} />
              {busy === 'connect' ? 'Waiting for Google…' : 'Connect Google Contacts'}
            </button>
            <p style={{ ...muted, marginTop: '1rem', marginBottom: 0 }}>
              You'll approve access in a Google popup. Taraform only ever adds contacts it
              created — anything already in your address book is never modified or deleted,
              and everything it adds carries a <strong>Taraform</strong> label so you can
              filter or remove it in one go.
            </p>
          </>
        )}

        {isConfigured() && !loading && connected && (
          <>
            <div className="field-label">Connected account</div>
            <p style={{ ...row, margin: '0 0 0.75rem' }}>
              <Check size={14} style={{ verticalAlign: '-2px', marginRight: '0.4rem', color: 'var(--accent)' }} />
              {status.google_email}
            </p>

            <div className="field-label">Last sync</div>
            <p style={{ ...row, margin: '0 0 0.25rem' }}>
              {relative(status.last_synced_at)}
              {!status.enabled && <span style={muted}> — paused</span>}
            </p>
            {stats && (
              <p style={{ ...muted, margin: '0 0 1rem' }}>
                {stats.synced} contacts on your phone
                {stats.merged > 0 && ` · ${stats.merged} duplicates merged`}
                {stats.undialable > 0 && ` · ${stats.undialable} skipped (no dialable number)`}
                {stats.untouched > 0 && ` · ${stats.untouched} of your own contacts untouched`}
              </p>
            )}

            {status.last_error && (
              <p style={{ ...muted, color: 'var(--danger)', margin: '0 0 1rem' }}>
                <TriangleAlert size={14} style={{ verticalAlign: '-2px', marginRight: '0.4rem' }} />
                {status.last_error}
              </p>
            )}

            <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
              <button className="btn-primary" onClick={handleSync} disabled={Boolean(busy)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <RefreshCw size={14} />
                {busy === 'sync' ? 'Syncing…' : 'Sync now'}
              </button>
              <button onClick={handleToggle} disabled={Boolean(busy)}>
                {status.enabled ? 'Pause nightly sync' : 'Resume nightly sync'}
              </button>
              <button className="btn-danger" onClick={handleDisconnect} disabled={Boolean(busy)}
                style={{ display: 'flex', alignItems: 'center', gap: '0.4rem' }}
              >
                <Link2Off size={14} /> Disconnect
              </button>
            </div>

            <p style={{ ...muted, marginTop: '1rem', marginBottom: 0 }}>
              Runs automatically every night. Tapping a synced contact on your phone opens
              their record in Taraform.
            </p>
          </>
        )}
      </Modal>
      {confirmDialog}
    </>
  );
}
