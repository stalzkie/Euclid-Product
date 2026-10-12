# Deploying Euclid

Everything in here needs an account, a secret or a DNS record, which is why it
is a document and not code. The code side is done: `vercel.json` carries the
region and the schedules, the job routes carry their own timeouts,
`scripts/vercel-env.mjs` pushes the secrets, and `.env.example` lists every
variable the app reads.

## 1. The database is already live

The Supabase project is `ummyxqucomjftlreejxu`. All migrations in
`supabase/migrations/` are applied to it. A deployment points at the same
project — there is nothing to migrate at deploy time.

If you ever stand up a second environment, apply `0001` … `0010` in order
through the Supabase SQL editor. Do not paste SQL through the Windows
clipboard; see HANDOFF.md for why.

## 2. Deploy in the database's region

**The Supabase project is in AWS `ap-southeast-2` (Sydney)**, which is
`syd1` on Vercel. `vercel.json` pins functions there.

This is the single biggest thing available to the app's speed. Every screen
is one or two round trips to Supabase, and from a development machine each
costs 400–650 ms; from a function in the same AWS region it is single-digit
milliseconds. A dashboard navigation measured at 0.8–1.9 s locally should
land near 200 ms deployed, without another line of code.

How the region was established, in case the project is ever moved:
`db.<ref>.supabase.co` resolves to `2406:da1c:4c7:f800::28d2`, and
`2406:da1c::/35` is `ap-southeast-2` in AWS's published `ip-ranges.json`.

Hobby allows one non-default region and `vercel.json` sets it, so no
dashboard step is needed. Routing Middleware still runs at the edge near the
visitor — which is fine, because it verifies the session against the
project's public key set in process rather than calling the auth server.

## 3. Create the project

```
npx vercel link          # or import the GitHub repo at vercel.com/new
npx vercel --prod
```

The repo is `stalzkie/Euclid-Product`, and `main` is the production branch.

## 4. Environment variables

`node scripts/vercel-env.mjs production` pushes every variable from your
local `.env.local` to the linked project. It never prints a value, skips the
three `TEST_*` variables that describe your machine, and replaces rather than
appends, so it is safe to re-run. `--dry` shows what it would do without an
account.

Set `NEXT_PUBLIC_APP_URL` to the deployment's own hostname afterwards, and
deploy again: `NEXT_PUBLIC_*` values are baked into the client bundle at
build time, so a build made with `http://localhost:3000` in it will hand
founders install snippets pointing at their own laptop.

| Variable | Needed for | Without it |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | everything | `/setup` page instead of the app |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | everything | same |
| `SUPABASE_SERVICE_ROLE_KEY` | widget API, jobs | the board accepts nothing |
| `NEXT_PUBLIC_APP_URL` | install snippets, custom domains | snippets point at localhost |
| `ANTHROPIC_API_KEY` | Build Prompt, Ask Euclid, theme names | those screens explain they are off |
| `ANTHROPIC_WORKSPACE_ID` | org-scoped Anthropic keys | the API rejects the key |
| `EMBEDDINGS_API_KEY` | duplicate detection, clustering | falls back to a local hash: literal matches only |
| `EUCLID_SECRET` | signed-JWT identity | that identity mode is unavailable |
| `RESEND_API_KEY`, `EMAIL_FROM` | magic links, ship notifications | email is logged, never sent |
| `CRON_SECRET` | `/api/jobs/*` | **the job endpoints return 503 and stay disabled** |

`NEXT_PUBLIC_APP_URL` must be the hostname founders' browsers will actually
load the widget from. It is what the middleware compares the incoming `Host`
against to tell a custom domain from this deployment, so getting it wrong does
not fail loudly — custom domains simply stop resolving to their boards.

## 5. The scheduler

`vercel.json` declares both jobs. Vercel adds `Authorization: Bearer
$CRON_SECRET` to a cron request on its own once that variable is set, which is
exactly what `authorizeCron` checks — so there is nothing else to wire.

- `/api/jobs/run` every 10 minutes — drains the email outbox and the webhook
  delivery queue, and clears expired magic links.
- `/api/jobs/digest` Mondays at 09:00 UTC — the weekly recommendation, for
  every board on a plan that includes it.

**On the Hobby plan, crons run at most once a day and only two may exist.** The
two above fit the count but not the frequency; Vercel will coerce them. That is
survivable because the request that queues work also drains a little of it once
its response has gone out (`src/server/dispatch.ts`), so magic links and Slack
messages do not wait for the cron. The cron is the retry path, not the delivery
path. On Pro the schedules above run as written.

On another host, point any scheduler at the same two URLs with that header:

```
curl -X POST https://<host>/api/jobs/run -H "Authorization: Bearer $CRON_SECRET"
```

## 6. DNS

`euclidhq.com` currently carries only the Resend records. Add:

- the apex or `app.` record Vercel gives you for the deployment itself, and
- nothing else — founders' custom domains CNAME to *your* hostname, and the
  install screen shows each founder the exact record to add.

Resend's verification records are already in place on Hostinger and one real
email has been delivered through them.

## 7. After the first deploy

- Open `/install` and copy the script tag; it should carry the production
  hostname, not localhost.
- Post from a real board and confirm the post appears, then check
  `/api/jobs/run` has nothing left to send.
- Connect one real Slack or Discord webhook. The delivery path is covered by
  tests that deliberately use failing URLs, so no webhook has ever actually
  received a message from this code.

## Not built

There is no payment processor. Plans and their limits are enforced in
`src/lib/plans.ts`, but moving a workspace between plans is a database edit.
