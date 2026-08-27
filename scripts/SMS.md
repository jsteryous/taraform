# Texting from the CRM — setup and runbook

Manual, one-at-a-time texting from the contact overlay. No blasting, no cron. Built
2026-08-27; `db/20260827_sms.sql` is applied, both Edge Functions are written but **not yet
deployed**, and nothing can send until the steps below are done.

Provider is **Telnyx** (switched from Twilio 2026-08-27). Cost at 20 texts/day is roughly
**$7-10/month**: number ~$1, 10DLC ~$2, traffic ~$4. Railway stays dead — the webhook is an
Edge Function, same as the phone sync.

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

### 1. Telnyx account and identity

Sign up at telnyx.com, verify email, and complete **Level 1 identity verification** (Portal
→ Account → Verify). Messaging stays disabled until this clears. Add ~$20 of credit; Telnyx
is prepaid and a zero balance silently fails sends.

### 2. Buy a number

Numbers → Search & Buy. Filter **area code 864**, feature **SMS**, type **Local**. About
$1/month. A local 864 number answers better than toll-free and skips toll-free verification
entirely.

### 3. Create a Messaging Profile

Messaging → Messaging Profiles → Create. Assign the number to it.

Unlike Twilio, the **inbound webhook is configured on the profile, not on the number**. Set:

- **Webhook URL**: `https://ykuenmwfxecmmqichwit.supabase.co/functions/v1/sms-inbound`
- **Webhook API version**: **API v2** (v1 sends a different payload shape and `sms-inbound`
  will silently ignore every event)
- Failover URL: leave blank

### 4. Register 10DLC — do this before sending anything

Messaging → 10DLC. **Brand** first (~$4 one-time), then a **Campaign** (~$2/month) linked to
the Messaging Profile. Use case: **Low Volume Mixed**.

Approval typically takes 1–5 business days. **Send nothing until it clears** — see the
billing note at the bottom of this file for why that matters.

Campaign description — accurate, which is also what gets approved:

> Direct outreach to individual property owners regarding potential purchase of their land.
> Recipients are identified from public county property records. Messages are composed and
> sent manually, one at a time, by the business owner. All recipients are scrubbed against
> the National DNC Registry before contact, and opt-out requests are honored permanently.

Sample message must carry opt-out language. `sms-send` appends "Reply STOP to opt out." to
the first message to any number, so quote a sample with it included.

### 5. Supabase secrets

Two different keys, easy to confuse:

- **API key** — Portal → Account → Keys & Credentials → API Keys. Starts `KEY`. Used to send.
- **Public key** — same page, "Public Key". Base64 Ed25519. Used to verify webhooks.

```bash
npx supabase secrets set \
  TELNYX_API_KEY=KEYxxxxxxxx \
  TELNYX_PUBLIC_KEY=xxxxxxxx \
  --project-ref ykuenmwfxecmmqichwit
```

Optional: `TELNYX_MESSAGING_PROFILE_ID` — only needed if a number belongs to more than one
profile. Telnyx infers it from `from` otherwise.

### 6. Deploy the functions

```bash
export SUPABASE_ACCESS_TOKEN=<pat>
npx supabase functions deploy sms-send    --project-ref ykuenmwfxecmmqichwit
npx supabase functions deploy sms-inbound --no-verify-jwt --project-ref ykuenmwfxecmmqichwit
```

`--no-verify-jwt` on `sms-inbound` is **required** — Telnyx has no Supabase JWT. That makes
it the one publicly reachable function in the project, which is why it verifies the Ed25519
signature before touching the database. Do not remove that check, and do not deploy
`sms-send` with `--no-verify-jwt`.

Telnyx signs `${timestamp}|${rawBody}`, so nothing depends on the URL the platform proxy
presents — there is no Twilio-style `SMS_WEBHOOK_URL` to get wrong. A 5-minute timestamp
tolerance guards against replay.

### 7. Set the sending number on the list

The number lives on `clients.sms_number`, editable in Manage Clients. **Set it on Personal
List** — that is the list actually worked out of day to day.

> **No client currently has a number.** The dead Twilio value on Table Rock
> (`+18644775752`) was cleared 2026-08-27 — `db/20260827_clear_stale_sms_number.sql` is now
> the only record of it. Nothing can send until this is set.

### 8. Load DNC data — nothing sends until you do

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

Carriers also honour STOP at the network level, but that dies with the number; ours doesn't.
Deliberately one-way — a later START unblocks at the carrier but does **not** clear it here.
Nothing in the app can reverse an opt-out, including recorded consent. Note Telnyx, unlike
Twilio, does **not** send an automatic STOP confirmation, and we deliberately do not send one
either: an extra text to someone who just asked us to stop is the wrong instinct.

**Detection is two-tier and tuned to over-match.** Exact carrier keywords (`STOP`,
`UNSUBSCRIBE`, `CANCEL`, …) plus a phrase tier, because people write "please stop texting
me" rather than the magic word — which neither the carriers nor the original matcher caught.
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
| `No sending number is configured` | `clients.sms_number` is null for that list. |
| Telnyx rejects the `from` | Number isn't on the account or the profile — likely the stale TRP value. |
| `Insufficient funds` / sends stop dead | Telnyx is prepaid. Top up and set a low-balance alert. |
| Inbound 403 in the function logs | Signature failed. Check `TELNYX_PUBLIC_KEY` is the **public key**, not the API key. |
| Inbound 403 only sometimes | Clock skew past the 5-minute replay tolerance, or a retry of a stale event. |
| Sends work, nothing is received | Webhook is set on the **Messaging Profile**, not the number. Confirm API **v2**. |
| Webhooks arrive but nothing is logged | Profile is on webhook API v1 — the payload shape differs and every event is ignored. |
| Messages queue then fail silently | Carrier filtering — check 10DLC campaign status. |

## Billing

**The "$1.50 per text" from the earlier Twilio attempt was not a provider rate.** US A2P is
under a cent per segment on both Twilio and Telnyx. That charge was carrier penalty fees for
sending on an **unregistered 10DLC campaign** — levied by T-Mobile and AT&T directly, not by
the provider. Switching providers does not avoid it. Registering before sending does, which
is why 10DLC is step 4 and not step 9.

Guardrails worth setting up front:

- Telnyx Portal → Billing → **auto-recharge off**, plus a low-balance email alert. Prepaid
  means a runaway spend stops on its own once the balance drains.
- `clients.sms_daily_cap` defaults to **25**, enforced in `sms_send_precheck()` over a
  trailing 24 hours. That is a hard ceiling regardless of what the provider would allow.
- Send one message to your own phone before touching a real lead.
