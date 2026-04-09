import { useState, useRef } from 'react';

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
  // Keep a live ref so async save callbacks always see the latest draft for revert.
  const draftRef = useRef(draft);
  draftRef.current = draft;

  function markSaved() {
    clearTimeout(saveTimer.current);
    setSaveStatus('saved');
    saveTimer.current = setTimeout(() => setSaveStatus(''), 1800);
  }

  async function save(buildNext) {
    const prev = draftRef.current;
    const updated = { ...buildNext(prev), updatedAt: new Date().toISOString() };
    setDraft(updated);
    setCurrentContact(updated);
    clearTimeout(saveTimer.current);
    setSaveStatus('saving');
    try {
      await saveContact(updated);
      markSaved();
    } catch {
      showToast('Save failed — try again', 'error');
      setSaveStatus('');
      setDraft(prev);
      setCurrentContact(prev);
    }
  }

  return {
    saveStatus,
    update:            (field, value) => save(d => ({ ...d, [field]: value })),
    updateMultiple:    (fields)       => save(d => ({ ...d, ...fields })),
    updateCustomField: (key, value)   => save(d => ({ ...d, customFields: { ...d.customFields, [key]: value } })),
  };
}
