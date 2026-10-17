# Yourbiss

A multi-tenant SaaS suite — website builder, Forms and Bookings today, with Store, CRM,
Inventory, Automations and Board still planned — modelled on how Zoho lays its apps out:
one workspace, one left rail, one settings surface, every app writing to the same Postgres.

Tenancy, scheduling rules and form-submission validity live in Postgres, not in TypeScript.
The app validates what it can and asks the database to decide the rest.

## Stack

Next.js 16 (App Router, Turbopack) · React 19 · TypeScript strict · Tailwind 4 · Supabase
(Postgres + RLS + auth) · nodemailer and Resend · hosted on Vercel, source on GitHub.

There is no AI feature in this product, and no seeded or demo data anywhere: an empty
workspace stays empty until a real customer signs up.

## Environment

Read lazily through `src/lib/env.ts`, so a missing variable surfaces as a readable message
on the first request that needs it rather than a crash at build time.

| Variable | Required | What it is for |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | yes | Supabase project URL. |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | yes | Publishable (fine-grained) client key. |
| `SUPABASE_SECRET_KEY` | yes | Server-only service-role key. Never exposed to the browser. |
| `NEXT_PUBLIC_SITE_URL` | no | Canonical origin for links written into mail. Falls back to the request's own `Host`. |
| `RESEND_API_KEY` | no | The platform-default transport for workspaces that configure nothing. |
| `EMAIL_DEFAULT_FROM` | no | From header for that platform default, e.g. `Yourbiss <mail@yourbiss.com>`. |
| `APP_ENCRYPTION_KEY` | for custom SMTP | 64 hex characters (32 bytes). Encrypts a workspace's SMTP password at rest. |
| `CRON_SECRET` | for the mail cron | Bearer token that guards `GET /api/cron/bookings-mail`. |
| `GITHUB_CLIENT_ID` / `GITHUB_CLIENT_SECRET` | no | GitHub sign-in. |

Generate the encryption key with:

```
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

## Database

`supabase/migrations/` applies in numeric order. **0001–0012 are all applied to the project**,
and the next file to write is `0013_*`.

Apply new files in Supabase Studio → SQL editor, or `supabase db push` against the project.
**When pasting into the SQL editor, wrap the file in a transaction** — `begin;` above the
first statement, `commit;` below the last. The editor otherwise runs a script one statement
at a time and leaves whatever it got through behind when one fails, and `supabase db push`
wraps each file only because it does the wrapping itself.

Four rules this repository works under:

* An applied migration is immutable. A change in behaviour is a new file, never an edit.
* Every new table needs its own `GRANT` and its own policies — Postgres grants nothing to
  `anon`/`authenticated` by default and Supabase's API roles are not exempt.
* A migration that failed halfway is repaired before it is re-run, not edited around the
  objects it left behind. `supabase/repairs/` holds those repairs, and
  `supabase/repairs/diagnose_app_state.sql` says which state the database is actually in.
* A read names a **column**, never an SQL expression. `.order('lower(name)')` reads like the
  expression index beside it, but the REST layer only accepts a column — optionally qualified,
  optionally with `.desc`/`.nullsfirst` — and it fails the entire request rather than sorting
  some other way. A failed read inside a Server Component is what a screen shows as
  "Minified React error #441", so the case-insensitive sort goes in the collation, which
  already ignores case.

## Mail

`sendMail()` in `src/lib/mail/index.ts` is the only door, and it resolves a transport in this
order: the workspace's own SMTP settings, then that workspace's Resend provider row, then the
platform `RESEND_API_KEY`, then nothing — the message is logged as `skipped` and the caller
still succeeds. A booking must never roll back because a mail host timed out.

* Supabase's built-in SMTP is not used for anything. For **sign-up and password emails**, set
  Supabase's own SMTP sender (Authentication → SMTP) to Resend's SMTP relay
  (`smtp.resend.com`, port 465, username `resend`, password your API key). Resend requires a
  verified sending domain before it accepts mail for one.
* Sign-up confirmation and "Forgot your password?" both land on `/auth/callback`, so the only
  Redirect URL the project needs allow-listed is `https://<deployment host>/auth/callback`.
  A recovery link exchanges for a session and then opens `/reset-password`, where the visitor
  types the new password; the app never sees, stores or transports a password hash.
* Workspace credentials are encrypted with `APP_ENCRYPTION_KEY` and stored in
  `org_email_passwords`; Settings → Email can verify them without sending to a customer.
* Every send lands in `email_log` with its provider, state and provider message id. A
  workspace's `daily_quota` is enforced there, and a provider failure is written back to
  `org_email_settings.last_error` so it is visible in the app.
* A workspace can rewrite the wording of its letters (Settings → Email → Letter wording). That
  writes a row in `email_templates`; `resolveMail()` swaps the built-in letter for it, and no
  row means the default goes out. The stored body is treated as **text, never markup** — it is
  escaped and re-paragraphed inside the same shell the default letter uses, so there is no HTML
  injection surface and no separate renderer to keep in sync.

## Booking mail

The SQL functions only queue letters. `create_booking`, `cancel_booking` and
`reschedule_booking` insert rows into `booking_notifications`; nothing in the customer's
request path touches SMTP.

Two things drain that queue:

* **Inline** — after a booking is made, cancelled or moved, the request handler calls
  `drainBookingMailSoon()`, which sends the queue once the response is out. This is what makes
  a confirmation arrive within a minute rather than whenever a scheduler next fires.
* **On a schedule** — for anything the inline run missed (a provider outage, a function
  frozen mid-send, a reminder that becomes due overnight):

```
curl -X GET https://yourbiss.vercel.app/api/cron/bookings-mail \
  -H "Authorization: Bearer $CRON_SECRET"
```

Every five to fifteen minutes is plenty. It answers with `{ ok, sent, failed, skipped,
reminders, queued }`. Without `CRON_SECRET` set it refuses with 503 rather than run
unguarded, because the queue spans every workspace on the platform.

There is deliberately no `vercel.json`: the Hobby plan allows one cron job a day, which would
be worse than no cron at all. Add one when the deployment moves to Pro.

Reminders are queued for appointments starting inside the next 24 hours and are stamped once
per booking (`bookings.reminded_at`), so an appointment is never reminded twice. A letter that
fails is retried on the next run and given up on at twenty attempts, which is what the
`attempts` check constraint enforces.

## Commands

```
npm run dev        # local app on :3000
npm run typecheck  # tsc --noEmit
npm run lint       # eslint over the repository (Next 16 has no `next lint`)
npm run build      # production build
```

On a small machine, give the tooling a heap ceiling and the build fewer workers:

```
NODE_OPTIONS=--max-old-space-size=6144 npx tsc --noEmit
```

`scratch/` holds the checks that are not unit-testable from a browser, and they are the
substitute for a database this machine cannot run:

* `node scratch/blocks_smoke.cjs` — every builder block renders and round-trips.
* `node scratch/sql_reference_check.cjs` — each SQL function and table the repository mentions
  exists in the migrations, dollar quotes balance, and no comment line has swallowed a column
  definition (the mistake that broke 0012).
* `node scratch/column_check.cjs` — every `<table>.<column>` written in the SQL is a declared
  column.
* `node scratch/postgrest_columns_check.cjs` — every column, table and RPC name the **app**
  hands to the REST layer exists in the migrations, and every `.order()`/`.eq()`/`.filter()`
  argument is a plain column rather than an expression. Pass a migration prefix to check the
  app against the database as it stands partway through: `node scratch/postgrest_columns_check.cjs 0011`.
* `node scratch/audit_grants.mjs` — no table is left without a grant or without RLS.
