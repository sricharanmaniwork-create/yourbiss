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

`supabase/migrations/` applies in numeric order. 0001–0007 are already applied to the
project; **0008 and 0009 are still to be run by hand**:

- `0008_api_role_grants.sql` — the privileges the RLS policies in 0001–0007 already assume.
  Without it, `authenticated` reaches tables it is allowed to select from but has no grant on.
- `0009_form_logic_hidden_fields.sql` — teaches the submission guard about conditional logic,
  so a question the visitor was never shown is not counted as an unanswered one.

Apply them in Supabase Studio → SQL editor, or `supabase db push` against the project.

Two rules this repository works under:

* An applied migration is immutable. A change in behaviour is a new file, never an edit.
* Every new table needs its own `GRANT` and its own policies — Postgres grants nothing to
  `anon`/`authenticated` by default and Supabase's API roles are not exempt.

## Mail

`sendMail()` in `src/lib/mail/index.ts` is the only door, and it resolves a transport in this
order: the workspace's own SMTP settings, then that workspace's Resend provider row, then the
platform `RESEND_API_KEY`, then nothing — the message is logged as `skipped` and the caller
still succeeds. A booking must never roll back because a mail host timed out.

* Supabase's built-in SMTP is not used for anything. For **sign-up and password emails**, set
  Supabase's own SMTP sender (Authentication → SMTP) to Resend's SMTP relay
  (`smtp.resend.com`, port 465, username `resend`, password your API key). Resend requires a
  verified sending domain before it accepts mail for one.
* Workspace credentials are encrypted with `APP_ENCRYPTION_KEY` and stored in
  `org_email_passwords`; Settings → Email can verify them without sending to a customer.
* Every send lands in `email_log` with its provider, state and provider message id. A
  workspace's `daily_quota` is enforced there, and a provider failure is written back to
  `org_email_settings.last_error` so it is visible in the app.

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

`scratch/` holds the checks that are not unit-testable from a browser:
`node scratch/blocks_smoke.cjs` walks every builder block, `node scratch/sql_reference_check.cjs`
asserts that each SQL function and table this repository mentions actually exists in the
migrations.
