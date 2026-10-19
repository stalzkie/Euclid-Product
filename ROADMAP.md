# In flight

Written 2026-10-19, updated 2026-10-20. `HANDOFF.md` says what state the
product is in; `SESSION-2026-10-13.md` is the log of the day Polar went to
production. This file is narrower: the things started on 2026-10-19 and what
is left of each.

**Most of this is now done.** The four sections below are kept because the
reasoning in them is still the reasoning behind what shipped — not because
they are outstanding. What actually remains is the short list at the top of
`HANDOFF.md` §"What is left".

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

- [x] **Verified live on 2026-10-20.** A checkout quote against the
      production API returns Indie Monthly at `$12.00` list and `$9.00` with
      the promo, a `-$3.00` line — exactly 25%, nothing charged, since a
      checkout session is a quote until someone pays it.
- [x] **Polar discount created, 2026-10-19.** `Launch 4-for-3`,
      `35e92fad-7d90-41dc-93eb-05b08f77aab0` — 25%, `duration: repeating`,
      `duration_in_months: 4`, products `[Euclid Indie - Monthly]`,
      `max_redemptions: 50`, `max_redemptions_per_customer: 1`, no code.
      Read back off the API rather than trusted from the dashboard toast.
      `POLAR_DISCOUNT_INDIE3` set in `.env.local` and on Vercel production.

      The cap is 50 because that is the size of the Bernn pool already minted,
      so the two halves of the promise can never disagree: every discount that
      can be redeemed has a Bernn code waiting behind it. Worst case the
      promotion forgoes 50 x $3 x 4 = $600.

- [x] **The trial does not eat a discounted month**, so 4 is right and 5 would
      have overpaid by a month. Answered from Polar's source rather than by
      spending anything, which is both cheaper and more certain than the
      sandbox test this item budgeted for:

      - `subscription/service.py:1148` — on a checkout **with** a trial,
        `discount_applied_at` is deliberately left `None`. The comment is
        explicit: "For non-trial checkouts with a discount, the discount is
        applied immediately (the first payment at checkout includes the
        discount)."
      - At trial conversion (`:1318-1329`) `current_period_start` advances to
        the trial-end date **first**, and only then does
        `_clear_expired_discount` stamp
        `discount_applied_at = current_period_start` — the start of the first
        *paid* period.
      - `Discount.is_repetition_expired` counts calendar months from there
        (`end_at = discount_applied_at + relativedelta(months=n - 1)`).

      So the anchor is the first paid invoice and the $0 trial invoice is not
      one of the four. The meter clock is also left unarmed during a trial
      (`initialize_meter_period(None if trial_end ...)`), so the meter-boundary
      call at `:1620` cannot stamp it early either.
- [x] **Bernn: `POST /partners/promo-codes`.** Prompt for their agent was
      written on 2026-10-19, and the endpoint shipped the same day — see the
      `BERNN_MINT_*` item below, where the chain was exercised end to end.
      Mirrors `/webhooks/revenuecat`: raw secret in the `Authorization`
      header (**not** `Bearer`-prefixed — both sides must agree), 503 while
      the token is unset, `count` capped at 200, audit logged. Returns the
      `trial_days` it actually wrote.
- [ ] **Bernn: a test for `PromoCodesRepository`.** There is none today. The
      `.is("redeemed_by", null)` guard against two simultaneous redemptions of
      one code has never been exercised.
- [x] `BERNN_MINT_URL` and `BERNN_MINT_TOKEN` set in `.env.local` and on Vercel
      production.
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

- [x] **Sender env vars set, 2026-10-19**, in `.env.local` and on Vercel
      production: `EMAIL_FROM=Stal from Euclid <business@euclidhq.com>`
      (was a bare address, a Promotions signal on its own),
      `EMAIL_REPLY_TO=business@euclidhq.com`, and `EMAIL_SIGN_OFF` pinned
      explicitly to "Stal from Euclid" rather than left to the fallback, so
      the sender's display name and the signature agree.

      **Reply-To assumes `business@euclidhq.com` actually receives.** The
      sign-off promises a reply, so if that address is send-only in Resend
      this points replies into nothing — change it to an inbox that is read.
- [x] **It lands in Primary, not Promotions.** Confirmed by the founder on
      2026-10-19.
- [x] **The student verification and trial-reminder emails now carry HTML**,
      through the same shell as the partner code, with the text part beside
      rather than beneath it.

      Two deliberately stay plain. The **magic link**, because a sign-in link
      is the most impersonated mail a product sends and plain text is both
      harder to fake convincingly and easier for a careful reader to check.
      And the **student *review* note** — `requestStudentVerification` sends
      two different emails, and that one goes to `STUDENT_REVIEW_EMAIL`
      carrying a workspace id, a claimed address and a link to approve.
      Branding an operator's worklist would make it look like marketing and
      bury the two facts it exists to carry.

      `signOff` and `replyTo` moved out of `server/partner.ts` to
      `lib/emails/sender.ts`; three senders needed the same two answers and
      three copies drift into one email signed by a person and another by
      nobody.
- [ ] SPF, DKIM and DMARC on the sending domain, per `EMAILS.md` §3.
      **Deliberately deferred 2026-10-19** — mail reaches Primary without it.
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

- [x] **`ADMIN_EMAILS` set, 2026-10-19** — `dstalingrad@gmail.com` and
      `fantasy.grimdark@gmail.com`, in `.env.local` and on Vercel production.
      Both founder accounts are allow-listed rather than only the active one,
      because the gate matches on the session's email and signing in with the
      other would 404 with nothing to explain why.
      **Deployed and confirmed on 2026-10-20**: `/admin` loads, every panel
      answers against real data, the funnel reads cumulatively so the old
      "Paid 200%" cannot recur, and the errors panel is empty.
- [ ] Panel 3 gains "redeemed" once Bernn exposes it — see section 1.

---

## Carried over, not started

From the production review of 2026-10-19. None of these are in flight.

- [x] **Committed and pushed.** `main` matches `origin/main`, tree clean.
- [~] **Integration outbox: everything but the success leg is now exercised.**
      `tests/integration/integrations.test.ts` was run against the real
      database and the built app on 2026-10-19 — 5 specs, green — covering
      `enqueueIntegrationEvent` → `integration_deliveries` →
      `deliverIntegrationEvents` → payload → POST → failure → backoff →
      deactivation, and who does and does not get queued.

      What is still missing is a **2xx from a real webhook**, which needs a
      live Slack or Discord URL that a test suite has no business owning.
      **Slack has still received nothing**, and its payload is `blocks`/mrkdwn
      where Discord's is `embeds`, so Discord working says nothing about it.
      Paste a webhook URL into the install screen and press "Send a test
      message" — that is the whole remaining check.
- [x] **`deliver_after` is now computed by the database.** `0030` adds
      `fail_queued_email` and `fail_integration_delivery`, which take a delay
      in seconds and do `now() + make_interval(...)` themselves; `retryAfter`
      is deleted rather than deprecated, since it was correct on any machine
      whose clock happened to agree. Applied to production and probed: 60
      seconds on the database's clock where this machine would have written
      ~180, `attempts` untouched, probe row removed by the statement that
      measures it. A mutation-checked source guard fails the moment any file
      assigns `deliver_after` itself again.
- [x] **`README.md` refreshed** in `b009f9d` — billing charges, and the
      integrations are described as wired up.
- [x] **`http://localhost:3000/**` added to Supabase's redirect allow-list**,
      2026-10-19, and **proved** rather than assumed: `generate_link` now
      returns `redirect_to` unchanged for `/auth/land` and for
      `/auth/land?probe=1`, neither of which the pre-existing exact
      `/auth/callback` entry covers. The already-listed `/auth/callback` was
      run as a control first, so a pass could not come from the probe simply
      being wrong — which it was on the first attempt: the raw GoTrue admin
      API takes `redirect_to` at the top level, and nesting it under `options`
      (as the JS client does) sends no redirect at all and silently yields
      the site URL.
- [x] **The e2e suite does not stamp `installed_at`** — this was wrong, and
      the correction is pinned by a test rather than just struck out.
      `widget.spec.ts` drives `/demo/host.html`, which Next serves from the
      app itself, so the Origin is always the app's own: loopback locally,
      and our own host when `TEST_APP_URL` points at a deployment. Both are
      already refused by `countsAsInstall`. There is no third configuration,
      because the host page has nowhere else to be served from.
- [x] **The `load` bucket is gone, confirmed by looking.** A search across
      `src/` and every migration finds one reference: a comment in
      `/api/board/installed` recording why it was dropped. No live code, no
      config entry, no SQL. There was nothing left to remove.
