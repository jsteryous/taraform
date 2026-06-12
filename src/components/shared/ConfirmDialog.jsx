import { useState, useCallback, useEffect } from 'react';

export function useConfirm() {
  const [state, setState] = useState(null); // { message, resolve, danger }

  const confirm = useCallback((message, { danger = true } = {}) => {
    return new Promise(resolve => setState({ message, resolve, danger }));
  }, []);

  function handleChoice(result) {
    state?.resolve(result);
    setState(null);
  }

  // Esc cancels the dialog
  useEffect(() => {
    if (!state) return;
    function onKey(e) {
      if (e.key === 'Escape') handleChoice(false);
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [state]); // eslint-disable-line

  const dialog = state ? (
    <div className="confirm-overlay" onClick={() => handleChoice(false)}>
      <div className="confirm-dialog" onClick={e => e.stopPropagation()}>
        <p className="confirm-message">{state.message}</p>
        <div className="confirm-actions">
          <button onClick={() => handleChoice(false)}>Cancel</button>
          <button
            className={state.danger ? 'btn-danger' : 'btn-primary'}
            onClick={() => handleChoice(true)}
          >
            Confirm
          </button>
        </div>
      </div>
    </div>
  ) : null;

  return [confirm, dialog];
}
