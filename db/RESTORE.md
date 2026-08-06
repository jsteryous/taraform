# Backup & restore

A backup nobody has ever restored is a rumour. Read this before you need it.

## What exists

`.github/workflows/backup.yml` runs nightly at 08:30 UTC and commits three files
to the **private** `taraform-backups` repo:

| File | What | Restore order |
|---|---|---|
| `schema.sql` | Tables, policies, functions, triggers, sequences | 1st |
| `data.sql` | Every row in `public` | 2nd |
| `auth.sql` | `auth` schema data — the user UUIDs `client_users` points at | 3rd |

Git keeps every night's version, so you can recover to any past day, not just
last night: `git log --oneline` in the backups repo, then `git checkout <sha>`.

**Why a separate private repo:** this repo is public. Dumps committed here — or
uploaded as Actions artifacts, which are world-readable on a public repo — would
publish every contact, phone number and offer.

## Why this exists at all

The project is on the Supabase **Free plan**, which gets no platform backups and
no point-in-time recovery. Supabase's own docs tell free-tier users to dump their
own data and keep it off-site. If this workflow is red, you have no backup.

## Restoring

### A few rows you deleted by accident

Don't restore the whole database. Pull the rows out of the dump and re-insert:

```bash
git clone git@github.com:jsteryous/taraform-backups.git
grep 'Nicholas' taraform-backups/data.sql        # find the row
```

`data.sql` is `COPY`-format text, one row per line, tab-separated in table order.

### The whole database, into a fresh project

```bash
# 1. Create a new Supabase project, then grab its session-pooler URI from
#    Settings -> Database -> Connection string.
export NEW_DB="postgresql://postgres.<ref>:<pw>@<host>.pooler.supabase.com:5432/postgres"

# 2. Restore in order. Schema first — data.sql assumes the tables exist.
psql "$NEW_DB" -f schema.sql
psql "$NEW_DB" -f auth.sql
psql "$NEW_DB" -f data.sql

# 3. Point the app at the new project: update VITE_SUPABASE_URL and
#    VITE_SUPABASE_ANON_KEY (GitHub -> Settings -> Secrets, and .env locally).
```

### Verifying a restore

Compare the restored database against the dump you restored from, rather than
against numbers written down here — this repo is public, and the size of the
book is not something to publish.

```sql
select
  (select count(*) from property_crm_contacts) as contacts,
  (select count(*) from contact_offers)        as offers,
  (select count(*) from clients)               as clients,
  (select count(*) from client_users)          as memberships,
  (select count(*) from auth.users)            as users;
```

The expected numbers are in the dump itself — `grep -c` the `COPY` block for
each table in `data.sql`, or check the previous night's commit in the backups
repo. A restore that lands materially under those lost something.

Then confirm tenancy survived the restore — RLS is the only authorization
boundary, and a restore that drops policies silently makes every list world-
readable. `db/20260806_close_cross_tenant_insert.sql` documents the role
simulation that proves it; re-run that probe against the restored database.

## Testing the backup

Do this once now and once a year, or you don't have a backup — you have a cron
job that produces files.

1. Actions tab → **Nightly DB backup** → **Run workflow**.
2. Confirm three files landed in `taraform-backups` and `data.sql` is ~1 MB+.
3. Restore into a throwaway Supabase project using the steps above.
4. Check the row counts match the table above.

## Setup (one time)

The workflow needs these, or it fails on the first run:

- A **private** repo `jsteryous/taraform-backups` with one commit on `main`.
- Repo **variable** `BACKUP_REPO` = `jsteryous/taraform-backups`.
- Secret `BACKUP_REPO_TOKEN` — a fine-grained PAT scoped to *only* that repo,
  with **Contents: read and write**.
- Secret `SUPABASE_DB_URL` — Settings → Database → Connection string → **Session
  pooler**, URI form, with the password substituted in. Use the pooler, not the
  direct connection: GitHub runners are IPv4-only and the direct host is IPv6.
