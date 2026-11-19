import { findInNote } from './noteFinder';
import { fetchFinderIndex } from './finderIndex';
import { connectPeople } from './waysIn';
import { addContactToGroup } from './groups';
import { fetchConnections } from './links';

// What happens after a note saves, in a workspace with connections on (PLAN.md, the note
// finder). The sure things are done here — a full name matching exactly one person is
// connected, a known group is joined — and come back as items with Undo. The rest come
// back as offers for the strip to ask about. Never removes anything: editing a note only
// adds what's new, and an existing connection or membership is left alone (and not
// reported again).
//
// Only a person's notes act: a connection joins two people, and a company's people are
// already on its page.
export async function runFinder({ clientId, contact, note, picked }) {
  if (contact.kind === 'company') return [];
  const { index, ignored } = await fetchFinderIndex(clientId);
  const found = findInNote(note.body, index, { selfId: contact.id, ignored, picked });
  const items = [];

  for (const p of found.people) {
    try {
      const connectionId = await connectPeople({ contactId: contact.id, otherId: p.id, sourceNoteId: note.id });
      items.push({ type: 'person', name: p.name, state: 'linked', connectionId });
    } catch (e) {
      if (!/already connected/i.test(e.message || '')) throw e;
    }
  }

  for (const g of found.groups) {
    if (await addContactToGroup(g.id, contact.id, note.id)) {
      items.push({ type: 'group', name: g.name, state: 'linked', groupId: g.id });
    }
  }

  if (found.companies.length) {
    const linked = new Set((await fetchConnections(contact)).map(l => l.contact.id));
    for (const c of found.companies) {
      if (!linked.has(c.id)) items.push({ type: 'company', id: c.id, name: c.name, state: 'offer' });
    }
  }

  for (const a of found.ambiguous) {
    items.push({ type: 'ambiguous', name: a.name, candidates: a.candidates, state: 'offer' });
  }
  for (const u of found.unknown) {
    items.push({ type: 'unknown', phrase: u.phrase, guess: u.type, state: 'offer' });
  }
  return items;
}
