// Turns a thrown Supabase/PostgREST/network error into a sentence worth showing a user.
// Lives here rather than in AppContext so any data-layer caller can reach it without
// pulling in React.
export function classifyError(e) {
  if (!navigator.onLine) return 'You appear to be offline.';
  const status = e?.status ?? e?.code;
  if (status === 401 || status === 403) return 'Permission denied — check your access.';
  if (status === 404) return 'Record not found.';
  if (status >= 500) return 'Server error — try again later.';
  // PostgREST returns the offending detail in e.message / e.details — surface it so
  // 400s are debuggable from the toast instead of needing the Network panel.
  if (e?.message) return e.message;
  return 'Something went wrong — try again.';
}
