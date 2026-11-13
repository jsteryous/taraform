import { describe, it, expect, vi } from 'vitest';

vi.mock('./supabase', () => ({ supabase: {} }));

import { mapNote, authorLabel } from './notes';

describe('mapNote', () => {
  it('maps a contact_notes row to the app shape', () => {
    expect(mapNote({
      id: 7, contact_id: 42, author_id: 'user-1', body: 'Left voicemail',
      created_at: '2026-11-13T15:00:00+00:00', edited_at: null,
    })).toEqual({
      id: 7, contactId: 42, authorId: 'user-1', body: 'Left voicemail',
      createdAt: '2026-11-13T15:00:00+00:00', editedAt: null,
    });
  });

  it('keeps a null author — the note outlives the account that wrote it', () => {
    expect(mapNote({ id: 1, contact_id: 2, author_id: null, body: 'x', created_at: 't' }).authorId).toBeNull();
  });
});

describe('authorLabel', () => {
  it('shows the part of the email before the @', () => {
    expect(authorLabel('kim@example.com')).toBe('kim');
  });

  it('does not blank out when the member is gone', () => {
    expect(authorLabel(null)).toBe('Former member');
    expect(authorLabel('')).toBe('Former member');
  });
});
