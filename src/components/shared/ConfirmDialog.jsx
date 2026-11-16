import { useState, useCallback, useEffect } from 'react';
import { createPortal } from 'react-dom';

export function useConfirm() {
  const [state, setState] = useState(null); // { message, resolve, danger, requireText }
  const [typed, setTyped] = useState('');

  // `requireText` gates Confirm behind typing an exact string. For actions that
  // cascade (deleting a client takes its contacts and offers with it) a dialog
  // you can dismiss with a reflexive Enter is not a guard.
  const confirm = useCallback((message, { danger = true, requireText = null } = {}) => {
    setTyped('');
    return new Promise(resolve => setState({ message, resolve, danger, requireText }));
  }, []);

  function handleChoice(result) {
    state?.resolve(result);
    setState(null);
    setTyped('');
  }

  const locked = Boolean(state?.requireText) && typed.trim() !== state.requireText;

  // Esc cancels the dialog
  useEffect(() => {
    if (!state) return;
    function onKey(e) {
      if (e.key === 'Escape') handleChoice(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]); // eslint-disable-line

  // Portalled to <body>: rendered in place, the dialog inherits whatever stacking
  // context its caller sits in (e.g. the contact sidebar), and later siblings such as
  // the notes column paint over it no matter how high its own z-index is.
  const dialog = state ? createPortal(
    <div className="confirm-overlay" onClick={() => handleChoice(false)}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <p className="confirm-message">{state.message}</p>
        {state.requireText && (
          <input
            className="confirm-input"
            autoFocus
            value={typed}
            placeholder={state.requireText}
            onChange={e => setTyped(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter' && !locked) handleChoice(true); }}
          />
        )}
        <div className="confirm-actions">
          <button onClick={() => handleChoice(false)}>Cancel</button>
          <button
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            disabled={locked}
            onClick={() => handleChoice(true)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>,
    document.body
  ) : null;

  return [confirm, dialog];
}
