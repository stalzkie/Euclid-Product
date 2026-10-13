import { loadEnv } from "./env.mjs";
loadEnv();
import { createPolar } from "@polar-sh/sdk/2027-01";

/**
 * Checks the Polar environment before it goes anywhere near a real card.
 *
 * The flip from sandbox to production is six ids and a server name that have
 * to move together, and getting it half right does not fail loudly — it fails
 * at the webhook, after the customer has paid. `planForProduct` refuses an id
 * it does not recognise, so the subscription arrives, the money is taken, and
 * the workspace stays on free with "Unknown Polar product" in a log nobody is
 * watching.
 *
 * So this asks Polar directly, on whichever server POLAR_SERVER names:
 *
 *   - are all four product ids set, and set to something non-empty
 *   - does each one exist on this server (a production id read against
 *     sandbox is a 404, which is the whole failure mode in one call)
 *   - do all four belong to the same organisation
 *   - does each product's own billing interval match the slot it is in — two
 *     ids swapped between monthly and yearly resolve fine and sell the wrong
 *     thing, and nothing else would catch it
 *   - is any of them archived, non-recurring or priced at nothing
 *   - do the trials agree with each other and with POLAR_TRIAL_DAYS, which is
 *     what the upgrade button promises
 *
 * Run it against sandbox now and against production after the products are
 * recreated there:
 *
 *   node scripts/polar-preflight.mjs
 *   POLAR_SERVER=production node scripts/polar-preflight.mjs
 *
 * Exits non-zero if anything is wrong, so it can gate a deploy.
 */

/** The four slots, and what each one claims to be selling. */
const SLOTS = [
  { env: "POLAR_PRODUCT_INDIE_MONTHLY", tier: "indie", period: "monthly", interval: "month" },
  { env: "POLAR_PRODUCT_INDIE_YEARLY", tier: "indie", period: "yearly", interval: "year" },
  { env: "POLAR_PRODUCT_PRO_MONTHLY", tier: "pro", period: "monthly", interval: "month" },
  { env: "POLAR_PRODUCT_PRO_YEARLY", tier: "pro", period: "yearly", interval: "year" },
];

const problems = [];
const notes = [];
const fail = (message) => problems.push(message);
const note = (message) => notes.push(message);

const server = process.env.POLAR_SERVER === "production" ? "production" : "sandbox";
const token = process.env.POLAR_ACCESS_TOKEN;

console.log(`Polar preflight · server=${server}`);
console.log("");

if (!token) {
  console.log("POLAR_ACCESS_TOKEN is not set. Nothing else can be checked.");
  process.exit(1);
}

// `polarServer()` defaults to sandbox when the variable is missing or
// misspelled, which is the safe default but also means "production" can be
// believed only when it is spelled exactly that way.
if (process.env.POLAR_SERVER && process.env.POLAR_SERVER !== server) {
  fail(
    `POLAR_SERVER is "${process.env.POLAR_SERVER}", which the app does not read as ` +
      `production — it is falling back to sandbox. Only the exact string ` +
      `"production" switches servers.`,
  );
}

if (!process.env.POLAR_WEBHOOK_SECRET) {
  fail("POLAR_WEBHOOK_SECRET is not set, so every webhook will be rejected as unsigned.");
}

const polar = createPolar({ accessToken: token, environment: server });

/* -------------------------------------------------------------------------- */
/* Products                                                                   */
/* -------------------------------------------------------------------------- */

const seen = new Map();
const found = [];

for (const slot of SLOTS) {
  const id = process.env[slot.env];

  // A `.env` line written as `FOO=` gives "" rather than undefined, and an
  // empty id is the one that made an early `planForProduct` grant Indie to
  // nobody's purchase.
  if (!id) {
    fail(`${slot.env} is ${id === undefined ? "missing" : "set but empty"}.`);
    console.log(`✗ ${slot.env}  — not set`);
    continue;
  }

  if (seen.has(id)) {
    fail(
      `${slot.env} and ${seen.get(id)} hold the same product id. ` +
        `planForProduct would resolve it to whichever comes first, so one of ` +
        `the two plans is unsellable.`,
    );
  }
  seen.set(id, slot.env);

  let product;
  try {
    product = await polar.products.get(id);
  } catch (err) {
    const status = err?.statusCode ?? "?";
    fail(
      `${slot.env} (${id}) does not resolve on ${server} — Polar answered ${status}. ` +
        (status === 404
          ? "A 404 is what a production id read against sandbox looks like, and vice versa."
          : status === 401
            ? "A 401 means the token itself is not valid on this server — sandbox and " +
              "production are separate accounts with separate tokens, so POLAR_SERVER " +
              "and POLAR_ACCESS_TOKEN have to move together."
            : "Check the token's scopes and the id."),
    );
    console.log(`✗ ${slot.env}  — ${status} from Polar`);
    continue;
  }

  const price = (product.prices ?? []).find((p) => !p.is_archived) ?? null;
  const amount = price ? `$${(price.price_amount / 100).toFixed(2)}` : "no active price";
  const trial =
    product.trial_interval && product.trial_interval_count
      ? `${product.trial_interval_count} ${product.trial_interval} trial`
      : "no trial";

  console.log(
    `${product.recurring_interval === slot.interval && !product.is_archived ? "✓" : "✗"} ` +
      `${slot.env}\n    ${product.name} · ${amount}/${product.recurring_interval} · ${trial}`,
  );

  if (product.recurring_interval !== slot.interval) {
    fail(
      `${slot.env} points at "${product.name}", which Polar bills every ` +
        `${product.recurring_interval}, not every ${slot.interval}. The ids for ` +
        `monthly and yearly are the wrong way round, and the webhook would ` +
        `record the wrong billing period for a real payment.`,
    );
  }
  if (product.is_archived) {
    fail(`${slot.env} points at "${product.name}", which is archived in Polar.`);
  }
  if (!product.is_recurring) {
    fail(`${slot.env} points at "${product.name}", which is not a subscription.`);
  }
  if (!price) {
    fail(`${slot.env} points at "${product.name}", which has no active price.`);
  }
  if (product.visibility && product.visibility !== "public") {
    note(`${slot.env} ("${product.name}") has visibility "${product.visibility}".`);
  }

  found.push({ slot, product });
}

/* -------------------------------------------------------------------------- */
/* One organisation, one trial                                                */
/* -------------------------------------------------------------------------- */

console.log("");

const orgs = new Set(found.map((f) => f.product.organization_id));
if (orgs.size > 1) {
  fail(
    `The four products belong to ${orgs.size} different Polar organisations ` +
      `(${[...orgs].join(", ")}). A subscription from one of them cannot be ` +
      `reconciled against a token scoped to another.`,
  );
} else if (orgs.size === 1) {
  console.log(`✓ one organisation · ${[...orgs][0]}`);
}

// Only worth asking once something resolved. Comparing trials across an empty
// set reported that the products carry "undefined", which reads as a second
// fault rather than a consequence of the first.
const trials = new Set(
  found.map((f) =>
    f.product.trial_interval && f.product.trial_interval_count
      ? `${f.product.trial_interval_count} ${f.product.trial_interval}`
      : "none",
  ),
);
if (trials.size > 1) {
  fail(
    `The products do not agree on a trial (${[...trials].join(", ")}), so what a ` +
      `founder gets depends on which plan they pick.`,
  );
}

// POLAR_TRIAL_DAYS does not create the trial — Polar owns that — it only drives
// the button copy. Which is exactly why a mismatch is worth catching: the
// button would promise something the checkout does not give.
const advertised = Number(process.env.POLAR_TRIAL_DAYS);
const actual = [...trials][0];
if (!found.length) {
  // Nothing resolved, so there is nothing to compare a trial against.
} else if (Number.isInteger(advertised) && advertised > 0) {
  if (actual === `${advertised} day`) {
    console.log(`✓ trial · ${actual}, matching POLAR_TRIAL_DAYS`);
  } else {
    fail(
      `POLAR_TRIAL_DAYS=${advertised} but the products carry "${actual}". The ` +
        `upgrade button would promise a trial the checkout does not give.`,
    );
  }
} else if (actual && actual !== "none") {
  note(
    `The products carry a ${actual} trial but POLAR_TRIAL_DAYS is not set, so the ` +
      `upgrade button will not mention it.`,
  );
}

/* -------------------------------------------------------------------------- */
/* Top-up packs                                                               */
/* -------------------------------------------------------------------------- */

/*
  One-time products, so they are checked differently from the plans: a top-up
  must NOT be recurring. A pack accidentally created as a subscription would
  bill someone monthly for a thing they bought once, and nothing in the app
  would notice — the webhook grants on `order.paid`, which a subscription
  renewal also produces.

  These are optional. A deployment with none configured simply does not sell
  top-ups, which is the state before the products exist.
*/
console.log("");

const PACKS = [
  "POLAR_TOPUP_PROMPTS_50",
  "POLAR_TOPUP_PROMPTS_200",
  "POLAR_TOPUP_CREDITS_250",
  "POLAR_TOPUP_CREDITS_1000",
];

for (const env of PACKS) {
  const id = process.env[env];
  if (!id) {
    console.log(`- ${env}  - not set (pack not for sale)`);
    continue;
  }

  if (seen.has(id)) {
    fail(`${env} and ${seen.get(id)} hold the same product id.`);
  }
  seen.set(id, env);

  try {
    const product = await polar.products.get(id);
    const price = (product.prices ?? []).find((p) => !p.is_archived) ?? null;
    const amount = price ? `$${(price.price_amount / 100).toFixed(2)}` : "no active price";
    console.log(`${product.is_recurring ? "x" : "+"} ${env}
    ${product.name} - ${amount} one-time`);

    if (product.is_recurring) {
      fail(
        `${env} points at "${product.name}", which Polar bills every ` +
          `${product.recurring_interval}. A top-up is a one-time purchase - as a ` +
          `subscription it would charge again every month for a pack bought once.`,
      );
    }
    if (product.is_archived) {
      fail(`${env} points at "${product.name}", which is archived in Polar.`);
    }
    if (!price) {
      fail(`${env} points at "${product.name}", which has no active price.`);
    }
    if (orgs.size === 1 && !orgs.has(product.organization_id)) {
      fail(`${env} belongs to a different organisation than the plan products.`);
    }
  } catch (err) {
    const status = err?.statusCode ?? "?";
    fail(`${env} (${id}) does not resolve on ${server} - Polar answered ${status}.`);
    console.log(`x ${env}  - ${status} from Polar`);
  }
}

/* -------------------------------------------------------------------------- */
/* Discounts                                                                  */
/* -------------------------------------------------------------------------- */

console.log("");

for (const [env, label] of [
  ["POLAR_DISCOUNT_FIRST_PURCHASE", "launch promotion"],
  ["POLAR_DISCOUNT_STUDENT", "student rate"],
]) {
  const id = process.env[env];
  if (!id) {
    note(`${env} is not set, so no ${label} is applied. That may be deliberate.`);
    console.log(`– ${env}  — not set (${label} off)`);
    continue;
  }

  try {
    const discount = await polar.discounts.get(id);
    const amount =
      discount.basis_points != null
        ? `-${discount.basis_points / 100}%`
        : `-$${((discount.amount ?? 0) / 100).toFixed(2)}`;
    const ends = discount.ends_at ? `ends ${discount.ends_at}` : "no end date";
    console.log(`✓ ${env}\n    ${discount.name} · ${amount} · ${discount.duration} · ${ends}`);
    if (discount.ends_at && new Date(discount.ends_at) < new Date()) {
      fail(`${env} ("${discount.name}") expired at ${discount.ends_at}.`);
    }
    if (discount.organization_id && orgs.size === 1 && !orgs.has(discount.organization_id)) {
      fail(`${env} belongs to a different organisation than the products.`);
    }
  } catch (err) {
    const status = err?.statusCode ?? "?";
    if (status === 403) {
      // The organisation token used for checkouts has no discounts:read, and
      // asking for one is a trip through Polar's "please sign in again" gate.
      // Saying so is more use than a green tick that checked nothing.
      note(
        `${env} is set but could not be read: the token has no discounts:read ` +
          `scope. The checkout route only passes this id through, so a wrong ` +
          `one surfaces as a refused checkout rather than a wrong price.`,
      );
      console.log(`? ${env}  — set, unverifiable without discounts:read`);
    } else {
      fail(`${env} (${id}) does not resolve on ${server} — Polar answered ${status}.`);
      console.log(`✗ ${env}  — ${status} from Polar`);
    }
  }
}

/* -------------------------------------------------------------------------- */

console.log("");
for (const n of notes) console.log(`note: ${n}`);
if (notes.length) console.log("");

if (problems.length) {
  console.log(`${problems.length} problem${problems.length === 1 ? "" : "s"}:`);
  for (const p of problems) console.log(`  · ${p}`);
  console.log("");
  console.log(`Do not point a deployment at ${server} until these are fixed.`);
  process.exit(1);
}

console.log(`Ready. Billing on ${server} is consistent with this environment.`);
