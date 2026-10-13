# Setting up Polar production

Everything that has to exist in the **production** Polar organisation before
`app.euclidhq.com` can take real money, written out so it can be created by
hand. The sandbox org already has all of it; this is the same thing again in
an account that is a completely separate world — separate products, separate
ids, separate token, separate webhook.

Written 2026-10-13 from the live sandbox objects, so the names, prices and
descriptions below are what is actually configured, not what was intended.

---

## Status, 2026-10-13

Polar has **approved** the account. Since then:

- [x] **Eight products** created in the production org.
- [x] **Two discounts** created — Launch 20% (once, ends Nov 11) and Student
      (50%, forever), both codeless.
- [x] **Webhook endpoint** created at `https://app.euclidhq.com/api/billing/webhook`,
      format raw, **API version 2027-01**, all **13 events** including
      `order.paid` and `order.refunded`.
- [x] All ten ids collected.
- [x] **Environment swapped.** All fourteen variables set in `.env.local` and
      Vercel production, and deployed. `POLAR_SERVER=production`.
- [x] **Preflight green against production**, discounts included — the token
      has `discounts:read`, which sandbox's did not.
- [ ] **Two scopes missing from the token.** It carries `products:read`,
      `discounts:read` and `webhooks:read`, but **not `checkouts:write` or
      `customer_sessions:write`** — so right now `/api/billing/checkout`,
      `/api/billing/topup` and the billing-portal button all answer 502 on the
      live site. Add both to the `Euclid-Production` token
      (Settings → Developers → Update). Nothing else is affected: boards, the
      widget and the dashboard are untouched.
- [ ] The first real purchase, once the scopes are there.

Two things caught while doing it, both of which would have failed silently:

- **A new webhook endpoint defaults to API version `2026-10`**, while the app
  imports `@polar-sh/sdk/2027-01`. Field names differ between versions, so the
  endpoint was patched to `2027-01`. Check this on any endpoint anyone creates
  later; the dashboard does not draw attention to it.
- **The date picker works in local time.** Choosing 11 November stored
  `2026-11-10T16:00:00Z`, because the browser is UTC+8. The launch promotion
  therefore ends about a day earlier than the sandbox one did
  (`2026-11-11T16:00Z`). Immaterial for a promotion, but worth knowing before
  anyone sets a deadline that matters.

---

## 0. Before anything: Polar has to approve the account

As of 2026-10-13 the production org at `polar.sh/dashboard/euclid` shows, under
**Finance → Account**:

> Account Review — Verify your business so customers can buy from you. After
> you submit, our team will review your details and get back to you shortly.
>
> 5 of 7 required steps complete

with **Create your first product** and **Set up checkout** outstanding, and a
**Submit for review** button not yet pressed.

Until that review passes, a real checkout cannot complete whatever the app is
configured with. Products can be created before approval — step 1 below is
also one of the outstanding steps — but **do not switch `POLAR_SERVER` to
`production` until Polar has approved**, or every upgrade button on the live
site starts failing.

---

## 1. Eight products

One block per product, in the order Polar's **Products → New** form asks for
them, so nothing has to be looked up in a second place while typing. Create
them in any order; tick them off as the ids come back.

What you are creating, at a glance:

- [ ] 1 · Euclid Indie - Monthly — $12.00, recurring
- [ ] 2 · Euclid Indie - Yearly — $120.00, recurring
- [ ] 3 · Euclid Pro - Monthly — $29.00, recurring
- [ ] 4 · Euclid Pro - Yearly — $288.00, recurring
- [ ] 5 · Euclid - 50 Build Prompts — $5.00, **one-time**
- [ ] 6 · Euclid - 200 Build Prompts — $15.00, **one-time**
- [ ] 7 · Euclid - 250 Ask Euclid credits — $5.00, **one-time**
- [ ] 8 · Euclid - 1,000 Ask Euclid credits — $15.00, **one-time**

Two rules that apply across the groups, both of which fail silently:

- **All four subscriptions need the same 7-day trial.** Polar owns the trial;
  the app only reads `POLAR_TRIAL_DAYS` to decide what the upgrade button
  promises, so a product with a different trial makes the button lie. The
  preflight checks the four agree with each other and with the variable.
- **All four top-ups must be one-time, not recurring.** The app grants a
  top-up when Polar reports `order.paid`, and a subscription renewal produces
  that same event — so a pack created as recurring would charge every month
  *and* re-grant its credits every month. `scripts/polar-preflight.mjs`
  refuses a recurring top-up for exactly this reason.

---

### 1 · Euclid Indie - Monthly

| Field | Value |
|---|---|
| Name | `Euclid Indie - Monthly` |
| Pricing type | Recurring |
| Billing cycle | **Monthly** |
| Amount | **12.00** USD |
| Free trial | **7 days** |

```
3 boards, signed JWT identity, duplicate merging, themes and analytics. Billed monthly.
```

→ `POLAR_PRODUCT_INDIE_MONTHLY=`

---

### 2 · Euclid Indie - Yearly

| Field | Value |
|---|---|
| Name | `Euclid Indie - Yearly` |
| Pricing type | Recurring |
| Billing cycle | **Yearly** |
| Amount | **120.00** USD |
| Free trial | **7 days** |

```
3 boards, signed JWT identity, duplicate merging, themes and analytics. Billed yearly.
```

→ `POLAR_PRODUCT_INDIE_YEARLY=`

---

### 3 · Euclid Pro - Monthly

| Field | Value |
|---|---|
| Name | `Euclid Pro - Monthly` |
| Pricing type | Recurring |
| Billing cycle | **Monthly** |
| Amount | **29.00** USD |
| Free trial | **7 days** |

```
Unlimited boards, Ask Euclid chat, weekly digest, custom domain and GitHub repo context. Billed monthly.
```

→ `POLAR_PRODUCT_PRO_MONTHLY=`

---

### 4 · Euclid Pro - Yearly

| Field | Value |
|---|---|
| Name | `Euclid Pro - Yearly` |
| Pricing type | Recurring |
| Billing cycle | **Yearly** |
| Amount | **288.00** USD |
| Free trial | **7 days** |

```
Unlimited boards, Ask Euclid chat, weekly digest, custom domain and GitHub repo context. Billed yearly.
```

→ `POLAR_PRODUCT_PRO_YEARLY=`

---

### 5 · Euclid - 50 Build Prompts

| Field | Value |
|---|---|
| Name | `Euclid - 50 Build Prompts` |
| Pricing type | **One-time** |
| Billing cycle | — |
| Amount | **5.00** USD |
| Free trial | none |

```
A one-time top-up: 50 extra Build Prompts added to your workspace. Never expires - unused prompts carry over every month.
```

→ `POLAR_TOPUP_PROMPTS_50=`

---

### 6 · Euclid - 200 Build Prompts

| Field | Value |
|---|---|
| Name | `Euclid - 200 Build Prompts` |
| Pricing type | **One-time** |
| Billing cycle | — |
| Amount | **15.00** USD |
| Free trial | none |

```
A one-time top-up: 200 extra Build Prompts added to your workspace. Never expires - unused prompts carry over every month.
```

→ `POLAR_TOPUP_PROMPTS_200=`

---

### 7 · Euclid - 250 Ask Euclid credits

| Field | Value |
|---|---|
| Name | `Euclid - 250 Ask Euclid credits` |
| Pricing type | **One-time** |
| Billing cycle | — |
| Amount | **5.00** USD |
| Free trial | none |

```
A one-time top-up: 250 extra chat credits, about 40 questions. Never expires - unused credits carry over every month.
```

→ `POLAR_TOPUP_CREDITS_250=`

---

### 8 · Euclid - 1,000 Ask Euclid credits

| Field | Value |
|---|---|
| Name | `Euclid - 1,000 Ask Euclid credits` |
| Pricing type | **One-time** |
| Billing cycle | — |
| Amount | **15.00** USD |
| Free trial | none |

```
A one-time top-up: 1,000 extra chat credits, about 165 questions. Never expires - unused credits carry over every month.
```

→ `POLAR_TOPUP_CREDITS_1000=`

The "about 40 / about 165 questions" figures come from a credit being one step
of the Ask Euclid agent and a real question measuring four to seven steps. If
you reword them, keep the estimate conservative — a founder told to expect 40
and given 60 is pleased; the reverse is a complaint.

---

## 2. Two discounts

Both are **codeless**: the checkout route passes the discount id directly, so
there is nothing for a customer to type and nothing that can be shared.

- [ ] 9 · Launch 20%
- [ ] 10 · Student

---

### 9 · Launch 20%

| Field | Value |
|---|---|
| Name | `Launch 20%` |
| Code | **none** — leave it empty |
| Type | Percentage |
| Amount | **20%** |
| Duration | **Once** (first invoice only) |
| Starts | now |
| Ends | 2026-11-11T16:00Z — **see below** |

→ `POLAR_DISCOUNT_FIRST_PURCHASE=`

**That end date is carried over from sandbox and is close.** If production goes
live near or after 2026-11-11, pick a new one. Polar enforces the window
itself, which is why the app holds no date of its own — two places holding the
same deadline is one place to forget.

---

### 10 · Student

| Field | Value |
|---|---|
| Name | `Student` |
| Code | **none** — leave it empty |
| Type | Percentage |
| Amount | **50%** |
| Duration | **Forever** |
| Ends | never |

→ `POLAR_DISCOUNT_STUDENT=`

Applied by the server once a founder has verified a school e-mail address, so
there is no code to leak. Verifications lapse after a year.

---

These two ids are the one pair the preflight **cannot** verify, because the
sandbox token has no `discounts:read` — see the scopes note in the next
section, where granting it would close the gap.

Creating them in the dashboard was unpleasant in sandbox and is worth knowing:
the discount form ignores synthetic input, so if any automation is involved,
values have to be set through the native `HTMLInputElement.value` setter with
an `input` event dispatched, and Radix dropdowns need the `[role="option"]`
element clicked directly.

---

## 3. An organisation access token

**Settings → Developers → Create token**, never expiring, scoped to the
production org.

Polar offers 58 scopes. Tick six. The names below are copied from the token
dialog, so they are exact.

### Required — the app will not work without these

| Scope | What needs it |
|---|---|
| `checkouts:write` | `checkouts.create` — every upgrade and every top-up |
| `customer_sessions:write` | `customerSessions.create` — the "Manage billing" portal button |

That is genuinely all the running app calls. Webhook deliveries are
authenticated by `POLAR_WEBHOOK_SECRET`, not by this token, so no scope covers
them.

### Strongly recommended — the preflight uses these

| Scope | What it buys |
|---|---|
| `products:read` | `polar-preflight.mjs` checks all eight products: right interval, not archived, priced, one organisation, trial matching `POLAR_TRIAL_DAYS` |
| `discounts:read` | lets it check the two discount ids too — the sandbox token lacks this, which is why those are the one pair it reports as unverifiable |

### Worth adding — each one closes a gap that cost time in sandbox

| Scope | What it buys |
|---|---|
| `webhooks:read` | verify the endpoint's event subscription from a script. **This is the one that matters.** The first top-up purchase granted nothing because `order.paid` was not ticked, and with this scope that is a one-line check instead of a debugging session |
| `orders:read` | inspect a real order's shape, and confirm a purchase landed, without opening the dashboard |
| `products:write` | only if you create the eight products through the API rather than the form. Not needed otherwise |

### Do not grant the rest

Especially `payouts:write`, `transactions:write`, `refunds:write`,
`organizations:write`, `wallets:write`, `customers:write` and `user:write`.
This token sits in Vercel's environment and in `.env.local`; a leaked token
that can read products is a bad afternoon, and one that can move money is a
different category of problem entirely.

### Copy-paste summary

```
checkouts:write
customer_sessions:write
products:read
discounts:read
webhooks:read
orders:read
```

Goes into `POLAR_ACCESS_TOKEN`. One warning from sandbox: **every token
operation sat behind a "please sign in again" gate** unless the browser
session was only minutes old, so expect to re-authenticate.

## 4. A webhook endpoint — and the part that silently breaks

**Settings → Webhooks → Add Endpoint.**

| Field | Value |
|---|---|
| URL | `https://app.euclidhq.com/api/billing/webhook` |
| Format | **Raw** |
| API version | **2027-01** |
| Secret | goes into `POLAR_WEBHOOK_SECRET` |

Format and version both matter and neither fails loudly. Picking Discord or
Slack format reshapes the payload into something `validateEvent` will not
parse, and an API version older than the SDK's import changes field names.

### Events to tick — 13 of them

All eleven subscription events:

```
subscription.active      subscription.canceled    subscription.created
subscription.cycled      subscription.migrated    subscription.past_due
subscription.paused      subscription.resumed     subscription.revoked
subscription.uncanceled  subscription.updated
```

**and both order events:**

```
order.paid        order.refunded
```

> **This is the step that cost a whole debugging session.** The sandbox
> endpoint had only the subscription events ticked. The first top-up purchase
> completed, the card was charged, the success page appeared — and nothing was
> granted, because `order.paid` was never *sent*. No request reached the server
> at all, so there was nothing in the app to debug. `order.refunded` has the
> same failure mode: a refund would silently leave the credits in place.

If you drive these toggles with anything other than a real mouse click, note
that a synthetic `.click()` flips `aria-checked` and the hidden input without
reaching the form state, so **Save writes the old set back** and the page looks
like it worked until you reload.

---

## 5. The environment, swapped together

Ten ids plus three settings. Set them in **Vercel → production** and in
`.env.local`, then redeploy — Vercel env vars only reach a new deployment.

```
POLAR_SERVER=production
POLAR_ACCESS_TOKEN=<step 3>
POLAR_WEBHOOK_SECRET=<step 4>

POLAR_PRODUCT_INDIE_MONTHLY=
POLAR_PRODUCT_INDIE_YEARLY=
POLAR_PRODUCT_PRO_MONTHLY=
POLAR_PRODUCT_PRO_YEARLY=

POLAR_TOPUP_PROMPTS_50=
POLAR_TOPUP_PROMPTS_200=
POLAR_TOPUP_CREDITS_250=
POLAR_TOPUP_CREDITS_1000=

POLAR_DISCOUNT_FIRST_PURCHASE=
POLAR_DISCOUNT_STUDENT=

POLAR_TRIAL_DAYS=7
```

**All of it moves at once.** Sandbox and production are separate accounts, so a
sandbox id left behind in a production deployment makes the webhook fail closed
with "Unknown Polar product" — after the customer has paid. `planForProduct`
and `topupForProduct` both refuse an id they do not recognise rather than
guessing a tier, which is the right behaviour and also means the failure is
silent until someone reads a log.

`scripts/vercel-env.mjs` pushes `.env.local` to Vercel without printing values,
if that is easier than fourteen paste operations.

---

## 6. Checking it before trusting it

```bash
POLAR_SERVER=production node scripts/polar-preflight.mjs
```

Exits non-zero if the environment could not sell correctly. It catches a
production id read against sandbox (404), a sandbox token against production
(401), a monthly and a yearly id swapped between slots — which resolve
perfectly well and quietly sell the wrong billing period — an archived or
unpriced product, two slots sharing an id, a top-up that is recurring, a trial
that disagrees with `POLAR_TRIAL_DAYS`, and products split across two
organisations.

It cannot check the two discount ids without `discounts:read`, and it cannot
see the webhook's event subscription at all. Those stay manual.

Then, once approved, buy something small and watch it land:

1. An upgrade, and confirm the workspace moves tier.
2. A $5 top-up, and confirm `extra_prompts` moves and a `credit_topups` row
   appears with the Polar order id. In sandbox this took about five seconds.
3. Refund that order in the Polar dashboard, and confirm the balance comes
   back down and `refunded_at` is set.

One practical note from testing: **Polar rejects reserved e-mail domains**.
`@euclid.test` fails with "a special-use or reserved name", and that address
reaches Polar as `customer_email` straight from the signed-in founder — so test
accounts used against a real checkout need a normal domain.

---

## 7. The sandbox subscription that still exists

The Driftnote workspace carries a real sandbox Polar subscription
(`polar_subscription_id=fa895761…`). It is sandbox money but a real row, and a
production flip should expect to reconcile or clear it rather than leave a
workspace pointing at a subscription that does not exist in the account the
app is now talking to.
