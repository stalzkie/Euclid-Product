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

If you ever stand up a second environment, apply `0001` … `0013` in order
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

## 3. The project

Live as **`stalwrites/euclid-product`**. Deploy with `npx vercel deploy --prod`.

`stalwrites/euclid` is a different thing — the marketing site on
`euclidhq.com`. Do not link this repo to it.

Next.js must stay current: Vercel refuses to build a release with a published
advisory against it, and that is how this app ended up on 16.x.

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

- `/api/jobs/run` daily at 03:00 UTC — drains the email outbox and the webhook
  delivery queue, and clears expired magic links.
- `/api/jobs/digest` Mondays at 09:00 UTC — the weekly recommendation, for
  every board on a plan that includes it.

**Hobby allows a cron to run at most once a day, and it fails the deploy
outright if one would run more often** — it does not quietly coerce the
schedule. That is why `/api/jobs/run` is daily here and not every ten minutes.

Daily is survivable only because the request that queues work also drains a
little of it once its response has gone out (`src/server/dispatch.ts`): magic
links and Slack messages go immediately, and the cron is the retry path rather
than the delivery path. **On Pro, change `/api/jobs/run` to `*/10 * * * *`** —
that is what it should be, and a failed webhook would then be retried in
minutes instead of a day.

On another host, point any scheduler at the same two URLs with that header:

```
curl -X POST https://<host>/api/jobs/run -H "Authorization: Bearer $CRON_SECRET"
```

## 6. DNS

`euclidhq.com` currently carries only the Resend records. Add:

- `app  CNAME  3687d9a0e68ed4d8.vercel-dns-017.com.` — the per-domain target
  for `app.euclidhq.com`, not the generic `cname.vercel-dns.com`. Re-print it
  with `npx vercel domains verify app.euclidhq.com`. **Until this exists the
  dashboard is unreachable**, because middleware rewrites any host that is not
  `NEXT_PUBLIC_APP_URL` to a board's custom-domain route.
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

## 8. Billing

Polar is the merchant of record. Euclid never sees a card: checkout and the
customer portal are both Polar's own pages, and this app stores only the
identifiers needed to tie a workspace to its subscription.

**Four products, because Polar gives a product one billing interval.** Create
them in the Polar organisation and put their ids in the environment:

| Product | Price | Variable |
|---|---|---|
| Euclid Indie — Monthly | $12 / month | `POLAR_PRODUCT_INDIE_MONTHLY` |
| Euclid Indie — Yearly | $120 / year | `POLAR_PRODUCT_INDIE_YEARLY` |
| Euclid Pro — Monthly | $29 / month | `POLAR_PRODUCT_PRO_MONTHLY` |
| Euclid Pro — Yearly | $288 / year | `POLAR_PRODUCT_PRO_YEARLY` |

Then `POLAR_ACCESS_TOKEN` (an organisation access token with `checkouts:write`,
`customer_sessions:write` and `subscriptions:read`), and `POLAR_WEBHOOK_SECRET`
from the webhook endpoint.

**Point the webhook at `https://<host>/api/billing/webhook`** and subscribe it
to the `subscription.*` events. This endpoint is the only thing in the system
allowed to move a workspace between tiers — `changePlan` refuses outright once
billing is configured, so a missing or misconfigured webhook does not fail
loudly, it just means nobody's plan ever changes after they pay.

`POLAR_SERVER` is `sandbox` unless set to exactly `production`. That default is
deliberate: a deployment that forgets the variable sends money nowhere rather
than to a live card. Sandbox and production are separate Polar accounts with
separate products, so **the four product ids must be changed at the same time as
`POLAR_SERVER`** — mismatched ids make every webhook fail closed with "Unknown
Polar product", which is the intended behaviour and not a bug to work around.

Without `POLAR_ACCESS_TOKEN` or with any product id missing, `billingEnabled()`
is false and the billing page falls back to switching plans without charging.
That is how local development and the tests exercise the paid tiers, and it is
also what a self-hosted deployment gets.

### Trials, discounts and the student rate

**Trial.** Configured per product in Polar (7 days on all four). The app needs
no entitlement change — `isEntitled` already counts `trialing` — but set
`POLAR_TRIAL_DAYS` so the upgrade button can say so. Unset means the button
promises nothing, which is correct for a deployment whose products have no
trial. It is only copy; Polar owns the trial itself.

**Launch promotion.** `POLAR_DISCOUNT_FIRST_PURCHASE` is a codeless Polar
discount applied automatically at checkout. Polar enforces its own start and end
dates, so an expired promotion is refused there rather than running forever —
which is why no date is duplicated in this repo.

**Student rate.** `POLAR_DISCOUNT_STUDENT`, also codeless, and that is the
point: the checkout route applies it for a workspace whose student email has
been verified, so there is nothing to leak, cap or rotate. Unset hides the
verification panel entirely.

The verification flow is one link, mailed to the address being claimed:

- A domain that looks academic — a bare `.edu`, or `ac`/`edu`/`sch` under a
  real two-letter country — gets the link sent to the student directly.
- Anything else gets the link sent to `STUDENT_REVIEW_EMAIL` (falling back to
  the address inside `EMAIL_FROM`) for a human to approve. **This is not
  pedantry:** most of Europe and Latin America put universities on an ordinary
  national domain — Heidelberg is `uni-heidelberg.de` — and a strict list
  silently turns those students away.
- Two-letter domains sold as vanity names (`.io`, `.co`, `.ai`, …) are excluded
  from the automatic path, or anyone could buy `whatever.ac.io`.

Verifications lapse after a year (`STUDENT_VERIFICATION_DAYS`). Institutions
let alumni keep an address for life, so a one-time check would be a permanent
half-price plan. Changing the window is a code change, not a migration — expiry
is computed from `student_verified_at` rather than stored.

A verified student gets the student discount even when the launch promotion is
larger on the first invoice. Polar applies one discount per checkout, and the
student rate is the one that keeps applying.

## Not built

Nothing in the PRD is unbuilt. Two things are worth knowing:

- Polar's organisation must finish its own payout and identity checks before a
  checkout will complete — that is between you and Polar, not something this
  repo can configure.
- Plan *downgrades* happen through Polar's portal and take effect when the paid
  period ends, which is Polar's behaviour rather than a choice made here.
