# Taraform for banking: plan

_Started 2026-11-11. Progress is tracked under "Order of work"._

> This repo is **public**. Don't put the bank's name, its email domain, or any customer
> details in this file.

## Why

A small bank with no CRM. Today there's no way to know who on the team has already talked
to a business, so you have to ask around before calling one, or find out afterwards that a
coworker has been working it for months.

The goal is one shared record where every teammate's notes are visible. Before you dial, the
screen should already say: *"Kim spoke with Jane at Company X three months ago, discussed
xyz."* **The notes do the work.** The app shows who's been in touch; it doesn't assign
accounts or enforce ownership. If it's unclear, you ask Kim.

## Decided

- **Delete three workspaces:** Table Rock Partners (1,825 contacts, 215 offers), TRP (55, 54),
  REBB (70, 0). Export each to a file first. There is no backup, and a delete is permanent.
- **Keep Personal List** (608 contacts, 829 notes) as it is: land setup, private to you.
- **New bank workspace.** Everyone at the bank sees everything in it.
- **Open visibility, no ownership.** "Last contact" is worked out from the notes, so nobody has
  to maintain an owner field and it can't go stale.
- **Relationships only, plus whether they have a loan.** No loan requests or pipeline. The
  status says *that* a business borrows from us, never the amount, terms or performance.
  See the compliance note under "Before any bank data goes in".
- **One standard banking layout for everyone.** No custom field builder. Shared visibility only
  works if everyone uses the same statuses.
- **Automatic follow-ups, with a per-person on/off switch, on by default.** Same schedule as
  Personal List. Someone who turns it off sets follow-up dates by hand.
- **One email domain at the bank**, but joining by bank email is on hold (section 5).
- **Texting is removed entirely**, not just turned off for the bank.
- **Personal List stays private to you** for now.

## What changes

### 1. Notes become their own records

**Today:** a note is an entry in a list stored on the contact, with text and a time but **no
author**. Every save rewrites the whole list. In a shared workspace that means one person
can overwrite or wipe a teammate's notes, and two people saving at once can lose one.

**New:** one row per note. It records who wrote it, when, which person it was with and which
company, plus the text.

- Notes are only ever added, never rewritten.
- Only the author can edit or delete their own note.
- Personal List's 829 existing notes move over with you as the author. They're all plain notes,
  so the move is straightforward.
- Code that reads notes today and has to change: the follow-up schedule (it counts notes),
  the "last note" filter column, CSV export and import, Add Contact, and the contact detail
  page (`followUpCadence.js`, `contactFilters.js`, `contacts.js`, `utils.js`, `NotesTab.jsx`,
  `ContactDetail.jsx`, `AddContactModal.jsx`, `ImportModal.jsx`, `App.jsx`).

### 2. Companies

- **Company:** name, industry, address, phone, website, status.
- **Person:** name, title, phone(s), email, linked to **one or more** companies. That covers
  an owner with several LLCs, and CPAs or attorneys who refer many businesses.
- **Status lives on the company**, since it describes the relationship with the business.
  Draft list:
  - **Target**: on the list, nobody has spoken to them yet.
  - **Prospect**: in conversation, not a customer.
  - **Loan Customer**: has a loan with us (with or without deposits).
  - **Deposit Customer**: banks with us, no loan.
  - **In Network**: not a customer and not being pitched; a relationship worth keeping warm
    (referral sources, peers). Resurfaces for follow-up after 90 days without a note.
  - **Former Customer**
  - **Not a Fit**
- The company link is optional, so Personal List's land contacts are unaffected.

### 3. Banking setup

A banking preset in `src/lib/clientConfig.js`, next to the existing land, restaurant and
generic ones:

- Statuses as above.
- Quick notes, for example "Left voicemail", "Met in person", "Sent info".
- Tabs: Notes only. No Offers.
- Follow-ups: the automatic schedule, with a switch in each person's settings (default on).
- Land fields hidden: county, tax map IDs, acreage, property addresses.

### 4. Seeing who's been in touch

- **Company page:** every note from every teammate, across everyone at that company,
  newest first.
- ~~Search results show a line like *"Last contact: Kim, 3 months ago"*.~~ Dropped
  2026-11-13: opening the contact and reading the notes is enough.
- **Adding something that already exists** takes you to the existing company or person
  instead of creating a duplicate. This is the moment that prevents the double call.
- **Display names:** "Kim", not her email address.

### 5. Joining the bank workspace

**For now: you add each teammate by hand.** This already works and needs nothing built. They
sign up with any email, you add them in Manage Clients, and they see the bank workspace.
You are the confirmation that they're a teammate.

- **Leaving the bank doesn't remove access.** The member list should show each person's
  last sign-in, and you remove people who leave.

**Nobody creates workspaces from the app, you included** (2026-11-13). The "Add New Client"
form is gone and so is the database function behind it; the bank workspace gets made by
hand in SQL in step 4. Someone who signs up before being added sees "you're not in a
workspace yet" with the email to give you. Workspace settings and the gear are owner-only.

**The workspace picker is hidden for anyone in exactly one workspace** (built 2026-11-13).
Teammates land straight in the bank workspace; only someone in more than one sees a picker.
The workspaces themselves stay: signup is open to the internet, and membership is what
keeps a stranger out of the bank's contacts.

**On hold until compliance has weighed in: signing in or joining with a bank email.** If it
comes back:

- The bank's domain is **set by us in the database, not by users**. Otherwise anyone could
  create a workspace, claim the bank's domain, and pull its people into it.
- **Email confirmation is required.** It's the only proof that someone owns the inbox.
- Later option: **Sign in with Microsoft** (or Google), limited to the bank's accounts. It's the
  only option that cuts off access automatically when someone leaves, but it usually needs
  the bank's IT to approve the app.

## Before any bank data goes in

- **Nightly backup working**, plus one test restore. This is Tier 0 in `CLAUDE.md`, still unchecked.
- **Compliance check** on what customer information can live here. Targets are mostly public
  business information; notes on existing customers' loans or deposits are not.
- **"Has a loan" is only partly public.** A secured loan usually leaves a public trace (a UCC
  filing, a recorded mortgage). An unsecured loan or line of credit leaves none, and the
  bank's own customer list is confidential either way. So the Loan Customer status is the
  one thing in this plan that is definitely bank information sitting in an outside app, and
  it's the specific question to put to compliance. If the answer is no, the two customer
  statuses collapse into one "Customer".
- Consider the Supabase Pro plan ($25/mo): platform backups, and no pausing after a week
  of inactivity.

## Removed

- **Texting, everywhere.** It never sent a message. Taking it out means: the Messages tab and
  inbox, the two Edge Functions (`sms-send`, and `sms-inbound`, the only publicly reachable
  function in the project), the SMS and do-not-call tables and functions in the database,
  `scripts/SMS.md` and `scripts/load-dnc.mjs`, and the Texting section and backlog item in
  `CLAUDE.md`. Check the tables are empty before dropping them. The code stays in git history.

## Turned off for the bank

- **Offers.** They stay in Personal List only.

## Order of work

0. **Clean up.** Done 2026-11-13: Table Rock Partners, TRP and REBB are deleted. TRP and REBB
   were exported first, to a folder outside this repo. Side effect: the next nightly phone
   sync removes those leads' cards from your Google contacts.
1. **Remove texting.** Done 2026-11-13, app and database. Left over: the two deployed Edge
   Functions still need deleting (dashboard, or the CLI with an access token).
2. **Backup.**
3. **Notes table**, and move the existing notes into it. Table, access rules and the copy
   of all 907 existing notes are live, the app reads and writes it (`9b81073`), and the cutover migration is applied
   (all 2026-11-13). Done, apart from dropping the old `activity_log` column once a backup exists.
4. **Companies, people, the banking preset (with the follow-up switch), and the bank workspace.**
   Built 2026-11-13 on branch `feat/companies`; the database side is applied. A company is
   a contact of a second kind, linked to people. Deployed, and the bank workspace exists
   (2026-11-13).
5. The duplicate check and display names. (The company page shipped with step 4; "last
   contact" in search was dropped.)
6. **Add teammates by hand.** Nothing to build.

## Open questions

1. **Status list:** is the draft in section 2 right?
2. **Loan Customer status:** does compliance allow it? (See "Before any bank data goes in".)
3. **Phone sync for bank contacts:** should they go into your personal Google contacts for
   caller ID? Same compliance question.
4. **Bank emails:** use them for joining at all, or keep adding teammates by hand?
5. **Faith groups and connection descriptions** in the bank workspace: see "Questions for
   compliance" under Connections & Ways In.

## Later

- Loan requests and stages on the dashboard, after compliance weighs in.
- Single sign-on.
- Searching inside note text ("who's talked about equipment financing?").

## Next: Connections & Ways In (designed 2026-11-18; database, column and hand entry built 2026-11-19; the note finder is next)

Bank workspace only for now. No AI. Mockup: a private canvas,
https://claude.ai/artifact/2yRFHU7uW1uDLG15EypPqN (it uses real names, so it stays out of
this public repo).

### Why

A banker's edge is knowing who knows whom. All this is for: **make a lead as warm as
possible, or find an excuse to reach out.** If I know A well and A knows B, that's an intro
to ask for. If B and I are both members of the same club, that's a reason to call. Miss
either and the call is colder than it had to be. Today the only links are person ↔ company
(`contact_links`); anything else is buried in a note nobody will find at the right moment.

### What you see

The contact page's third column (Offers in Personal List, empty in Bank) becomes
**Connections & Ways In**, top to bottom:

1. **How warm is this contact.** A four-step meter, and one sentence naming the best way in.
   - **Warm:** someone on the team knows them (*Know* or *Know well*).
   - **1 intro away:** they're connected to someone a teammate knows.
   - **Common ground:** they share a group with a teammate, or with someone a teammate
     knows, or a teammate has *Met* them.
   - **Cold:** none of the above.

   Example sentences: "Best way in: ask A. You know him well, and he knows B through
   college." · "Excuse to reach out: you're both members of the same country club."
2. **How well do you know them?** Each teammate's own answer: *Haven't met* (the default,
   stored as no row) · *Met* · *Know* (would take my call) · *Know well* (could ask a
   favor). You set yours; you see everyone's.
3. **Who they know.** Connections, warmest first. Each shows how they know each other, who
   on the team knows *that* person, and "Not confirmed" when it was entered as a hunch.
   A connection made from a note quotes the note as its reason.
4. **Common ground.** The groups they're in, with the teammates and well-known contacts
   who are in them too.

Plus **Your groups** in settings: the clubs, schools, teams and boards a teammate belongs
to. That's what produces "you're both at…". Teammates see each other's groups.

### How it gets filled: the note is the input

Writing notes is the main way in, and nothing new has to be learned to use it. After a note
saves, a **"Taraform found"** strip appears under it:

- **A full name matching exactly one contact** (other than the note's own): linked straight
  away, with Undo. The name in the note becomes a link. The connection shows on both pages.
- **A group Taraform already knows**, by its name or any other name it has been given
  ("GCC" = the full club name): the contact is added straight away, with Undo.
- **Everything else is one tap:**
  - A capitalised phrase Taraform doesn't know ("Firstname Lastname", "Some Church"): offered
    as **Add as contact & link**, **Make group** or **Ignore**. If the phrase contains a
    group-ish word (Club, Church, University, CC…), Make group is listed first.
  - A full name matching two or more contacts: asks which one.
- **Ignore is remembered** for the workspace, so "LinkedIn" or "Monday" stops coming up.
- **A lowercase interest** ("tennis", "golf") isn't spotted the first time. Select the word
  in the note → Make a group. From then on it's matched like any other group.
- First names alone ("talked with Matt") are not matched, on purpose.
- Editing a note runs the finder again for anything new. It never removes links: that's
  what Undo and the column's own remove buttons are for.

**Add connection** stays as a fallback form on the column: who, how they know each other
(quick picks: Work together, Family, Friends, Neighbors, Did a deal together, Referred),
"I think so, but I'm not sure yet", and how well *you* know that person. It's for links
you already know about that no note will ever mention.

### What not to infer

- **Note count says nothing about a relationship.** Fifteen notes can be fifteen unanswered
  voicemails. How well I know someone is entered, never computed.
- **Sharing a company or a group is common ground, not a connection.** A CPA linked to forty
  businesses, or everyone at a 2,000-member club, is not "connected" to the rest. Show it as
  a path ("both at X"), never as a link.
- **Duplicates break chains**, and now they also break the exact-name match: two copies of
  one person means "which one?" every time. The email duplicate check on Add Contact
  (2026-11-18) matters more after this.

### Data

Every table follows the `contact_notes` / `contact_links` pattern: `client_id` stamped by
a trigger from the contact (never trusted from the client), a check that everything
referenced is in that same workspace, policies `TO authenticated` gated on `client_users`,
`revoke all … from anon, authenticated` then column-level grants, and the fields the
client must not choose (author, timestamps) forced in the trigger.

- **`contact_connections`**: `client_id`, `a_id`, `b_id` (both `kind = 'person'`, `a_id <
  b_id` so each pair exists once, unique), `description` text, `referred_by` (null, `a_id`
  or `b_id`: the only kind with a direction), `unsure` boolean, `source_note_id`
  (→ `contact_notes`, `on delete set null`, so deleting the note keeps the link but loses
  the quote), `created_by` default `auth.uid()`, `created_at`. Any member may add, edit or
  remove one; it's a shared fact, the same as `contact_links`.
- **`contact_familiarity`**: `client_id`, `contact_id`, `user_id` (forced to `auth.uid()`),
  `level` (`met` | `know` | `know_well`), `updated_at`. Primary key (`contact_id`,
  `user_id`). Members read all rows; each user writes only their own.
- **`contact_groups`**: `client_id`, `name`, `aliases` text[], `kind` (`club` | `school` |
  `faith` | `interest` | `other`), `created_by`. Unique on lower(name) per workspace.
- **`contact_group_members`**: `group_id`, then exactly one of `contact_id` or `user_id` (a
  teammate in "Your groups"; must be a member of the workspace), `source_note_id`,
  `created_by`. Teammates manage only their own `user_id` rows.
- **`finder_ignored`**: `client_id`, `term` (lowercased). Any member may add or remove.

Warmth and ways in come from one read, `contact_ways_in(contact_id)`: a `SECURITY INVOKER`
SQL function, so RLS still decides what the caller sees. Bank is small enough that the
finder's name index (every person's full name plus every group name and alias) loads once
per session, the same way `fetchDedupIndex` does, and is refreshed after a contact or group
is added.

The finder itself is a pure function, `src/lib/noteFinder.js` (note text + name index +
groups + ignored terms → found items), with tests for the cases above. Turned on by a
`connections` flag in the banking preset in `clientConfig.js`.

### Order of work

1. **Database:** the five tables, triggers, policies and grants in one migration. Prove it
   by role simulation the way `contact_notes` was: a member of another workspace sees 0
   rows and cannot insert across; a teammate cannot write someone else's familiarity or
   group membership; anon gets nothing. Re-check `has_function_privilege` on
   `contact_ways_in`.
   **Done 2026-11-19:** `db/20261118_connections.sql`, applied; proven by
   `db/proofs/20261118_connections_proof.sql` (73/73 against the live tables, rolled
   back). Writes to familiarity go through `set_familiarity(contact_id, level)` (NULL
   clears). Leaving a workspace deletes that user's familiarity and "Your groups" rows.
2. **The column, read-only:** the warmth meter, who they know, common ground, and the "How
   well do you know them?" control (the first thing people can write).
   **Built 2026-11-19** (`WaysInColumn.jsx`, `lib/waysIn.js`), behind `connections: true`
   in the banking preset; companies get a pointer to their people instead. Teammates are
   labelled "You" or the part of their email before the @ until display names exist; that
   label comes from one function, `whoLabel`.
3. **Add connection** form and **Your groups** settings.
   **Built 2026-11-19:** `ConnectionForm.jsx` (add/edit/remove on the column; adding can
   also set how well *you* know the other person), `GroupPicker.jsx` (put a contact in a
   group, or create one; the kind is guessed from the name), and `YourGroupsModal.jsx`
   from the header (tick the groups you're in; create, rename, give other names, delete).
   Faith is not offered as a kind in Bank. Data calls: `lib/groups.js`, and the connection
   writes in `lib/waysIn.js`.
4. **The finder** and the "Taraform found" strip on saved notes.
5. **Display names** (step 5 of the main plan) must land before the column shows
   teammates: "Kim knows him well", not an email address.

### Later, not now

- **AI reading notes** (it would catch "tennis" the first time, tell an introduction from a
  passing mention, and suggest *Met* after "had coffee with"). Cost per note, and for Bank,
  a clear yes from compliance before any note leaves for an outside provider. The "found"
  strip is designed so AI becomes a better source of suggestions without changing anything
  else.
- A page per group listing its members.
- A graph view. Before a call, a ranked list is faster to read.
- Matching first names, and connections two steps away (I know A, A knows C, C knows B).
- Personal List.

### Questions for compliance (add to "Before any bank data goes in")

- **Faith groups.** Fair-lending rules (ECOA / Reg B) bar religion in credit decisions. A
  bank system recording which church a prospect attends could look bad in an exam even if
  it's only used for introductions. Until there's an answer, the finder offers no `faith`
  groups in Bank and the kind can't be chosen.
- **Visibility.** Every teammate sees every connection description. "Business partner" and
  "going through a divorce with" are not the same kind of information. Guidance on what
  belongs in a description, not only in a note, may be worth writing down.

### Related fix: a note is not a call

`followUpCadence.js` assumes every note is a call and moves the follow-up schedule
(+3, +4, +7…) by note count. A note about a coffee meeting, an email or next steps moves the
contact along as if it were an unanswered dial. Worth fixing regardless of the above: tag a
note's kind (call / email / meeting / note), with quick notes setting it, and count only
call attempts.
