import Modal from '../shared/Modal';
import { Smartphone } from 'lucide-react';

// Browsers give no feedback on whether a tel: link was handled, so this
// helper auto-shows once after the first desktop call attempt (see
// ContactDetail) and stays reachable from the help icon next to Phones.
const IS_MAC = /Mac/i.test(navigator.userAgent);

const WINDOWS_STEPS = [
  <>Open <strong>Phone Link</strong> (hit Start and type "Phone Link") and pair your phone with the QR code. iPhones also need the Bluetooth permission prompts accepted during pairing — that's what carries the call.</>,
  <>In Windows <strong>Settings → Apps → Default apps</strong>, scroll to <strong>"Choose defaults by link type"</strong>, find <strong>TEL</strong>, and set it to Phone Link. (This is the step most setups are missing.)</>,
  <>Click a phone number here again and allow the browser's "Open Phone Link?" prompt — check "Always allow".</>,
];

const MAC_STEPS = [
  <>Open <strong>FaceTime</strong> on the Mac and sign in with the same Apple ID as your iPhone.</>,
  <>On the iPhone: <strong>Settings → Phone → Calls on Other Devices</strong> and enable your Mac.</>,
  <>In FaceTime's settings on the Mac, check <strong>"Calls from iPhone"</strong>.</>,
  <>Click a phone number here again and allow the browser's "Open FaceTime?" prompt.</>,
];

export default function CallSetupModal({ open, onClose }) {
  const steps = IS_MAC ? MAC_STEPS : WINDOWS_STEPS;
  return (
    <Modal open={open} onClose={onClose} title="Set up click-to-call" width="480px"
      footer={<button className="btn-primary" onClick={onClose}>Got it</button>}
    >
      <p style={{ fontSize: 'var(--text-base)', color: 'var(--text)', marginBottom: '1rem' }}>
        If a call window opened when you clicked the number, you're all set — close this.
        If nothing happened, your computer needs a one-time setup to hand calls to your phone:
      </p>
      <div className="field-label">{IS_MAC ? 'Mac + iPhone' : 'Windows'}</div>
      <ol style={{ fontSize: 'var(--text-base)', color: 'var(--text)', lineHeight: 1.6, paddingLeft: '1.25rem', display: 'flex', flexDirection: 'column', gap: '0.5rem', margin: 0 }}>
        {steps.map((s, i) => <li key={i}>{s}</li>)}
      </ol>
      <p style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', fontSize: 'var(--text-sm)', color: 'var(--text-muted)', marginTop: '1.25rem', marginBottom: 0 }}>
        <Smartphone size={14} style={{ flexShrink: 0 }} />
        On your phone, no setup is needed — opening taraform.org there and tapping a number dials right away.
      </p>
    </Modal>
  );
}
