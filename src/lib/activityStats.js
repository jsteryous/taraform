// Buckets the rows returned by the note_activity RPC (db/20260716_note_activity.sql —
// one { contact_id, note_at } per note logged since the fetch window) into the three
// dashboard periods. "today" is since local midnight; week/month are rolling 7/30-day
// windows to match the offers card's period math.
export function summarizeNoteActivity(rows, now = new Date()) {
  const todayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const weekStart = new Date(now - 7 * 86400000);
  const monthStart = new Date(now - 30 * 86400000);

  const buckets = {
    today: { since: todayStart, notes: 0, contacts: new Set() },
    week: { since: weekStart, notes: 0, contacts: new Set() },
    month: { since: monthStart, notes: 0, contacts: new Set() },
  };

  for (const row of rows || []) {
    const t = new Date(row.note_at);
    if (isNaN(t)) continue;
    for (const b of Object.values(buckets)) {
      if (t >= b.since) {
        b.notes += 1;
        b.contacts.add(row.contact_id);
      }
    }
  }

  const out = {};
  for (const [key, b] of Object.entries(buckets)) {
    out[key] = { notes: b.notes, contacts: b.contacts.size };
  }
  return out;
}
