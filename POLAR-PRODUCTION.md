# Setting up Polar production

Everything that has to exist in the **production** Polar organisation before
`app.euclidhq.com` can take real money, written out so it can be created by
hand. The sandbox org already has all of it; this is the same thing again in
an account that is a completely separate world — separate products, separate
ids, separate token, separate webhook.

Written 2026-10-13 from the live sandbox objects, so the names, prices and
descriptions below are what is actually configured, not what was intended.

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

Create each one in **Products → New**. The two things that matter beyond the
price are the **billing interval** and the **trial**, and they are different
for the two groups.

### Subscriptions (four) — recurring, 7-day trial

| Name | Price | Billing | Trial | Env var for the id |
|---|---|---|---|---|
| `Euclid Indie - Monthly` | $12.00 | Monthly | 7 days | `POLAR_PRODUCT_INDIE_MONTHLY` |
| `Euclid Indie - Yearly` | $120.00 | Yearly | 7 days | `POLAR_PRODUCT_INDIE_YEARLY` |
| `Euclid Pro - Monthly` | $29.00 | Monthly | 7 days | `POLAR_PRODUCT_PRO_MONTHLY` |
| `Euclid Pro - Yearly` | $288.00 | Yearly | 7 days | `POLAR_PRODUCT_PRO_YEARLY` |

Descriptions, as they read in sandbox:

- **Indie Monthly** — 3 boards, signed JWT identity, duplicate merging, themes and analytics. Billed monthly.
- **Indie Yearly** — 3 boards, signed JWT identity, duplicate merging, themes and analytics. Billed yearly.
- **Pro Monthly** — Unlimited boards, Ask Euclid chat, weekly digest, custom domain and GitHub repo context. Billed monthly.
- **Pro Yearly** — Unlimited boards, Ask Euclid chat, weekly digest, custom domain and GitHub repo context. Billed yearly.

All four need the **same 7-day trial**. Polar owns the trial; the app only
reads `POLAR_TRIAL_DAYS` to decide what the upgrade button promises, so a
product with a different trial makes the button lie. The preflight checks that
the four agree with each other and with the variable.

### Top-ups (four) — ONE-TIME, no trial

| Name | Price | Billing | Env var for the id |
|---|---|---|---|
| `Euclid - 50 Build Prompts` | $5.00 | **One-time** | `POLAR_TOPUP_PROMPTS_50` |
| `Euclid - 200 Build Prompts` | $15.00 | **One-time** | `POLAR_TOPUP_PROMPTS_200` |
| `Euclid - 250 Ask Euclid credits` | $5.00 | **One-time** | `POLAR_TOPUP_CREDITS_250` |
| `Euclid - 1,000 Ask Euclid credits` | $15.00 | **One-time** | `POLAR_TOPUP_CREDITS_1000` |

Descriptions:

- **50 Build Prompts** — A one-time top-up: 50 extra Build Prompts added to your workspace. Never expires - unused prompts carry over every month.
- **200 Build Prompts** — A one-time top-up: 200 extra Build Prompts added to your workspace. Never expires - unused prompts carry over every month.
- **250 credits** — A one-time top-up: 250 extra chat credits, about 40 questions. Never expires - unused credits carry over every month.
- **1,000 credits** — A one-time top-up: 1,000 extra chat credits, about 165 questions. Never expires - unused credits carry over every month.

> **These must not be subscriptions.** The app grants a top-up when Polar
> reports `order.paid`, and a subscription renewal produces that same event —
> so a pack created as a recurring product would charge monthly *and* re-grant
> its credits every month. `scripts/polar-preflight.mjs` refuses a recurring
> top-up for exactly this reason.

The "about 40 / about 165 questions" figures come from a credit being one step
of the Ask Euclid agent and a real question measuring four to seven steps. If
you reword them, keep the estimate conservative — a founder told to expect 40
and given 60 is pleased; the reverse is a complaint.

---

## 2. Two discounts

Both are **codeless**: the checkout route passes the discount id directly, so
there is nothing for a customer to type and nothing that can be shared.

| Name | Code | Amount | Duration | Ends | Env var |
|---|---|---|---|---|---|
| Launch 20% | none | −20% | **Once** (first invoice only) | 2026-11-11T16:00Z | `POLAR_DISCOUNT_FIRST_PURCHASE` |
| Student | none | −50% | **Forever** | never | `POLAR_DISCOUNT_STUDENT` |

Two notes:

- **The launch end date is from the sandbox setup and is close.** If production
  goes live near or after 2026-11-11, pick a new one — Polar enforces the
  window itself, which is why the app holds no date of its own.
- These are the one pair of ids the preflight **cannot** verify, because the
  sandbox token has no `discounts:read`. See the scopes note below — granting
  it in production would close that gap.

Creating them in the dashboard was unpleasant in sandbox and is worth knowing:
the discount form ignores synthetic input, so if any automation is involved,
values have to be set through the native `HTMLInputElement.value` setter with
an `input` event dispatched, and Radix dropdowns need the `[role="option"]`
element clicked directly.

---

## 3. An organisation access token

**Settings → Developers → New token**, never expiring, scoped to the
production org.

The sandbox token carries enough to run the app and the preflight:

- `products:read` — the preflight reads all eight products
- `products:write` — only needed if products are created via the API rather
  than the dashboard
- `checkouts:write` — the checkout and top-up routes create checkouts

**Consider granting three more than sandbox has.** Their absence is why
several things could only be checked by hand this time:

- `discounts:read` — would let the preflight verify the two discount ids
- `orders:read` — would let an order's real shape be inspected without a purchase
- `webhooks:read` — would let the event subscription in step 4 be verified from
  a script rather than a screenshot

Goes into `POLAR_ACCESS_TOKEN`. Note that in sandbox, **every token operation
sat behind a "please sign in again" gate** unless the browser session was
minutes old.

---

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
