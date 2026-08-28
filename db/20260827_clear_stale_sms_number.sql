-- 2026-08-27 — Clear the dead Twilio number off Table Rock Partners.
--
-- clients.sms_number held +18644775752 on Table Rock, left over from the Railway/Twilio era
-- decommissioned 2026-06-10. Doubly dead by now: the Twilio account is gone, and the
-- provider is Telnyx (db/20260827_telnyx.sql), which rejects a `from` it does not own.
--
-- Recorded here rather than done quietly, because the value is not recoverable from
-- anywhere else once cleared — this file IS the record of what it was.
--
-- Guarded on the exact value so re-running after a real number is configured is a no-op
-- rather than wiping live config.

begin;

update public.clients
set sms_number = null
where id = 'f3a69c31-8e40-4ea0-865a-d8bd9214376d'
  and sms_number = '+18644775752';

commit;

-- After this, every client has sms_number = null. Personal List — the list actually worked
-- out of day to day — needs the new Telnyx number set before anything can send. See
-- scripts/SMS.md step 7.
