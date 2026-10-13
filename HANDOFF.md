# Where this stands

Written 2026-10-12, updated 2026-10-13. Read this first in a new session;
`README.md` explains how the product works, this explains what state it is in.

Repo: https://github.com/stalzkie/Euclid-Product (public, `main`)

## Current state

Everything in the PRD is built, plus billing and student verification, which
the PRD did not specify. **The app is live at `https://app.euclidhq.com`.**

```
npm run verify            # typecheck + lint + 439 unit tests
npm run test:integration  # 57 tests, needs the app running
npm run test:e2e          # 14 browser tests, needs the app running
npx next build            # production build
```

Counts at 2026-10-13: **439 unit tests across 20 files**, **57 integration
tests**, **14 browser tests across 3 specs**, lint clean with zero warnings.

**Thirteen migrations, all applied to the live database.** `0011_billing`,
`0012_student` and `0013_workspace_bootstrap` were confirmed present in
production by querying `pg_proc` for `apply_subscription`, `verify_student`
and `create_workspace`.

Recent commits: `d2c20fe` motion across every screen, `fb3c615` Polar billing
and the student discount, `3babf4e` the auth code exchange.

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

Every requirement in the PRD is now built. Three things exist that the PRD
never asked for:

| Addition | State |
|---|---|
| Billing through Polar: checkout, portal, webhook | Live in **sandbox** |
| 7-day trial, launch promotion, student rate | Live in **sandbox** |
| Student verification by school email | Built, never run end to end |

## Start here

Ordered by what actually blocks a launch. Detail for each is further down.

1. **Flip Polar from sandbox to production.** The live site currently points at
   sandbox, which is safe only because the sole workspace is the founder's own.
   Needs: four products recreated in the production org, both discounts
   recreated, `POLAR_SERVER=production`, and all six ids swapped **together** —
   sandbox and production are separate accounts, and a mismatched id makes
   every webhook fail closed with "Unknown Polar product". Polar also has to
   finish payout/KYC before a real checkout can complete, which is not instant
   and is worth starting early.

   **Run `node scripts/polar-preflight.mjs` before and after.** It asks Polar
   what the configured ids actually are, on whichever server `POLAR_SERVER`
   names, and exits non-zero if the environment could not sell correctly. It
   catches the whole failure mode in one call: a production id read against
   sandbox is a 404, a sandbox token used against production is a 401, and —
   the one nothing else would catch — a monthly and a yearly id swapped between
   slots resolve perfectly well and quietly sell the wrong billing period.
   It also checks that all four products sit in one organisation, that none is
   archived or unpriced, that no two slots share an id, and that the trial on
   the products matches `POLAR_TRIAL_DAYS`, which is what the upgrade button
   promises. Green against sandbox today.

2. **Exercise the integration outbox.** Post on the live board and confirm
   Discord fires within seconds. `sendTestMessage` and the manual script both
   call `postToWebhook` directly, so `enqueueIntegrationEvent` ->
   `integration_outbox` -> `deliverIntegrationEvents` has still never run
   against a real endpoint. `drainAfterResponse` should deliver immediately; if
   it waits for the daily cron, that is a real finding and nothing tests it.

3. **Send one student verification email.** Same shape of gap: the redeem path
   works in production, the mailing leg has never run.

4. **On Pro, change `/api/jobs/run` to `*/10 * * * *`.** Hobby caps a cron at
   daily and fails the deploy if one would run more often.

**Browser E2E is done** — 14 Playwright specs, in the CI job that already
stands up Supabase. It found two real widget bugs on its first run; see
"Browser tests" below.

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

   **A real checkout has now completed, end to end.** A sandbox card payment
   moved the Driftnote workspace to Pro through the webhook. Polar delivered
   `subscription.created`, `subscription.active` and `subscription.updated`,
   all answered **200**, and the row ended up exactly right:

   ```
   plan=pro  billing_period=monthly  subscription_status=active
   polar_customer_id=0ef97459…  polar_subscription_id=fa895761…
   current_period_end=2026-11-12T15:21:52.815721Z   (matches Polar exactly)
   ```

   The three events arriving for one state change is normal and is why
   `apply_subscription` is idempotent — it applied the same state three times
   with no retries and no drift.

   **Trial, discounts and the student rate are built.** A 7-day trial is set
   on all four sandbox products; `POLAR_TRIAL_DAYS` only drives the button
   copy, since Polar owns the trial itself and `isEntitled` already counts
   `trialing`. `0012_student.sql` is applied to production:
   a founder verifies a school address by clicking a mailed link, and the
   checkout route then applies a codeless student discount — so there is no
   code to leak. Unrecognised domains route to a human rather than being
   refused, because most of Europe and Latin America put universities on plain
   national domains. Verifications lapse after a year.

   **Both discounts exist in sandbox and are wired up.**

   | Discount | Code | Amount | Duration | Ends |
   |---|---|---|---|---|
   | Launch 20% | none | -20% | once | 2026-11-11T16:00Z |
   | Student | none | -50% | forever | never |

   Neither has a code, by design: the checkout route picks one and passes
   `discount_id`, so nothing is typed in and nothing can be shared. Verified
   against the live sandbox API — a Pro Monthly checkout carrying the promo
   returns $29.00 less $5.80 = $23.20.

   Getting them created was unpleasant and is worth recording. The dashboard's
   discount form ignores synthetic typing: values must be set through the
   native `HTMLInputElement.value` setter with an `input` event dispatched, and
   Radix dropdowns need the `[role="option"]` element clicked directly rather
   than keyboard navigation, which overshoots. The API would have been easier
   but needs `discounts:write`, and **every token operation — create as well as
   update — is behind a "please sign in again" gate** unless the browser
   session is minutes old.

   Reading ids back needed neither: `fetch` from the dashboard's own page with
   `credentials: "include"` reuses the session cookie against
   `sandbox-api.polar.sh`.

   **The deployment is pointed at sandbox Polar.** Before real customers, swap
   `POLAR_SERVER` to `production` *and* the four product ids together — they
   are separate accounts, and mismatched ids make every webhook fail closed
   with "Unknown Polar product". `scripts/polar-preflight.mjs` is the check
   for exactly that; see item 1 under "Start here".

   The preflight cannot verify the two discount ids. The organisation token
   has no `discounts:read`, so it says so rather than reporting a green tick
   over something it never looked at. A wrong discount id surfaces as a
   refused checkout, not a wrong price, which is the less dangerous half.

3. **Student verification has never been run end to end.** The code is there
   and unit-tested — `src/lib/student.ts`, `src/server/student.ts`,
   `/api/billing/student` — and the route correctly bounces a bogus token to
   `/billing?student=failed` in production. But no verification email has ever
   been sent, so the `email_outbox` -> `sendQueuedEmails` leg of it is
   unproven. Sending one to a real address is the check.

   Note the panel only appears when `POLAR_DISCOUNT_STUDENT` is set, so on a
   deployment without it this is invisible rather than broken.

4. **Browser tests exist now, and they found two real bugs.**
   `tests/e2e/`, 14 specs over Chromium, driven by `playwright.config.ts` and
   run in CI as the last steps of the integration job — the same local
   Supabase, the same built app, so Playwright cost a few steps rather than a
   second environment.

   What they cover: the widget mounting in a Shadow DOM on a deliberately
   hostile host page, the launcher and the frame's `euclid:height` handshake,
   inline mode, vote/post/comment as an anonymous end user, the duplicate
   nudge, the honeypot, and a real magic-link sign-in through
   `/auth/callback` -> `/auth/hash` -> `/auth/land` into the dashboard.

   **Two bugs, both in `public/widget.js`, both invisible to anything that
   does not open a page:**

   - **Escape never closed the floating panel.** The loader focuses the iframe
     when the panel opens, so every keypress after that landed in the frame's
     document and the host page's `keydown` listener never heard it. Fixed by
     having the embedded board post `euclid:close` to the parent — the channel
     `euclid:height` already uses — with the loader closing the panel and
     returning focus to the launcher.
   - **Inline mode did not mount where the founder asked.** `mountInline()`
     appended the host element into the founder's container and then an
     unconditional `document.documentElement.appendChild(host)` immediately
     moved it back out, so the board rendered at the end of the document. The
     append now happens only in floating mode, where a fixed-position panel
     belongs outside the host page's layout.

   Both fixes are held by specs that failed before them. The honeypot spec was
   mutation-checked the usual way: with the check in `submitPost` disabled it
   fails, and the Shadow DOM style assertion first proves the host page's
   Comic Sans rule still reaches a plain light-DOM button, so it cannot pass
   by the rule having quietly stopped applying.

   **Running them locally** needs a built app, not `next dev`:
   `npx next build && npm run start`, then `npm run test:e2e`. They read the
   same env as the integration suite and print their target before starting.
   With no Docker on this machine that target is the production Supabase
   project: each run creates one workspace, one board, two posts and one auth
   user, and deletes all of it afterwards — including the auth user, which the
   workspace cascade cannot reach.

   `supabase/config.toml` needed a fix for this. Its `site_url` was
   `http://127.0.0.1:3000` and `additional_redirect_urls` was
   `["https://127.0.0.1:3000"]`, so a magic link aimed at
   `http://localhost:3000/auth/callback` was not allow-listed — and GoTrue does
   not refuse an unlisted `redirect_to`, it silently substitutes `site_url`.
   Both now name localhost with a wildcard path. The fixture checks the
   generated link's `redirect_to` and says so by name rather than timing out on
   a dashboard assertion.

   **Still not covered:** the dashboard server actions have only unit tests on
   their pure logic. The JWT identity path (`window.EuclidIdentity` ->
   `&token=` -> "Posting as …") has unit tests and
   `scripts/test-identity.mjs`, but no browser spec; it is the cheapest next
   one to add, needing a board with `identity_mode: "jwt"` and `EUCLID_SECRET`
   shared with the server. Slack's payload shape is still unexercised
   end to end. `scripts/widget-e2e.mjs` remains as a manual API harness.

5. **A real Discord webhook has now received messages.** On 2026-10-13 all
   three shapes were delivered to a live webhook and accepted with `204 No
   Content`: the test message, a `post.created`, and a `post.status_changed`.
   The payloads came from `chatPayload` itself rather than being hand-written,
   so this exercised the real builder and the real allow-list.

   **What it did not prove:** the outbox. `sendTestMessage` — and the script
   used here — call `postToWebhook` directly, so `enqueueIntegrationEvent` ->
   `integration_outbox` -> `deliverIntegrationEvents` is still unexercised
   against a real endpoint. Posting on the live board is what would close that;
   `drainAfterResponse` should deliver within seconds rather than waiting for
   the daily cron, and if it does not, that is a real finding.

   Slack has still never received anything. Its payload is a different shape
   (`blocks` and mrkdwn, not `embeds`), so Discord working says nothing about
   it.

6. **The moderation queue holds nothing on the real board.** The integration
   test covers the code path; no real post has ever been held for approval.

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

**Thirteen migrations are applied to the live database.** They were applied by
hand through the Supabase SQL editor, because there is no linked CLI and no
database password available in this environment. `supabase/migrations/`
matches what is live.

- `0001_init` … `0005_match_counts` — schema, functions, RLS, seed support
- `0006_toggle_vote` — atomic vote toggle
- `0007_integrations` — integrations and the delivery outbox
- `0008_custom_domain` — domain verification columns and `board_for_domain`
- `0009_repo_snapshots` — GitHub file listings
- `0010_api_keys` — MCP keys
- `0011_billing` — Polar ids on `workspaces`, and `apply_subscription`
- `0012_student` — student columns, `student_verifications`, `verify_student`
- `0013_workspace_bootstrap` — `create_workspace`, because onboarding could not
  bootstrap an owner under RLS

To confirm what is live rather than trusting this list:

```sql
select p.proname from pg_proc p join pg_namespace n on n.oid = p.pronamespace
where n.nspname = 'public'
  and p.proname in ('apply_subscription', 'verify_student', 'create_workspace');
```

**Applying a migration from this environment:** open the Supabase SQL
editor, then set the Monaco model value directly from the browser tool
(`window.monaco.editor.getModels()[0].setValue(sql)`) and click Run. Do not
paste SQL through the Windows clipboard — it mangles characters, which is
how seven rows of mojibake got into the database earlier. Strip non-ASCII from
the SQL first: an em dash in a comment is enough to trip it.

Two quirks of that editor, both of which cost time:

- `setValue` on a **freshly opened** editor can be lost before React registers
  it. Wait ~1s after setting, then click Run, and check the model length first.
- Ctrl+Enter does not always run. Clicking the Run button does.
- The results grid is virtualised, so reading it back needs a TreeWalker over
  text nodes rather than a cell selector. Screenshots of that tab time out.

Changes made to live data while building:

- The Driftnote workspace was upgraded **free → Pro** to test Ask Euclid.
  No payment was taken.
- An Anthropic workspace "Euclid" was created because the org key had none.
  `ANTHROPIC_WORKSPACE_ID=wrkspc_01VufA4QU6UEkHbr6H8nd4ZK`.
- `EUCLID_SECRET` and `CRON_SECRET` were generated into `.env.local`.
- Resend DNS is verified on Hostinger; one real email was delivered.
- The weekly digest job was run once and produced a real recommendation.
- The Driftnote workspace now carries a **real sandbox Polar subscription**
  (`polar_subscription_id=fa895761…`). It is sandbox money, but the row is
  real, and a production flip should expect to reconcile or clear it.
- A real Discord webhook received three messages on 2026-10-13. If that webhook
  still exists it is a live credential; the URL was shared in chat and should
  be rotated.

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
- **The board's vote is optimistic.** `PublicBoardView.vote` rolls the digits
  before the request has gone anywhere and rolls them back if it fails, so the
  number on screen says nothing about what was stored. A test that reloads on
  the strength of it cancels the very request it is about — which is exactly
  what happened, and why each click in the vote spec waits for its own
  response.

- **The hosted board opens on the roadmap, not on ideas.** `/b/<id>` defaults
  to `roadmap`; `?tab=ideas` or a click is what shows the list and the submit
  panel. Worth knowing before concluding a board is empty.

- **A post row inserted straight into the table has no embedding**, so the
  semantic duplicate pass cannot find it, and because that pass replaces
  whatever the keyword pass put up, a nudge appears and then vanishes. Test
  fixtures that care about duplicates post through `/api/public/post` instead.

- **Nothing in the UI links to `/auth/signout`.** The route exists, is POST
  only, and has no button anywhere — the browser spec posts to it directly.
  Signing out is currently not something a founder can do from the product.

- **`loadEnv` cannot be overridden with an empty value.** `scripts/env.mjs`
  writes a key only `if (!process.env[key])`, and `""` is falsy — so
  `FOO= node scripts/x.mjs` is silently replaced by whatever `.env.local`
  says. Testing a blank-variable code path means running from a directory
  with its own `.env.local`, not a shell prefix. This cost a mutation check
  that appeared to pass.

- **The Supabase client is untyped.** There is no generated `Database` type,
  so new tables need no type regeneration — but also get no compile-time
  checking. Row shapes are asserted at the call site.

- **Billing has exactly one way in.** `apply_subscription` is the only thing
  that can move a workspace between tiers, it is `security definer` and granted
  to `service_role` alone, and `changePlan` refuses outright once
  `billingEnabled()` is true. If you add a second path, the first thing you
  lose is the guarantee that a plan matches a payment.

- **Entitlement reads the product id, never the amount or the status alone.**
  `planForProduct` fails closed on an unknown id — a production id reaching a
  sandbox deployment must not resolve to a tier. `isEntitled` deliberately
  counts `past_due` as entitled, because Polar retries a failed card for days
  and taking a founder's boards offline over an expired card would punish them
  for something their bank usually fixes.

- **Blank env vars are not absent env vars.** A `.env` written as `FOO=` gives
  `""`, not `undefined`. An early version of `planForProduct` matched an empty
  product id against a blank product env and granted Indie to nobody's
  purchase. Every id getter guards for it and a test covers it.

- **Anything comparing a stored timestamp to "now" takes `now` as a
  parameter.** This machine's clock runs about two minutes ahead of the
  database's. `studentVerificationActive` does this, and tolerates a
  verification stamped slightly in the future for the same reason.

- **`FadeRise` forwards unknown props through a `...aria` rest spread.**
  TypeScript does not excess-property-check hyphenated JSX attributes, so an
  undeclared `aria-labelledby` both compiles and works. The sign-in card
  depends on exactly that for its accessible name. If anyone replaces the rest
  spread with explicit props, that name disappears silently — which is why the
  attribute is declared on the prop type even though nothing enforces it.

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
skip rather than fail when nothing is up. Browser tests live in `tests/e2e`
and share that harness's `db` helpers and env contract; unlike the
integration suite they **fail** rather than skip when no database is
configured, because nobody runs `npm run test:e2e` by accident. They run
serially with no retries, for the same reasons: one shared database, and a
spec that passes on the second attempt is one nobody will trust on the
first.

## Decisions the founder has confirmed

**Integrations stay paid-only.** `integrations: false` on free in
`src/lib/plans.ts`. The PRD's pricing table does not mention integrations, so
this started as my assumption; confirmed on 2026-10-13. Slack, Discord, GitHub
and Linear are an Indie/Pro feature — the most felt one for an audience that
lives in chat, and so a concrete reason to upgrade.

**Chat is not a v1 headline.** The v1 story is widget -> board -> Build Prompt
-> MCP -> shipped, which needs no third-party setup at all. Slack and Discord
stay built but unpromoted: discoverable in `/install#integrations`, not in
onboarding.

Worth being clear about what the MCP server already is, because it is easy to
look at the board and think a tracker is still missing. It is not: `list_requests`,
`get_request`, `get_build_prompt` and `mark_shipped`, scoped to one board by a
hashed `euc_` key, is the "our own tracker a coding agent can drive" idea,
already shipped as P2.

The gap chat fills that MCP does not is **push**. MCP is pull — an agent asks
when it happens to run. Nothing currently tells a founder that feedback
arrived. If that becomes a problem before chat is promoted, the cheap answer is
email: `email_outbox` and `sendQueuedEmails` already exist, so it is a job
rather than a new integration surface.
