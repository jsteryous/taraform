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

## Later

- Loan requests and stages on the dashboard, after compliance weighs in.
- Single sign-on.
- Searching inside note text ("who's talked about equipment financing?").

## Next: who knows whom (planning, 2026-11-18, not built)

### Why

A banker's edge is knowing who knows whom. If I know A well and A knows a prospect, that is
an intro to ask for, or at least a name to mention on the call. Miss the link and the call is
colder than it had to be. Today the only links are person ↔ company (`contact_links`), so
two people who, say, bought a property together with no LLC on file can only be connected
through a note that nobody will find at the right moment.

### Two different facts

Keep these apart. They have different owners and different answers.

1. **How well do *I* know this contact?** Per teammate: my answer and a coworker's differ
   for the same person. Only the teammate can say. Draft scale: *Know well* (could ask a
   favor) · *Know* (would take my call) · *Met* (introduced) · *Haven't connected*
   (the default).
2. **Who knows whom, and how well?** Between two contacts, a fact about them and not about
   us. Any teammate can record it and everyone sees the same thing. Needs a description in
   words ("bought a triplex together"). "Referred by" is the only kind with a direction.

The payoff combines them: *I* know A well, A knows B, so ask A about B. That should be on B's
contact page, where it's seen before the call, not in a tab someone has to remember to open.

### What not to infer

- **Note count says nothing about a relationship.** Fifteen notes can be fifteen unanswered
  voicemails, or emails, a coffee meeting and next steps. It isn't even a count of attempts.
  How well I know someone is entered, or suggested and confirmed, never computed from a count.
- **Sharing a company is not a connection.** A CPA linked to forty businesses would be
  "connected" to everyone. Show it as a path ("both at Acme LLC"), don't treat it as a link.
- **Duplicates break chains.** If someone exists twice, their connections split across the
  copies. The email duplicate check on Add Contact (2026-11-18) helps; this raises the stakes.

### Levels, each built on the last

1. **`[[Name]]` links in notes, no AI.** Typing `[[Name]]` in a note links that note to the
   contact, and their page shows the backlink with the note's text as the reason. Fits how
   notes are already written, so there's no separate form. Free and predictable. Records *that*
   two people are connected and why, not how well. Needs an autocomplete on `[[`, a way to
   link a name not yet in the CRM, and a link table written when a note is saved, guarded
   like `contact_links` (same-workspace trigger, members-only RLS).
2. **AI reads each note and suggests; a person confirms.** On save, a model proposes
   one-tap actions: "mentions B, link as co-owners?", "sounds like you met in person, mark as
   *Met*?", "next step Friday, set a follow-up?". Nothing is written without the tap; it will
   sometimes be confidently wrong. Runs as a Supabase Edge Function, so still no server.
3. **Ask questions.** "Who do I know that knows someone at Acme?", "Prep me for my call with
   B": every note, the connections, the ways in. Depends on levels 1–2 having built up clean
   links.

### Constraints

- **Cost.** Levels 2–3 pay an AI provider per note. Small at this volume, but recurring,
  which breaks the "$0 hosting" rule in `CLAUDE.md`. That's a decision, not a default.
- **Compliance, Bank workspace.** Sending bank customers' notes to an outside AI provider
  needs a clear yes from compliance first. It's a bigger question than loan status and goes
  on the "Before any bank data goes in" list. Personal List has no such constraint and is
  the place to try levels 2–3 first.
- **Visibility.** In Bank every teammate sees connection descriptions. "Co-owner" and
  "going through a divorce with" are not the same kind of information.

### Related fix: a note is not a call

`followUpCadence.js` assumes every note is a call and moves the follow-up schedule
(+3, +4, +7…) by note count. A note about a coffee meeting, an email or next steps moves the
contact along as if it were an unanswered dial. Worth fixing regardless of the above. Options:
tag a note's kind (call / email / meeting / note) with quick notes setting it, and count only
call attempts; or let level 2 classify it. Decide before building level 2, since they overlap.

### Before designing

Collect 5–10 real cases as they come up. For each: who I wanted to reach and who the bridge
was; how I learned of the link; how well I knew the bridge and how well the bridge knew
them; where I'd have wanted Taraform to tell me. These settle the scale (4 levels or 3),
whether links mostly come from conversations (pointing to capture in notes) or from what I
already know (pointing to an "add connection" button), and what level 2 should catch.
Keep the cases themselves out of this file: the repo is public.
