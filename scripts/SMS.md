# Texting from the CRM — setup and runbook

Manual, one-at-a-time texting from the contact overlay. No blasting, no cron. Built
2026-08-27; `db/20260827_sms.sql` is applied, both Edge Functions are written but **not yet
deployed**, and nothing can send until the steps below are done.

Cost at 20 texts/day: about **$15/month** (number $1.15, 10DLC ~$2, traffic ~$10). Railway
stays dead — the webhook is an Edge Function, same as the phone sync.

---

## The design in one paragraph

Every guard lives in `sms_send_precheck()` in SQL. Not in React (the anon key ships in the
public bundle, so a check there is decoration) and not in the Edge Function (it runs as
`service_role` and bypasses RLS, so it can't be the tenancy boundary either). The function
answers with a *reason*, which is what the UI shows — `dnc_unscrubbed` tells you to load an
area code; a silent failure would tell you nothing. Same precedent as
`phone_sync_contacts_for()`.

The checks, in order: membership → number is valid → number is actually on that contact →
not in `bad_phones` → contact hasn't opted out → DNC clear or consent recorded → inside
8am–9pm **recipient local** → under the daily cap.

Everything **fails closed**. An unknown area code, a malformed number, or an unscrubbed
area code all block.

---

## Setup

### 1. Twilio

1. Create an account, buy a local number (prefer a **864** number — it matches the bulk of
   the list and local numbers answer better).
2. Register 10DLC: **Brand** (sole proprietor, ~$4 one-time) then a **Campaign**
   (~$2/month). Approval takes a few days — start this first.
3. Copy the Account SID and Auth Token.

### 2. Supabase secrets

```bash
npx supabase secrets set \
  TWILIO_ACCOUNT_SID=ACxxxxxxxx \
  TWILIO_AUTH_TOKEN=xxxxxxxx \
  --project-ref ykuenmwfxecmmqichwit
```

### 3. Deploy the functions

```bash
export SUPABASE_ACCESS_TOKEN=<pat>
npx supabase functions deploy sms-send    --project-ref ykuenmwfxecmmqichwit
npx supabase functions deploy sms-inbound --no-verify-jwt --project-ref ykuenmwfxecmmqichwit
```

`--no-verify-jwt` on `sms-inbound` is **required** — Twilio has no Supabase JWT. That makes
it the one publicly reachable function in the project, which is why it validates
`X-Twilio-Signature` before touching the database. Do not remove that check, and do not
deploy `sms-send` with `--no-verify-jwt`.

### 4. Point Twilio at the webhook

In the number's config, set **A MESSAGE COMES IN** to:

```
https://ykuenmwfxecmmqichwit.supabase.co/functions/v1/sms-inbound
```

If signature validation fails with a correct token, the platform proxy is rewriting the URL
Twilio signed. Fix it by pinning the exact console URL:

```bash
npx supabase secrets set SMS_WEBHOOK_URL=https://ykuenmwfxecmmqichwit.supabase.co/functions/v1/sms-inbound --project-ref ykuenmwfxecmmqichwit
```

Optional, for delivery receipts: set `SMS_STATUS_CALLBACK` to the same URL.

### 5. Set the sending number on the list

The number lives on `clients.twilio_number`, editable in Manage Clients.

> **Table Rock still carries `+18644775752`** from the Railway era — a number the org
> almost certainly no longer owns. Twilio rejects a send from an unowned number (error
> 21606), so it fails loudly and gets logged rather than silently vanishing, but clear or
> replace it. **Personal List has no number set**, and that is the list actually worked out
> of day to day.

### 6. Load DNC data — nothing sends until you do

```bash
SUPABASE_URL=https://ykuenmwfxecmmqichwit.supabase.co \
SUPABASE_SERVICE_ROLE_KEY=<service key> \
  node scripts/load-dnc.mjs downloads/864.txt
```

Register as a seller at **telemarketing.donotcall.gov** and download per-area-code files.
Free for 5 area codes. Current list coverage:

| Area code | Phone entries | Share |
|-----------|---------------|-------|
| 864 | 1,146 | ~72% |
| 803 | 174 | |
| 770 | 170 | |
| 704 | 159 | |
| 706 / 404 | 101 each | |

864 alone unblocks roughly three quarters of the list. The free five cover the large
majority. Beyond that, a commercial scrub (DNC.com, Contact Center Compliance, Blacklist
Alliance) runs cents per record — under $50 for all 1,603.

`--dry-run` parses and reports without writing. Coverage is written **after** the numbers,
so a load that dies halfway leaves the area code blocked rather than opening it against a
partial registry.

---

## Compliance model

**What hand-picking the list does and doesn't buy.** Curating and manually sending very
likely defeats the ATDS claim (*Facebook v. Duguid*, 2021 — an autodialer needs a random or
sequential number generator). It does **nothing** for the Do-Not-Call theory under 47 CFR
64.1200(c)(2), which applies identically to manual sends and is where the litigation moved
after *Duguid*. That gap is the reason `dnc_state()` gates every send.

**Opt-outs attach to the number, not the contact.** This started as a per-contact flag and
that was wrong: **295 numbers in this database sit on more than one contact** (one sits on
four), so a STOP would have opted out a single row and left the duplicates textable at the
number that just said stop. Opt-outs now live in `sms_opt_outs`, keyed by the 10-digit
number, and are enforced in three places — `sms_send_precheck()` above the consent branch,
`sms_record_outbound()` at write time as a backstop, and every contact carrying the number
gets `do_not_contact` for UI visibility. The suppression is written *before* contact
matching, so a STOP from a number we can't match to anything still stops us.

Twilio also blocks STOP at the number level, but that block dies with the number; ours
doesn't. Deliberately one-way — a later START unblocks the sender at Twilio but does **not**
clear it here. Nothing in the app can reverse an opt-out, including recorded consent.

**Detection is two-tier and tuned to over-match.** Exact carrier keywords (`STOP`,
`UNSUBSCRIBE`, `CANCEL`, …) plus a phrase tier, because people write "please stop texting
me" rather than the magic word — and neither Twilio nor the original matcher caught that.
A false positive costs one lead; a false negative is a TCPA claim. `sms_is_stop()` was
checked against 23 stop phrasings (all caught) and 8 non-stop replies including "Can you
stop by the property tomorrow?" and "non-stop calls from you guys" (none caught).

**It is still best-effort, and that matters.** No keyword matcher catches every phrasing.
The real backstop is that every send is manual: you read the thread before the next message
goes out. If someone asks to stop in a way the matcher missed — or by phone, or by email —
use the **Opt out** button in the Messages tab (`sms_opt_out_number()`), which suppresses
the number the same way an inbound STOP would.

**Quiet hours use the area code, not the county.** "Greenville" is ambiguous across SC, NC
and GA. `area_code_timezones` holds 231 codes covering every valid US area code in the
list; the 12 uncovered ones are malformed rows (`010`, `050`, `125`, `160`, `168`),
unassigned codes, and two Canadian ones (`705`, `778`) — all correctly blocked. Split codes
(`605`, `812`, `850`, `906`, `541`, `806`) carry an `alt_timezone` and must satisfy the
window in **both** halves.

**Consent as the escape hatch.** `sms_consent_at` + `sms_consent_note` on the contact
overrides a DNC listing — that's express consent or an established business relationship,
the actual lawful basis. It requires a non-empty note saying where the consent came from: a
bare timestamp doesn't count. It does **not** override an opt-out, which is absolute.

**Still on you, not in the code:** a written internal DNC policy (64.1200(d) requires one,
and courts have found standalone liability for its absence), identifying yourself in the
first message, and an hour with a TCPA attorney on residual risk. The code enforces what
code can enforce.

---

## Verifying

```sql
-- What a specific send would do, without sending.
select * from public.sms_send_precheck(
  (select id from auth.users where email = 'jsteryous@gmail.com'),
  <contact_id>, '864-555-1212');

-- Scrub coverage.
select area_code, number_count, loaded_at from public.dnc_area_codes order by area_code;

-- Quiet hours right now for an area code.
select public.sms_within_quiet_hours('864-555-1212');
```

Guards verified live 2026-08-27 (test rows rolled back): unscrubbed number →
`dnc_unscrubbed`; registry-listed number → `dnc_listed`; scrubbed and unlisted → `ok`; an
arbitrary number against a real contact → `phone_not_on_contact`; another user's contact →
`not_authorized` with no data returned. Quiet hours confirmed at the 9pm boundary and
across the 850 split.

## Troubleshooting

| Symptom | Cause |
|---|---|
| `dnc_unscrubbed` on everything | No area codes loaded. Run `load-dnc.mjs`. |
| `No sending number is configured` | `clients.twilio_number` is null for that list. |
| Twilio error 21606 | Sending from a number the account doesn't own — the stale TRP value. |
| Inbound 403 in the function logs | Signature mismatch. Set `SMS_WEBHOOK_URL`. |
| Sends work, nothing is received | Webhook URL not set on the number in Twilio. |
| Messages queue then fail silently | Carrier filtering — check 10DLC campaign status. |
