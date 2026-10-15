/**
 * Reconcile the Driftnote workspace, 2026-10-15.
 *
 * Driftnote (id all-1s) is the seed/demo workspace from supabase/seed.sql,
 * owned by the fictional founder "Maya Reyes". During sandbox testing a real
 * SANDBOX subscription got bound to it. Production Polar has no such customer
 * or subscription -- the Subscriptions list is empty and the only production
 * customer is the founder's own -- so these ids are dangling:
 *
 *   polar_customer_id     0ef97459-0760-41b9-9004-307ccc108927
 *   polar_subscription_id fa895761-7cc5-4418-9273-8fbe55903c3b
 *
 * Left alone, the billing page's "Manage billing" button on that workspace
 * would open a customer portal for a customer the production org has never
 * heard of, and the workspace silently holds Pro entitlements it never paid
 * for.
 *
 * This returns the billing columns to the state seed.sql creates: plan
 * 'indie', no Polar identifiers, no subscription. It touches nothing else --
 * boards, posts and members are left exactly as they are.
 *
 * Prints the row before and after, so the change is reversible by hand.
 *
 * Run from the project root:  node <this file>
 */
import { loadEnv } from "./env.mjs";
loadEnv();
import { createClient } from "@supabase/supabase-js";

const db = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } },
);

const WS = "11111111-1111-1111-1111-111111111111";
const COLS =
  "id,name,plan,billing_period,subscription_status," +
  "polar_customer_id,polar_subscription_id,current_period_end";

const { data: before, error: e1 } = await db
  .from("workspaces").select(COLS).eq("id", WS).single();
if (e1) throw e1;
console.log("BEFORE:", JSON.stringify(before, null, 2));

// Guard: refuse to run against anything that is not the known seed row, so a
// mistyped id cannot quietly strip a paying workspace's subscription.
if (before.name !== "Driftnote") {
  throw new Error(`Refusing to touch ${WS}: expected Driftnote, found ${before.name}`);
}
if (before.polar_subscription_id !== "fa895761-7cc5-4418-9273-8fbe55903c3b") {
  throw new Error(
    "Refusing: polar_subscription_id is not the known sandbox leftover. " +
    "Something has changed since this was written -- re-check before running.",
  );
}

const { error: e2 } = await db.from("workspaces").update({
  plan: "indie", // what supabase/seed.sql:19 creates it as
  subscription_status: null,
  polar_customer_id: null,
  polar_subscription_id: null,
  current_period_end: null,
}).eq("id", WS);
if (e2) throw e2;

const { data: after, error: e3 } = await db
  .from("workspaces").select(COLS).eq("id", WS).single();
if (e3) throw e3;
console.log("AFTER:", JSON.stringify(after, null, 2));
