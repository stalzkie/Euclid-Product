# Where this stands

Written 2026-10-12, updated 2026-10-20. Read this first in a new session;
`README.md` explains how the product works, this explains what state it is in,
and `ROADMAP.md` tracks what is in flight.

**2026-10-19 in one paragraph.** Nine migrations, `0021` through `0029`, all
applied to production. The guardrails pass fixed three real holes: AI usage
was metered with a read-compute-write that let concurrent generations
overwrite each other's increments, the rate limiter counted before it
inserted and swept the whole table on every vote, and `Origin: http://localhost`
skipped the domain allow-list from anywhere. Public rate limits gained a
hashed-IP bucket, so clearing cookies is no longer a reset. The 4-for-3
promotion is built end to end and exercised without spending anything. There
is a setup checklist on the dashboard home and an operator page at `/admin`
with queues, billing, AI usage, a derived funnel and grouped errors. Email can
carry an HTML part.

The three things most worth knowing from that day, because each was found by
looking at live data rather than by reading code:

- The referral panel's signup count was structurally zero — it counted through
  RLS, which hides exactly the rows it needed. Fixed in `0021`.
- `/admin` caught its own first bug within a minute of existing, and the first
  error it stored revealed that fingerprints included Next's random `?_rsc=`
  parameter, which would have made every occurrence its own row.
- The promo's *grant* was idempotent and its *email* was not, so Polar's three
  deliveries sent three copies. Fixed in `0028`.

**2026-10-20: configuration landed, and it is live.** The promotion's Polar
discount exists — `Launch 4-for-3`,
`35e92fad-7d90-41dc-93eb-05b08f77aab0`, 25% repeating over 4 months on Indie
Monthly, capped at 50 redemptions and 1 per customer, codeless like the other
two. `POLAR_DISCOUNT_INDIE3`, the three e-mail sender variables and
`ADMIN_EMAILS` are set in `.env.local` and on Vercel production;
`http://localhost:3000/**` is in Supabase's redirect allow-list; and
**production has been deployed**, so all of it is in effect rather than
merely configured.

Each was checked by its effect, not by the variable being present:

- **The discount prices correctly.** A live checkout quote returns Indie
  Monthly at `$12.00` list and `$9.00` with the promo, a `-$3.00` line.
  Nothing was charged — a checkout session is a quote until someone pays it.
- **`/admin` loads** instead of 404ing, and every panel answers against real
  data. The funnel is cumulative, so the old "Paid 200%" cannot recur.
  **Open errors: none** after the deploy, which is the result worth having
  from the two code changes below going out.
- **The redirect wildcard is honoured.** `generate_link` returns
  `redirect_to` unchanged for paths the old exact entry never covered.

The e-mail sender variables are the one thing **not** confirmed by effect:
that needs an actual send. See "What is left".

The open question about the trial is closed, and the answer was free. A 7-day
trial does **not** consume one of the four discounted months, so four is the
right number — Polar leaves `discount_applied_at` null for a trialing
checkout and stamps it at the first *paid* period instead. This came from
reading Polar's source, which is both cheaper and more certain than the
sandbox purchase the roadmap had budgeted for; `ROADMAP.md` §1 cites the
lines.

**Two faults fixed and one accusation withdrawn, 2026-10-20.**

- **`0030_retry_on_the_db_clock.sql`.** `deliver_after` was written on the
  app's clock and compared against the database's. Ahead is harmless; behind
  is not — a server trailing the database computes a retry that is already
  due, so the backoff does nothing and a magic link's five attempts are spent
  in however long five requests take. `fail_queued_email` and
  `fail_integration_delivery` now take a delay in seconds and do
  `now() + make_interval(...)` themselves. `retryAfter` is deleted rather
  than deprecated: it was correct on any machine whose clock happened to
  agree, which is how it survived the run that measured it.
- **The webhook host allow-list now runs where the request is made**, not
  only where a founder types the URL. The value is read back out of a row
  much later and turned into a server-side POST, and the list exists because
  that reaches cloud metadata endpoints. "Only one writer" holds until a
  backfill makes it false.
- **The e2e suite does not stamp `installed_at`**, contrary to what
  `ROADMAP.md` claimed. `widget.spec.ts` drives a host page Next serves from
  the app itself, so the Origin is always loopback or our own host, and
  `countsAsInstall` already refuses both.

The trial-reminder and student-verification e-mails gained HTML parts. The
magic link and the student *review* note deliberately did not — see
`ROADMAP.md` §4 for why each.

**Test count is now 597 unit across 31 files**, plus 71 integration and 21
Playwright specs, all run green on 2026-10-20 against the real database.

Repo: https://github.com/stalzkie/Euclid-Product (public, `main`)

**2026-10-22: `/admin` became an operator console.** It was one page with six
panels; it is now ten tabs with no sidebar, and the thing it is built around
is that **every row names a person**. The address of a founder lives in
`auth.users` and needs the auth admin API rather than a select, so
`admin-data.ts` fetches it alongside the tables; a visitor's address is
`end_users.email` where the board asks for one. The tabs: Overview (MRR,
trends, the funnel with the addresses that stopped at each step), People
(logins and visitors, searchable, each with a profile page), Workspaces,
Events, Retention, Boards, Billing, Mail, Errors.

Shape, because it is the part worth keeping: `admin-data.ts` reads every table
once per request, `admin-model.ts` derives every panel from that as **pure
functions**, and `admin-console.ts` memoises the pair. One idea carries the
lot — *one event stream, many panels*. `deriveEvents` reads state as a
timeline (a post is an event, a vote is an event, a top-up is an event) and
trends, retention, stickiness, the feed and every "last seen" column are
slices of that one list. Nothing is captured at a call site, so the stream is
complete back to the first row ever written and cannot drift from the tables
it describes. 54 unit tests cover the derivations; six read-only integration
tests cover them against the live database.

**2026-10-22, second half: captured events.** The note under the old funnel
said arbitrary events — "how many people opened the designer" — would wait
until the question came up. It came up. `0032_analytics_events.sql` is the
answer and it is deliberately the smallest table that works: screens opened,
onboarding steps abandoned, and intent that leaves no row (the install snippet
copied, the upgrade button clicked). Nothing derivable is captured —
`prompt.copied`, `designer.saved` and `install.doctor_run` were each written
and then cut, because the first two are already rows and the third would have
measured a polling effect rather than a person.

**`0032` is applied, and was checked by effect rather than by presence.**
`scripts/check-db.mjs` reports 23/23 tables and 9/9 functions; beyond that, a
row inserted with no `source` and no timestamp came back stamped
`dashboard` and dated by the database, a name without a dot was refused with
`23514`, so was a `source` outside the four legal values, and
`prune_analytics_events(36500)` ran and removed nothing. The probe row was
deleted, so the table starts empty.

The console still tells "not migrated" apart from "could not read" — a slice
carries `missing` separately from `error` — which is what the next migration
will land into. An alarm for something the operator is about to do themselves
trains them to ignore alarms.

How it is wired, and the part worth not undoing: the browser sends a name, a
path and some properties. It does **not** send who it is. The user comes from
the session, the workspace and board are read back under RLS, and the database
stamps the time — the same argument `0030` made about the retry clock. Names
are an allow-list (`src/lib/analytics/events.ts`) with a check constraint
under it; properties are flat scalars only, ten keys, 120 characters, and
anything shaped like an address is dropped; paths are stored as routes, so
`/posts/42?from=home` becomes `/posts/:n` and no token rides in on a query
string. Capture needs a session, so nothing before signup is recorded.

The Behaviour tab is where it is read, and two of its panels are the reason
the table exists at all: *copied the install snippet, never installed* and
*clicked upgrade, never subscribed*, both with addresses. A general analytics
tool can count the click and a database can count the subscription; only
something holding both can hand over the list of people who tried and did not
arrive.

**The bug that console found in itself, on its first run against real data.**
Reading a table with `.limit(20000)` returned exactly 1 000 of the 1 085 rows
in `votes`: PostgREST applies its own `db-max-rows` *after* the limit. Every
total was 85 short and the `truncated` flag that exists to catch precisely
that said nothing, because 1 000 is not 20 000. `read()` now pages with
`.range()` and decides truncation by comparing what it got against the exact
count. Two consequences worth remembering before writing another admin query:
**no read of a whole table can trust `.limit()`**, and paging needs a unique
column in the `ORDER BY` — the seeded votes share a `created_at` to the
microsecond, and tied rows may come back in a different order per page, which
duplicates some rows and drops others.

## Current state

Everything in the PRD is built, plus billing and student verification, which
the PRD did not specify. **The app is live at `https://app.euclidhq.com`.**

```
npm run verify            # typecheck + lint + 704 unit tests
npm run test:integration  # 77 tests, needs the app running
npm run test:e2e          # 25 browser tests, needs the app running
npx next build            # production build
```

**704 unit tests across 34 files** and the production build, both green on
2026-10-22, lint clean with zero warnings. The integration suite is **77
tests across 7 files** and the browser suite **25 specs across 6 files**; of
those, `tests/integration/admin-console.test.ts` was run on 2026-10-22 and the
rest were last run in full on 2026-10-20. `tests/e2e/analytics.spec.ts` skips
itself until `0032` is applied.

The integration and browser suites need a *built* app — `npx next build &&
npm run start`, not `next dev` — and with no Docker on this machine they run
against the production Supabase project, creating and destroying their own
fixtures. Both print their target before starting.

**Thirty-two migrations, all applied to the live database**, `0032` as of
2026-10-22 — confirmed by `node scripts/check-db.mjs` (23/23 tables, 9/9
functions) and by the constraint checks described in the 2026-10-22 note
above. `0011_billing`,
`0012_student` and `0013_workspace_bootstrap` were confirmed present in
production by querying `pg_proc` for `apply_subscription`, `verify_student`
and `create_workspace`. `0014_definer_search_path` was confirmed by checking
that `gen_public_id` no longer calls `gen_random_bytes`, and
`0015_email_retry` by the three new `email_outbox` columns and
`claim_queued_emails`. (This section said "thirteen" while 0014 was already
on disk and live; counts drift, so check rather than trust the number.)

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
| Billing through Polar: checkout, portal, webhook | Live in **production** |
| 7-day trial, launch promotion, student rate | Live in **production** |
| 4-for-3 promotion with a Bernn Pro month | Live in **production** |
| Student verification by school email | Built, never run end to end |

**`SESSION-2026-10-13.md`** is the log of the day Polar went to production:
what was done, what is still open, and the traps that cost time. It also
carries the traps from that day. The two missing token scopes it names as
blocking payments were added on 2026-10-15; nothing blocks payments now.

## Start here

**Mostly closed.** The student verification email, the moderation queue, the
JWT identity spec and the token scopes were closed on 2026-10-15; the Polar
flip is done; the integration outbox is exercised everywhere but its success
leg. The live short list is at the top of "What is left" below — this
section is the older, fuller reasoning behind each.

Ordered by what actually blocks a launch. Detail for each is further down.

1. **Polar is on production. This is done.** The flip happened on
   2026-10-15: Polar approved the account, eight products and (now) three
   discounts exist in the production org, `POLAR_SERVER=production`, and a
   real card payment and a real refund have both gone through the webhook.
   `POLAR-PRODUCTION.md` is the current account; `SESSION-2026-10-13.md` is
   the log of the day it moved.

   **`node scripts/polar-preflight.mjs` is still worth running** before
   touching anything billing-shaped, and is green. It asks Polar what the
   configured ids actually are, on whichever server `POLAR_SERVER` names,
   and exits non-zero if the environment could not sell correctly. It
   catches the whole class in one call: a production id read against
   sandbox is a 404, a sandbox token used against production is a 401, and
   — the one nothing else would catch — a monthly and a yearly id swapped
   between slots resolve perfectly well and quietly sell the wrong billing
   period. It also checks that every product sits in one organisation, that
   none is archived or unpriced, that no two slots share an id, that the
   trial matches `POLAR_TRIAL_DAYS`, and that the 4-for-3 discount is
   repeating over four months on Indie Monthly alone rather than merely
   existing.

   It does **not** check product amounts, which is how the yearly price
   discrepancy in "What is left" item 8 went unnoticed.

2. **Exercise the integration outbox's success leg.** Everything around it
   now runs: `tests/integration/integrations.test.ts` was run against the
   real database and a built app on 2026-10-19 and covers
   `enqueueIntegrationEvent` -> `integration_deliveries` ->
   `deliverIntegrationEvents` -> payload -> POST -> failure -> backoff ->
   deactivation. What has never happened is a **2xx from a real webhook**,
   and **Slack has received nothing at all** — its payload is
   `blocks`/mrkdwn where Discord's is `embeds`. Paste a URL into the install
   screen and press "Send a test message".

3. **Send one student verification email.** Same shape of gap: the redeem
   path works in production, the mailing leg has never run. The same send
   would confirm the e-mail sender variables, which are deployed but
   unproven — see the short list under "What is left".

4. **Nothing is waiting on a more frequent cron any more.** Changing
   `/api/jobs/run` to `*/10 * * * *` needs Vercel Pro, and the founder has
   decided against paying for that for now (2026-10-13). The reason it was on
   this list is gone: `0015_email_retry` gave `email_outbox` the retry columns
   the delivery queue already had, so a failed email is retried by whichever
   request next calls `drainAfterResponse` rather than waiting for the
   scheduler. See "Retries no longer depend on the scheduler" below.

**Browser E2E is done** — 14 Playwright specs, in the CI job that already
stands up Supabase. It found two real widget bugs on its first run; see
"Browser tests" below.

## What is left

**0. The short list, as of 2026-10-21.** Everything below this is background
on how each piece got to where it is; these are the things nobody has done.

- **The install doctor is live** as of 2026-10-21 — `0031` applied to
  production, both signals exercised against it. What is *not* done: nothing
  reports a snippet blocked by a Content-Security-Policy, because that request
  never reaches us at all. That one needs the widget script to say so, not the
  server.
- **euclidhq.com still has no promo link.** The app side is done as of
  2026-10-21 — `?promo=indie3` is captured into a cookie that survives the
  sign-up redirect, the billing page offers it, and a production quote prices
  Indie monthly at $9. But the marketing site is a separate project, and
  until a button there points at `app.euclidhq.com/signup?promo=indie3` the
  only way to reach the promotion is to type the URL. See `ROADMAP.md` §1.
- **The waitlist month is live and has been sent.** As of 2026-10-21 the whole
  path is deployed and was walked end to end against production: the Polar
  discount (`Waitlist free month`, `672c3da6-b093-4481-aa0d-60f7a6d3db2b`,
  -100% repeating over one month on Indie Monthly, 25 redemptions, 1 per
  customer, codeless, **ends 2026-11-19T16:00Z**), `POLAR_DISCOUNT_WAITLIST`
  on Vercel production, `?promo=waitlist` captured into a cookie that survives
  the sign-up redirect, the billing page offering it, and a live checkout
  quote pricing Indie Monthly at **$0 due today and $0 after the trial**
  against $12 list. `node scripts/check-waitlist-promo.mjs` re-proves all of
  it in one run, including that a stranger and a `%@%` wildcard are both
  refused the month.

  **All seven waitlist addresses were written to on 2026-10-21** — queued into
  `email_outbox` as `kind = 'waitlist_offer'` and drained through
  `/api/jobs/run`: 7 sent, 0 failed. That kind is also the record of who has
  been written to, which is why `send-waitlist-campaign.mjs` can be re-run and
  does nothing at all. There is no `claimed_at` anywhere, deliberately:
  `waitlist_signups` is the marketing site's table and this app reads it
  without ever writing to it. What bounds redemption is Polar — 25 total, one
  per customer — plus the fact that a workspace already subscribed cannot
  check out again.

  Two things are worth knowing rather than doing. The e-mail's expiry line is
  **computed from the discount's `ends_at`**, not typed, so the copy cannot
  drift from what Polar will honour — and the campaign refuses to send at all
  if the discount has no end date, because that is the one claim in the e-mail
  nothing else can check. And Polar asks for a **payment method** even at $0
  due today; the e-mail does not claim otherwise and must not start to.

- **Send one real e-mail — done, 2026-10-21.** Two real sends through Resend,
  both `200`, to `dstalingrad@gmail.com`: the waitlist offer, which is also
  the first template to go out in the shared chrome. `EMAIL_FROM`,
  `EMAIL_REPLY_TO` and `EMAIL_SIGN_OFF` are therefore confirmed by effect
  rather than by being set. Still open underneath it: **does
  `business@euclidhq.com` actually receive?** Every template signs off
  promising a reply, so a send-only address silently swallows them — reply to
  one of those two e-mails and see whether it lands.
- **Slack has still received nothing**, and the integration outbox's success
  leg — a 2xx from a real webhook — has never run. Everything around it has
  (see `ROADMAP.md`). Paste a webhook URL into the install screen and press
  "Send a test message"; that closes both at once, and Slack's payload is
  `blocks`/mrkdwn where Discord's is `embeds`, so Discord working proves
  nothing about it.
- **The yearly prices on the billing page and in Polar disagree.** See the
  note at the end of this section.
- **SPF, DKIM and DMARC** are not set on the sending domain. Deliberately
  deferred on 2026-10-19: mail reaches Primary without them.
- Two items belong to Bernn's repo, which is not on this machine: a test for
  `PromoCodesRepository`, and `GET /partners/promo-codes/status`.

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

2. **Billing runs on Polar, in production.** Much of what follows was
   written while it was still sandbox and is kept for the traps it records —
   but read it knowing the flip happened on **2026-10-15**, took a real
   payment and a real refund, and `POLAR_SERVER=production` today.
   `POLAR-PRODUCTION.md` is the current account of the production org.

   The code is
   `/api/billing/checkout`, `/api/billing/portal` and `/api/billing/webhook`,
   with `0011_billing.sql` and `src/lib/polar.ts`. Polar is the merchant of
   record; the webhook is the only thing that can move a workspace between
   tiers, and `changePlan` refuses once billing is configured.

   **Applied to production: migration `0011` is live on the Supabase
   project.** The sandbox org — the subject of the paragraphs below — had
   four products, an organisation token that never expires, and a webhook at
   `https://app.euclidhq.com/api/billing/webhook` on format **Raw** and API
   version **2027-01**. The production org now has eight products, three
   discounts and the same webhook settings.

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

   **That swap has happened.** `POLAR_SERVER=production` and all the ids
   moved together, which was the thing that had to be done atomically: they
   are separate accounts, and mismatched ids make every webhook fail closed
   with "Unknown Polar product". `scripts/polar-preflight.mjs` is the check
   for exactly that and is green.

   The note that used to sit here — "the preflight cannot verify the
   discount ids, because the token has no `discounts:read`" — applied to the
   sandbox token. The production one **does** have that scope, so all three
   discounts are checked, and since 2026-10-19 the 4-for-3 one is checked
   for its shape rather than only its existence. What the preflight still
   does not look at is product **amounts**; see item 8 above.

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

   **The JWT identity spec exists** — `tests/e2e/identity.spec.ts`, four
   specs covering the token reaching the frame, a post being attributed, a
   token signed with the wrong secret leaving an anonymous but working
   board, and no `EuclidIdentity` meaning no token. So does
   `moderation.spec.ts`. The whole suite is **21 specs, run green on
   2026-10-19**.

   **Still not covered:** the dashboard server actions have only unit tests
   on their pure logic, and Slack's payload shape is still unexercised end
   to end — that one needs a live webhook rather than a spec. The dashboard
   actions are reachable through the browser suite, so the gap is unit
   coverage of their effects, not of the flows.
   `scripts/widget-e2e.mjs` remains as a manual API harness.

5. **A real Discord webhook has now received messages.** On 2026-10-13 all
   three shapes were delivered to a live webhook and accepted with `204 No
   Content`: the test message, a `post.created`, and a `post.status_changed`.
   The payloads came from `chatPayload` itself rather than being hand-written,
   so this exercised the real builder and the real allow-list.

   **What it did not prove:** the outbox. `sendTestMessage` and the script
   used that day call `postToWebhook` directly, so the queue was not
   involved.

   **Most of that gap closed on 2026-10-19.**
   `tests/integration/integrations.test.ts` runs against the real database
   and a built app and covers `enqueueIntegrationEvent` ->
   `integration_deliveries` -> `deliverIntegrationEvents` -> payload ->
   POST -> failure -> backoff -> deactivation, plus which integrations do
   and do not get queued for an event. What is left is the success leg: a
   **2xx from a real webhook**, which a test suite has no business owning a
   URL for.

   Slack has still never received anything. Its payload is a different shape
   (`blocks` and mrkdwn, not `embeds`), so Discord working says nothing about
   it.

6. **Retries no longer depend on the scheduler.** `email_outbox` had no
   `attempts`, no `deliver_after` and no `last_error`: a row was selected on
   `sent_at is null`, and a failed send was simply left there for the next
   drain. The only thing guaranteed to drain it is the daily cron, and a magic
   link expires an hour after it is created — so a single transient Resend
   failure meant the sign-in could not happen at all, and the retry, when it
   came, carried a dead token.

   `0015_email_retry` adds those three columns and `claim_queued_emails`,
   mirroring `claim_integration_deliveries`. The schedule both queues share
   now lives in `src/lib/retry.ts` — 1, 4, 9 and 16 minutes, chosen so every
   attempt lands inside the magic link's hour, with `tests/unit/retry.test.ts`
   holding that bound.

   Claiming is the other half, and it fixes a bug nobody had noticed:
   `sendQueuedEmails` used a plain select, while `drainAfterResponse` fires on
   every post, magic link and changelog publish. Two overlapping requests could
   pick up the same unsent row and both send it — two sign-in links to one
   person, or a voter told twice that their request shipped. `for update skip
   locked` plus the attempt increment makes a row claimable exactly once.

   Verified against the live database: a queued email with a deliberately bad
   Resend key came back `attempts=1`, unsent, with the 401 recorded, and an
   immediate second drain reported `failed: 0` — it refused to reclaim the row
   because the backoff had not elapsed.

   **Known, and deliberately not fixed:** `deliver_after` is computed with the
   *app server's* clock (`retryAfter` defaults `now` to `new Date()`) while
   `deliver_after <= now()` is evaluated with the *database's*. The proof run
   above measured a 185-second gap where 60 was intended, which is this
   machine's two-minute skew. On a deployed server with NTP the two agree
   closely, and the delivery queue has always worked the same way, so this is
   a bounded inaccuracy rather than a fault — but a server whose clock ran
   *behind* the database's would compute a `deliver_after` already in the past
   and retry without backing off. Computing it in SQL (`now() + interval`)
   would remove the skew entirely, and is the fix if this ever matters.

7. **The moderation queue holds nothing on the real board.** The integration
   test covers the code path; no real post has ever been held for approval.
   The browser suite does cover it — `moderation.spec.ts`, three specs — so
   what is untested is the real board, not the feature.

8. **The billing page and Polar disagree about the yearly prices.** Found on
   2026-10-20 while reconciling the docs, and left alone deliberately,
   because resolving it is a pricing decision rather than a bug fix.

   | Plan | Billing page says | Polar actually charges |
   |---|---|---|
   | Indie yearly | $10/mo billed yearly — **$120/yr** | **$100/yr** |
   | Pro yearly | $24/mo billed yearly — **$288/yr** | **$240/yr** |

   `src/lib/plans.ts` stores `yearly` as the *per-month equivalent* (10 and
   24) and `billing-view.tsx` renders it as "/ mo, billed yearly" under a
   "Yearly · 2 months free" toggle. Two months free off $12 and $29 is
   exactly $120 and $288, so the page is internally consistent — it is the
   Polar products that are cheaper than the page promises, by $20 and $48 a
   year.

   Nobody is overcharged, which is why this is not urgent: every yearly
   customer pays less than they were quoted. But the toggle's "2 months
   free" is wrong in the customer's favour (it is nearer three and a half),
   and the two numbers should not be allowed to drift further apart.

   The PRD does not settle it — it proposes monthly prices only ($12 and
   $29) and never names a yearly one, so there is no authority to defer to.
   Either lower `plans.ts` to 8.33 and 20, or raise the two Polar products
   to $120 and $288. `scripts/polar-preflight.mjs` checks the four product
   ids and their intervals but not their amounts, which is why this went
   unnoticed; it could.

## AI cost, and what it is measured at

Everything here was measured on 2026-10-13 and none of it was estimated. The
app had no token logging at all until then, which is why the first answers
about pricing were wrong by up to 7x in both directions.

**The strong model is Sonnet 5, not Opus 5** (`src/lib/ai/client.ts`). $3/$15
against $5/$25, and a true drop-in — same adaptive thinking, same `effort`
surface. Haiku 4.5 is cheaper again but is *not* a drop-in: no adaptive
thinking, and it rejects `effort`. The chat assistant answers out of a loop of
up to twelve reasoning steps, which is exactly what it would lose.

**Caching is on in two places and nowhere else**, because nowhere else has a
prefix that is ever re-sent:

- `assistant.ts`, two breakpoints — one on the system block (covers the tool
  definitions too, stable across every founder) and one on the question
  (covers history, stable across all steps of one answer).
- `build-prompt.ts`, one breakpoint between the stable context and the
  refinement tail, so refining a brief does not re-pay for the post, profile,
  rules file and repo listing.

The other call sites are single requests with ~270-token system prompts —
under the ~1024-token minimum a cacheable prefix needs, so a breakpoint there
would cache nothing while looking like it did. That is the trap worth
remembering: caching too little is silent.

Measured per-unit costs:

| | Cost | How |
|---|---|---|
| Chat question | $0.071 | 7 steps, 1,935-token prefix cached each step |
| Build Prompt, cold | $0.039 | writes the cache |
| Build Prompt, warm | $0.033 | pays for *two* input tokens |
| Build Prompt, refinement | $0.031 | reads 1,811 from cache |

**Output is now ~85% of the cost.** Caching has effectively removed the input
side, so further savings come from shorter outputs — `effort: "low"` on
routine calls, tighter `max_tokens` — not from more caching.

Both `askEuclid` and `generateDraft` log a usage line (`[euclid] ask …`,
`[euclid] build-prompt …`). Those are the only record of what anything costs;
a `cache_read` of zero across a multi-step answer means a breakpoint has
silently stopped matching.

### What the plans cost at full allowance

| | Cost | Net of fees | Margin |
|---|---|---|---|
| Indie $9.99 | $1.71 | $9.19 | 81% |
| Pro $19.99, 500 credits | $15.35 | $18.79 | 18% |

Indie is the healthiest plan in the product and nothing about it needs
attention. Pro is thin, and the reason has flipped: **Build Prompts are now
the bigger half** ($10.29 of the $17.37, against chat's $7.08). If Pro needs
margin, 300 Build Prompts is the number to look at, not the chat credits:
they are $10.29 of the $15.35, against chat's $5.06.

`chatCredits` went 3000 -> 500 on 2026-10-13. A credit is one agent step and a
real question takes four to seven, so 500 is roughly 85 questions. Running out
is no longer a dead end: see Top-ups below.

## Top-ups

One-time purchases that extend an allowance without moving the plan.
`0016_topups`, `/api/billing/topup`, `TOPUP_PACKS` in `src/lib/polar.ts`.

**This is the second path into billing that this document warns about**, so it
is built to the same rules as the first: the pack is derived from the Polar
product id alone and an unknown id grants nothing, the workspace comes from
the session and never from the request, and the write goes through a
`security definer` function granted to `service_role` only.

The one thing it has that subscriptions do not is an **idempotency key**. A
plan is a state, so applying it three times leaves the same plan — which is
why the three events Polar sent for one subscription change did no harm. A
top-up is an increment, and the same three retries would be three times the
credit. `apply_topup` keys on the Polar order id and returns whether it
granted or recognised a replay. Proven against the live database: a second
apply with the same order id returned `false` and did not move the balance.

Four design decisions, all the founder's, made on 2026-10-13:

- **Separate packs** for Build Prompts and chat credits, not a combined one.
- **Purchased balance never expires.** `roll_usage_period` only ever touched
  the two `_used` columns, so carry-over needed no change at all.
- **Indie cannot buy chat credits.** It has `chatAssistant: false`, so they
  would be unspendable, and Ask Euclid is the reason to upgrade. Enforced on
  the server in the topup route, not only hidden in the UI.
- **A balance that depletes, not a bigger limit.** `spendAllowance` spends the
  monthly allowance first — it is the one that expires — and draws on the
  purchased balance only once that is gone. Modelled as "+250 to the monthly
  allowance" a top-up would silently re-grant itself every month forever;
  `tests/unit/allowance.test.ts` has four tests that fail if anyone does that.

**The four packs exist in sandbox and the whole chain is proven.** They were
created through the API — the organisation token turned out to have
`products:write`, which a probe showed by answering 422 (bad body) rather than
403 (no scope). All four are **one-time** products; `polar-preflight.mjs`
refuses a recurring one, because the webhook grants on `order.paid` and a
subscription renewal produces that event too, so a pack created as a
subscription would re-grant itself every month.

| Pack | Price | Env |
|---|---|---|
| 50 Build Prompts | $5 | `POLAR_TOPUP_PROMPTS_50` |
| 200 Build Prompts | $15 | `POLAR_TOPUP_PROMPTS_200` |
| 250 chat credits | $5 | `POLAR_TOPUP_CREDITS_250` |
| 1,000 chat credits | $15 | `POLAR_TOPUP_CREDITS_1000` |

On 2026-10-13 a real sandbox card payment went through the deployed code end
to end: checkout -> payment -> `order.paid` -> the production webhook ->
`apply_topup` -> `extra_prompts` 0 to 50, with the Polar order id in
`credit_topups`. It landed within five seconds. The test workspace and user
were deleted afterwards.

**The first attempt granted nothing, and the reason is the thing to remember.**
The Polar webhook endpoint subscribes to a list of event types, and it had
only the eleven `subscription.*` events ticked. `order.paid` was never sent —
no request reached the server at all, so there was nothing to debug in the
app. `order.paid` was then ticked on the sandbox endpoint. **Both `order.paid`
and `order.refunded` are ticked on the production endpoint too** — all
thirteen events are, as of 2026-10-15, and a real purchase and refund have
since gone through both. Keep the failure mode in mind for any endpoint
anyone creates later, because it is invisible from the code: the app looks
correct, the checkout completes, the customer is charged, and nothing
happens.

Setting them is fiddlier than it looks. A synthetic `.click()` on the toggle
flips `aria-checked` and the hidden input and still does not reach the form
state, so Save writes the old set back — the same synthetic-input problem this
document already records for the discount form. It takes a real click at the
checkbox's on-screen position, read off a screenshot rather than computed from
`getBoundingClientRect`, which disagreed with where the element actually was. The token cannot read webhook settings either
(`webhooks:read` is missing like `discounts:read` and `orders:read`), so this
can only be checked in the dashboard.

**Refunds give the balance back.** `0017_topup_refunds` adds `refunded_at` to
the ledger and `reverse_topup`, and the webhook handles `order.refunded`.
`refunded_at` is both the record and the idempotency key, the mirror of the
unique `polar_order_id` on the way in — Polar retries until it gets a 2xx, so
a refund arriving twice would otherwise take the balance down by double.

**A refund floors the balance at zero rather than going negative.** Someone
who bought 50 prompts, used 30 and then refunded keeps the 30 they have
already spent — there is no un-generating those briefs — and loses the 20 they
had left. Negative would hold their *next* purchase hostage to the old one,
which is a worse answer to a situation they are entitled to be in.
`spendAllowance` floors for the same reason. Partial refunds are treated as
full reversals: a pack is indivisible, and erring towards the customer's money
is the right way round.

Proven against the live database: grant 50 -> reverse -> 0; reverse again
returns false and leaves it at 0; an unknown order returns false; and the
partially-spent case floors at 0 instead of -30.

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

- **Signing out is a form, not a link.** `/auth/signout` is POST only — a GET
  that destroys a session can be triggered by any image tag on any page — so
  the sidebar posts a real form to it, which also means it works with no
  client JavaScript. The route existed from the beginning with nothing linking
  to it, so until 2026-10-13 a founder could not sign out of the product at
  all.

- **`loadEnv` cannot be overridden with an empty value.** `scripts/env.mjs`
  writes a key only `if (!process.env[key])`, and `""` is falsy — so
  `FOO= node scripts/x.mjs` is silently replaced by whatever `.env.local`
  says. Testing a blank-variable code path means running from a directory
  with its own `.env.local`, not a shell prefix. This cost a mutation check
  that appeared to pass.

- **Both outboxes share one retry schedule** (`src/lib/retry.ts`) and one
  claim pattern. They are drained by the same `drainAfterResponse`, so two
  different ideas of how long to keep trying would be two answers to one
  question. `RETRY_MAX_ATTEMPTS` is mirrored as `attempts < 5` inside both
  claim functions in SQL; a unit test pins the constant so the two cannot
  drift without something saying so.

- **An off-origin redirect needs a real navigation, not a `Link`.** The
  billing routes answer with a redirect to Polar, and Next's client router
  cannot follow one off-origin — it has to be the browser making the request,
  which is why the upgrade and portal buttons call
  `window.location.assign`. Routed through `Link` the button silently does
  nothing, which is exactly how the top-up buttons first shipped.

- **Polar rejects reserved e-mail domains.** The browser suite's fixtures use
  `@euclid.test`, which Supabase auth accepts and Polar refuses outright —
  "a special-use or reserved name". The address reaches Polar as
  `customer_email` straight from the signed-in founder, so anything that
  touches a real checkout needs a normal domain.

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
