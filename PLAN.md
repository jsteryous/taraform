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
