import { useState, useRef, useEffect } from 'react';

/**
 * Encapsulates the optimistic-save pattern used in ContactDetail:
 * apply locally → call saveContact → revert + toast on failure.
 *
 * Usage:
 *   const { saveStatus, update, updateMultiple, updateCustomField } =
 *     useDraftSave(draft, setDraft, setCurrentContact, saveContact, showToast);
 */
export function useDraftSave(draft, setDraft, setCurrentContact, saveContact, showToast) {
  const [saveStatus, setSaveStatus] = useState(''); // '' | 'saving' | 'saved'
  const saveTimer = useRef(null);
  // Keep a live ref so async save callbacks always see the latest draft.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  // The last state the server confirmed — what a failed save has to roll back to.
  //
  // This can NOT be draftRef.current. Most fields in ContactDetail are typed into an input
  // whose onChange already writes the new value into the draft, so by the time onBlur fires
  // the "previous" draft holds the value we're about to try to save. Reverting to it was a
  // no-op, and a rejected save silently left the rejected value on screen looking saved.
  // Caught by the concurrency guard's conflict path, but it affected every failed save.
  const savedRef = useRef(draft);
  const draftId = draft?.id;
  useEffect(() => { savedRef.current = draftRef.current; }, [draftId]);

  function markSaved() {
    clearTimeout(saveTimer.current);
    setSaveStatus('saved');
    saveTimer.current = setTimeout(() => setSaveStatus(''), 1800);
  }

  async function save(buildNext) {
    const base = savedRef.current;
    const updated = { ...buildNext(draftRef.current), updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    try {
      await saveContact(updated);
      savedRef.current = updated;
      markSaved();
    } catch (e) {
      // A concurrency conflict is not a transient failure — retrying would overwrite
      // whoever wrote first, so say what happened instead of "try again".
      showToast(e?.name === 'ContactConflictError' ? e.message : 'Save failed — try again', 'error');
      setSaveStatus('');
      // Roll back only the fields this save touched, to their last confirmed values —
      // not the whole draft, which would also discard edits made while it was in flight.
      const revert = {};
      for (const key of Object.keys(updated)) {
        if (updated[key] !== base?.[key]) revert[key] = base?.[key];
      }
      setDraft(d => (d ? { ...d, ...revert } : d));
      setCurrentContact(c => (c && c.id === updated.id ? { ...c, ...revert } : c));
    }
  }

  return {
    saveStatus,
    update:            (field, value) => save(d => ({ ...d, [field]: value })),
    updateMultiple:    (fields)       => save(d => ({ ...d, ...fields })),
    updateCustomField: (key, value)   => save(d => ({ ...d, customFields: { ...d.customFields, [key]: value } })),
  };
}
