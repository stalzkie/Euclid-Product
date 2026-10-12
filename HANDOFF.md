# Where this stands

Written 2026-10-12. Read this first in a new session; `README.md` explains how
the product works, this explains what state it is in.

Repo: https://github.com/stalzkie/Euclid-Product (public, `main`)

## Current state

Everything in the PRD is built — all of P0, P1 and P2.
CI is green on all four jobs.

```
npm run verify            # typecheck + lint + 282 unit tests
npm run test:integration  # 56 tests, needs the app running
npx next build            # production build
```

Counts at the last commit: **380 unit tests**, **57 integration tests**, lint
clean with zero warnings.

### Requirements against the PRD table

| Requirement | Priority | State |
|---|---|---|
| Widget: script tag, inline/floating, Shadow DOM | P0 | Done |
| Widget: hosted public board page | P0 | Done |
| Board: posts, upvotes, comments, statuses | P0 | Done |
| Board: anonymous and email-magic-link identity | P0 | Done |
| Board: moderation queue, allow-list, rate limits, honeypot | P0 | Done |
| Designer: JSON-config with live preview and presets | P0 | Done |
| Changelog: public changelog and voter email on Shipped | P0 | Done |
| AI: duplicate suggestions and merge queue | P0 | Done |
| Build Prompt: profile and generation for each tool | P0 | Done |
| Build Prompt: refinement chat, history, copy and .md | P1 | Done |
| Analytics: top requests, velocity, status funnel | P1 | Done |
| AI: theme clustering with LLM-named clusters | P1 | Done |
| AI: weekly recommendation digest | P1 | Done, run live once |
| AI: chat assistant with cited answers | P1 | Done |
| Identity: signed JWT, segments, plan-weighted votes | P1 | Done |
| Board: custom domain | P1 | Done |
| Integrations: Slack/Discord, GitHub/Linear | P1 | Done |
| Build Prompt: read-only GitHub repo context | P2 | Done |
| MCP server | P2 | Done |
| Designer: auto-match host site colours | P2 | Done |

Every requirement in the PRD is now built.

## What is left

1. **DNS is done.** `app.euclidhq.com` has its CNAME at Hostinger
   (`app CNAME 3687d9a0e68ed4d8.vercel-dns-017.com.`, TTL 300), Vercel reports
   the domain `configured-correctly`, and the certificate is issued. The
   dashboard answers there over HTTPS.

   Vercel did not mint the certificate on its own after the record appeared —
   `npx vercel certs issue app.euclidhq.com` was needed to force it. If a
   future domain sits at a TLS handshake failure while `vercel domains verify`
   already says `configured_correctly`, that is the command.

   The `euclid` project, and `euclidhq.com` itself, serve the marketing site —
   a separate project. Do not deploy this app over it.

2. **Billing is built on Polar and wired up in sandbox.** The code is
   `/api/billing/checkout`, `/api/billing/portal` and `/api/billing/webhook`,
   with `0011_billing.sql` and `src/lib/polar.ts`. Polar is the merchant of
   record; the webhook is the only thing that can move a workspace between
   tiers, and `changePlan` refuses once billing is configured.

   **Applied to production: migration `0011` is live on the Supabase project**,
   and the deployment carries the sandbox Polar variables. The sandbox org has
   four products ($12/mo, $120/yr, $29/mo, $288/yr), an organisation token that
   never expires, and a webhook at `https://app.euclidhq.com/api/billing/webhook`
   on format **Raw** and API version **2027-01**.

   Both of those last two matter and neither fails loudly. Picking Discord or
   Slack format reshapes the payload into something `validateEvent` will not
   parse, and an API version older than the SDK's import changes field names.

   Verified: the webhook rejects an unsigned POST with 403, and a checkout
   created with the live token returns the right product and price with
   `external_customer_id` and `metadata.workspace_id` both carried through —
   which is how the webhook finds the workspace.

   **Not yet verified: a card payment actually landing.** Nobody has completed
   a checkout, so no `subscription.*` webhook has ever been delivered and no
   workspace has moved tier through this path. The deliveries list in Polar is
   empty.

   **Trial, discounts and the student rate are built.** A 7-day trial is set
   on all four sandbox products. Two discounts are designed but **not yet
   created in Polar** (see below). `0012_student.sql` is applied to production:
   a founder verifies a school address by clicking a mailed link, and the
   checkout route then applies a codeless student discount — so there is no
   code to leak. Unrecognised domains route to a human rather than being
   refused, because most of Europe and Latin America put universities on plain
   national domains. Verifications lapse after a year.

   **Blocked: the two discounts do not exist in Polar yet.** The dashboard's
   discount form will not submit under automation, and creating them by API
   needs `discounts:write`, which the token lacks. Adding the scope hits a
   "please sign in again" re-authentication gate. One human sign-in unblocks
   it; `POLAR_DISCOUNT_FIRST_PURCHASE` and `POLAR_DISCOUNT_STUDENT` are unset
   until then, which safely means "no promotion, panel hidden".

   **The deployment is pointed at sandbox Polar.** Before real customers, swap
   `POLAR_SERVER` to `production` *and* the four product ids together — they
   are separate accounts, and mismatched ids make every webhook fail closed
   with "Unknown Polar product".

3. **`npm run verify` is green again.** It briefly failed on
   `src/components/sidebar-rail.tsx` (`react-hooks/set-state-in-effect`, a
   `localStorage` read inside an effect) while the motion/animation work was
   mid-flight. That has since been fixed by whoever is writing it. Noted only
   because the rule will catch the same shape again: read storage in a lazy
   `useState` initialiser, not in an effect that then calls `setState`.

4. **Test coverage gaps.** Integration tests cover `/api/public/*`,
   `/api/mcp`, custom-domain routing and integration delivery. The dashboard
   server actions are covered only by unit tests on their pure logic. There
   is no browser-level end-to-end test (there is `scripts/widget-e2e.mjs`,
   a manual harness).

5. **Two paths never exercised live:** the moderation queue holds nothing on
   the real board (the integration test covers the code path), and no
   Slack/Discord webhook has actually received a message — the delivery
   tests deliberately use URLs that fail, because a test suite should not
   own a chat workspace. Connecting one real webhook would close that.

## Speed

A dashboard navigation was 5–10 seconds and is now 0.8–1.9 s locally; the
widget's own read was 2.8 s and is now 0.85 s. Those are measured against the
live database from this machine, where one round trip to Supabase costs
400–650 ms.

**Deployed into the database's own region, the public paths are ~0.45 s from
here, of which ~0.22 s is this machine's network to Sydney** — a static file
on the same deployment takes that long. So the app's own work is around
0.23 s, down from 0.83 s, and a visitor near the region pays less still. The
dashboard should follow once the DNS record above is in place.

Things that were tried and rejected: caching the public board row
(`unstable_cache` + tag invalidation). It halved the widget read again, to
0.44 s, but the row carries `allowed_domains`, `identity_mode`,
`anon_vote_limit` and `require_approval` — a cached security policy that a
write outside the app leaves stale. Three integration tests say those settings
apply on the next request, and they are right to.

## Live environment

The Supabase project is `ummyxqucomjftlreejxu` (`euclid-product`).

**Ten migrations are applied to the live database.** They were applied by
hand through the Supabase SQL editor, because there is no linked CLI and no
database password available in this environment. `supabase/migrations/`
matches what is live.

- `0001_init` … `0005_match_counts` — schema, functions, RLS, seed support
- `0006_toggle_vote` — atomic vote toggle
- `0007_integrations` — integrations and the delivery outbox
- `0008_custom_domain` — domain verification columns and `board_for_domain`
- `0009_repo_snapshots` — GitHub file listings
- `0010_api_keys` — MCP keys

**Applying a migration from this environment:** open the Supabase SQL
editor, then set the Monaco model value directly from the browser tool
(`window.monaco.editor.getModels()[0].setValue(sql)`) and click Run. Do not
paste SQL through the Windows clipboard — it mangles characters, which is
how seven rows of mojibake got into the database earlier.

Changes made to live data while building:

- The Driftnote workspace was upgraded **free → Pro** to test Ask Euclid.
  No payment was taken.
- An Anthropic workspace "Euclid" was created because the org key had none.
  `ANTHROPIC_WORKSPACE_ID=wrkspc_01VufA4QU6UEkHbr6H8nd4ZK`.
- `EUCLID_SECRET` and `CRON_SECRET` were generated into `.env.local`.
- Resend DNS is verified on Hostinger; one real email was delivered.
- The weekly digest job was run once and produced a real recommendation.

`.env.local` holds the real keys and is **not** committed. `.env.example`
holds placeholders only — it briefly contained real keys and was caught by a
pre-commit scan before anything was pushed.

## Things worth knowing before changing code

- **A dashboard navigation costs one query, and it is easy to undo that.**
  `getFounderContext` reads the workspace, its boards with their open-post
  counts and the project profile in a single embedded select, and verifies the
  session locally against the project's JWKS. Adding a `await db.from(...)` to
  it is paid for on every screen; the database is remote and each round trip
  is most of a second. There are measurements in the commit that made this so.

- **This machine's clock is about two minutes ahead of the database's.**
  Tests must not compute "now" locally and compare it against database
  timestamps. One test failed on exactly this.
- **Integration tests read `.env.local`** and therefore run against the
  production Supabase project. Each file creates its own workspace and
  deletes it afterwards, and the harness prints the target host before it
  starts. Set `TEST_SUPABASE_URL` / `TEST_SERVICE_ROLE_KEY` to aim elsewhere.
- **Kill `next dev` before `next build`.** Running both clobbers `.next` and
  produces CSS 404s and module-not-found errors that look like code bugs.
- **Similarity thresholds are measured, not guessed** (`src/lib/ai/thresholds.ts`,
  measured by `scripts/calibrate.mjs`). Duplicate pairs score 0.40–0.68 and
  unrelated ones 0.10–0.25. The obvious-looking 0.8 would mean detection
  never fires.
- **Clustering uses average linkage, not a running centroid.** The centroid
  drifts and merges unrelated themes. `tests/unit/clustering.test.ts` fails
  if that is reintroduced.
- **Votes are two numbers.** `vote_count` is a headcount shown to end users;
  `weighted_score` orders the founder's view. This answers the PRD's open
  question without ranking users by what they pay.
- **The colour matcher fetches a URL the founder supplied.** That makes
  `src/server/site-palette.ts` a request our server makes to somewhere they
  choose, so it refuses private addresses, re-checks every redirect hop, and
  caps what it reads. `tests/unit/site-palette.test.ts` covers each of those;
  the redirect check in particular was written by removing it and watching a
  test fail.
- **The Supabase client is untyped.** There is no generated `Database` type,
  so new tables need no type regeneration — but also get no compile-time
  checking. Row shapes are asserted at the call site.

## Testing conventions

Tests are checked by mutation, not just written. Before trusting a test,
break the thing it covers and confirm it fails. Several tests in this repo
were strengthened only because a mutation slipped past them:

- the webhook host allow-list (a suffix match would accept
  `evilhooks.slack.com`)
- MCP board isolation (shared post numbers made a leak look like "not found")
- the clustering drift test (synthetic vectors were too clean to fail)

Unit tests live in `tests/unit` and need nothing running. Integration tests
live in `tests/integration`, drive real HTTP against a real database, and
skip rather than fail when nothing is up.

## Known assumption to confirm with the user

Integrations are gated to the paid plans (`integrations: false` on free in
`src/lib/plans.ts`). The PRD's pricing table does not mention integrations,
so this was my call, not theirs.
