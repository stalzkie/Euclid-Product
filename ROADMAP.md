# In flight

Written 2026-10-19. `HANDOFF.md` says what state the product is in;
`SESSION-2026-10-13.md` is the log of the day Polar went to production. This
file is narrower: the three things started on 2026-10-19 and not yet finished,
and what is left of each.

Tick a box when the thing behind it has actually run, not when the code is
written. Half of what cost time in this repo was something that was built,
looked finished, and had never once executed — the integration outbox, the
student verification email, the `load` rate-limit bucket.

---

## 1 · Partner promo — "4 months for the price of 3"

Subscribe to Indie monthly through the promo link and get 25% off for four
months ($9 x 4 = $36 = three months at list), plus a free month of Bernn Pro
delivered as a single-use code.

**Why 25% over four months rather than three paid months and a free one:**
Polar's subscription intervals are `day | week | month | year` and a repeating
discount applies the same percentage every period, so the literal mechanic is
not expressible. Same money, same promise, in the shape Polar can bill — and
the subscription keeps renewing at $12 afterwards instead of ending.

### Done

- [x] `0025_partner_promo.sql` — `partner_codes` pool, `partner_grants`,
      `claim_partner_code`, `fill_partner_grants`, `partner_pool_status`.
      **Applied to production** and probed: pool status answers
      `{available: 0, owed: 0}`, `claim_partner_code` runs its whole body
      before failing the workspace foreign key.
- [x] `promoDiscountId`, `promoEligible`, three-way `discountForCheckout`
      (student > indie3 > launch) in `src/lib/polar.ts`.
- [x] `?promo=indie3` on the checkout route, re-derived server-side so
      `?tier=pro&promo=indie3` cannot buy Pro at a discount.
- [x] Webhook grants on the first order with money in it, keyed on
      `metadata.promo`, skipping a trial's $0 invoice.
- [x] Bernn code shown on the billing page, and emailed.
- [x] Low-water warning at 10 codes, loud warning at 0.
- [x] `scripts/import-partner-codes.mjs` — the manual path.
- [x] `topUpPartnerPool()` — automated refill, from the daily cron and from
      `after()` on the webhook when the pool was dry.

### Left

- [ ] **Create the Polar discount.** 25%, `duration: repeating`,
      `duration_in_months: 4`, `products: [Indie Monthly]`, a
      `max_redemptions` cap, no code. Set `POLAR_DISCOUNT_INDIE3`.
- [ ] **Check whether the 7-day trial's $0 invoice eats a discounted month.**
      If it does, use `duration_in_months: 5`. Nothing in Polar's docs answers
      this; it is a 15-minute sandbox test and it changes what the founder
      actually gets.
- [ ] **Bernn: `POST /partners/promo-codes`.** Prompt for their agent was
      written on 2026-10-19. Mirrors `/webhooks/revenuecat`: raw secret in the
      `Authorization` header (**not** `Bearer`-prefixed — both sides must
      agree), 503 while the token is unset, `count` capped at 200, audit
      logged. Must return the `trial_days` it actually wrote.
- [ ] **Bernn: a test for `PromoCodesRepository`.** There is none today. The
      `.is("redeemed_by", null)` guard against two simultaneous redemptions of
      one code has never been exercised.
- [ ] `BERNN_MINT_URL` and `BERNN_MINT_TOKEN` in `.env.local` and on Vercel.
      Bernn's side is **done** as of 2026-10-19: `POST /partners/promo-codes`
      is implemented to the contract, caps a batch at `MAX_MINT_BATCH = 200`
      (the same number as Euclid's `MINT_CAP`, so a request Euclid builds can
      never be refused for size), and returns `trial_days` read back off the
      rows it wrote rather than echoed from the request.
      Verify with `node scripts/partner-pool.mjs`, which probes with
      `count: 0` — Bernn checks the token before parsing the body, so a 400
      proves the token works and nothing was minted.
- [x] **Chain exercised end to end on 2026-10-19**, no money spent. Probe →
      token accepted, nothing minted. Top-up → 50 codes minted at
      `api.bernn.tech`, imported with `trial_days: 30` read back from Bernn.
      Second top-up → `minted: 0`, short-circuits before calling Bernn.
      Control order without `metadata.promo` → no grant. Promo order → grant,
      oldest code, email **sent**. Billing page showed the code.
- [x] **`0028` applied and re-tested.** Three webhook deliveries of one order
      now produce exactly one email. The bug it fixed: `claim_partner_code`
      returned the existing code on a replay, so the grant was idempotent and
      the notification was not — two duplicate emails were observed live.
      It now reports `granted`, the way `apply_topup` and
      `grant_referral_commission` already did.
- [x] **Dry-pool path proven**, against a throwaway partner name so the real
      pool was never at risk: empty pool → claim returns null and writes an
      IOU; replay and a second order → still one IOU; fill with nothing →
      `0`, not an error; codes arrive → fill settles the oldest first and
      stamps `filled_at`; filling again consumes nothing.
- [x] **Email rebuilt** — see section 4.

---

## 4 · Transactional email

The first promo-code email landed in Gmail's Promotions tab. That is a signals
problem rather than a styling one, and all four signals were wrong: a subject
leading with "free", a sender with no display name, no Reply-To, and a text-only
body.

### Done

- [x] `0029_email_html.sql` — `email_outbox.html` and `.reply_to`. Also drops
      and recreates `claim_queued_emails`, whose fixed column list would
      otherwise hide the new columns from the drain. `html` is nullable, so
      the magic link stays plain and nothing else had to change.
- [x] `src/lib/emails/shell.ts` — the chrome, ported from `emails/EMAILS.md`
      in the marketing repo rather than invented. Same tokens, same dawn-wash
      hero, same ink button. The odd-looking parts are client rules: tables
      for layout, inline styles, `border-collapse: separate` or WebKit drops
      the radii, no SVG, a zero-width-padded preheader, dark-mode locks so
      hero text does not invert off its own gradient.
- [x] `partner-code.ts` — subject is now **"Your Bernn Pro code"**. "Free" is
      one of the clearer signals a classifier has and was doing no work: the
      reader has already bought the thing that earned it.
- [x] Deliberately **no unsubscribe and no `List-Unsubscribe`**. Those are
      bulk signals, and on a receipt they would both invite the Promotions
      tab and offer to unsubscribe someone from their own purchase.
- [x] `deliver()` sends both parts plus Reply-To. Verified live: 11,365 bytes
      of HTML, 520 of text, code present in both, under Gmail's 102 KB clip.

### Left

- [ ] **Set the sender env vars.** `EMAIL_FROM` is still a bare `business@`
      with no display name, which is a Promotions signal on its own.
      `EMAIL_REPLY_TO` is unset; `EMAIL_SIGN_OFF` defaults to
      "Stal from Euclid".
- [ ] **Confirm it reaches Primary, not Promotions.** Only receiving it can
      answer that, and the test send went to dstalingrad@gmail.com.
- [ ] The other three emails — magic link, student verification, trial
      reminder — are still text-only. The magic link should stay that way.
- [ ] SPF, DKIM and DMARC on the sending domain, per `EMAILS.md` §3.
- [ ] Later: `GET /partners/promo-codes/status`. Bernn's `promo_codes` already
      carries `redeemed_by`, so it knows how many issued codes were actually
      used — the number that says whether the Bernn half is worth running.
      Feeds panel 3 below.

---

## 2 · Setup checklist

A founder's first session ends at the install screen and then stops guiding
them. The steps that matter afterwards — lock the allow-list, get the first
post, generate a Build Prompt — are discoverable only by wandering.

Nearly every step is already derivable from state the app holds, so this is a
read plus one column, not a new subsystem:

| Step | Derived from |
|---|---|
| Describe your app | `project_profiles.stack`, `workspaces.app_url` |
| Install the widget | `boards.installed_at` (0024) |
| Lock your allowed domains | `boards.allowed_domains` |
| Get your first feedback | `posts` count |
| Generate a Build Prompt | `build_prompts` count |
| Ship something | `changelog_entries` count |

### Done

- [x] `0026_setup_checklist.sql` — `workspaces.setup_dismissed_at`.
- [x] `src/lib/setup.ts` — `setupSteps`, `setupProgress`, `showSetup`, pure.
- [x] `getSetupFacts` for the three counts the context does not already carry.
- [x] Card on the dashboard home, hidden once every step is done or dismissed.
- [x] 13 tests, including the ordering (install before allow-list) and that a
      post through the hosted board counts without an install.

- [x] **`0026` applied**, and the checklist rendered against the real
      workspace: "2 of 6 done", profile and domains struck through, install
      highlighted as next.
- [x] The home page used to say "install the widget" three times once the
      checklist landed — in the checklist, in the right-rail "Finish setup"
      card, and in the empty state. The rail card now only shows when the
      checklist does not. One of them is help; three is nagging.

### Left

- [ ] Nothing. Watch whether founders actually dismiss it early — that is the
      signal it is the wrong length.

---

## 3 · Admin dashboard

Owner-only `/admin`, scoped by an `ADMIN_EMAILS` allow-list.

Decided 2026-10-19: full build — ops, error tracking and funnels — rather than
leaning on Sentry and PostHog's free tiers. **The trade being accepted:** the
ops panels are the part no off-the-shelf tool can give, because nothing else
knows what `email_outbox` or `credit_topups` mean. Error grouping and funnel
analysis are the parts those tools do better than a first version of this
will, and the reason to build them anyway is one place and one bill.

### Panels

1. **Queues** — `email_outbox` and `integration_outbox`: queued, failing,
   oldest unsent, last error. These already carry `attempts`, `deliver_after`
   and `last_error` from `0015_email_retry`, and nothing reads them back.
2. **Billing** — active and trialing subscriptions, trials ending inside 48h,
   `past_due`, top-ups and refunds, referral commissions net of reversals.
3. **Partner pool** — available, owed, redeemed once Bernn exposes it.
4. **AI spend** — prompts and chat credits used against allowance per
   workspace, and purchased balances. The numbers that decide whether a plan's
   ceiling is still the right one.
5. **Boards** — created but never installed (`installed_at is null`), and
   boards with an empty allow-list.
6. **Errors** — captured server-side, grouped by message and route.
7. **Funnel** — signup → onboarding → install → first post → paid.

### Done

- [x] `0027_error_events.sql` — `error_events` keyed on a fingerprint so an
      occurrence is an upsert, `record_error`, `prune_error_events`.
- [x] `/admin` with the `ADMIN_EMAILS` gate. 404s rather than 403s, and
      admits nobody when unset — including in development.
- [x] Panels 1–6: queues, billing, partner pool, boards, AI usage, errors.
- [x] `src/instrumentation.ts` → `onRequestError`, so uncaught errors in route
      handlers, server components and server actions are all captured. A
      try/catch per route would only ever record what somebody anticipated.
- [x] Fingerprinting that normalises ids, uuids, numbers and quoted values,
      with tests holding the grouping both ways.
- [x] Resolve button. A fault that recurs reopens itself, which is what makes
      resolving optimistically safe.
- [x] Error pruning on the cron — resolved only.

- [x] **`0027` applied** and `record_error` verified: two calls give one row
      with `count: 2` and `first_seen` preserved; pruning skips unresolved
      rows.
- [x] **Panel 7, the funnel — and no `0028` was needed.** Every step is
      already a timestamp or the existence of a row, so it is derived rather
      than captured. No migration, no capture, nothing to keep in sync, and
      **retroactive**: it describes every workspace that has ever existed
      instead of only those created after instrumentation shipped. What it
      gives up is arbitrary events ("how many opened the designer"); when that
      question actually comes up, that is the moment to add the table.
- [x] `/admin` rendered against real data. **It caught its own first bug**: a
      `ReferenceError` from the checklist work appeared in the errors panel,
      captured live by `onRequestError`, within a minute of the page existing.

### Found by looking at it, and fixed

- [x] **Fingerprints included Next's `?_rsc=<random>`**, so the same fault on
      the same page would have been a new row every time — the exact failure
      the fingerprint exists to prevent. `normaliseRoute` drops the query
      string.
- [x] **The funnel reported "Paid 200%"**, because stages were counted
      independently and the seeded workspace is on a paid plan without ever
      having finished onboarding. `funnelCounts` is cumulative, so a step can
      never exceed the one above it, and a test pins that.

### Left

- [ ] Set `ADMIN_EMAILS` in production. Until then `/admin` 404s for everyone,
      which is the intended default.
- [ ] Panel 3 gains "redeemed" once Bernn exposes it — see section 1.

---

## Carried over, not started

From the production review of 2026-10-19. None of these are in flight.

- [ ] **`main` is ahead** and none of 2026-10-19's work is committed.
- [ ] **Integration outbox has never run end to end.**
      `enqueueIntegrationEvent` → `integration_outbox` →
      `deliverIntegrationEvents` is unexercised against a real endpoint; only
      `postToWebhook` has been called directly. **Slack has never received
      anything** and its payload shape differs from Discord's.
- [ ] **`deliver_after` is computed on the app's clock** and compared against
      the database's. The PC's two-minute skew was corrected on 2026-10-19 so
      this is latent rather than active; `now() + interval` in SQL removes it.
- [ ] **`README.md` is stale** — still says billing does not charge and that
      the integrations are placeholders.
- [ ] **`http://localhost:3000/**` is not in Supabase's redirect allow-list**,
      so `generate_link` silently substitutes the production origin. This will
      bite the e2e suite.
- [ ] **The e2e suite stamps `installed_at`** on any board it drives with a
      non-loopback Origin, because it runs against the production database.
- [ ] **`/api/board/installed` is fixed but the `load` bucket is still dead.**
      Nothing writes it; the route no longer reads it. Nothing to do unless
      something else wants that signal.
