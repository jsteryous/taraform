// Guards the one copy in the codebase: supabase/functions/_shared/ mirrors src/lib/ so the
// Edge Functions can import the sync logic. If this fails, run `npm run sync:edge`.
//
// The failure this prevents is nasty and silent — the browser and the nightly job would
// disagree about which numbers are dialable or how a contact is named, and only the
// nightly job's copy reaches anyone's phone.
import { describe, it, expect } from 'vitest';
import { SHARED_FILES, isInSync } from '../../scripts/sync-edge-shared.mjs';

describe('edge function shared code', () => {
  for (const name of SHARED_FILES) {
    it(`supabase/functions/_shared/${name} matches src/lib/${name}`, () => {
      expect(isInSync(name), `out of date — run: npm run sync:edge`).toBe(true);
    });
  }
});
