-- Polar billing.
--
-- Until now `workspaces.plan` was written directly by the billing page: the
-- limits it unlocked were real, the charge was not. Polar is now the authority
-- on what a workspace is entitled to, and the only thing permitted to move
-- `plan` is the webhook that reacts to a subscription changing.
--
-- Nothing here stores a card, an amount or an invoice. Polar is the merchant of
-- record and keeps all of that; these columns only hold the identifiers needed
-- to tie a workspace to its subscription and to open the customer portal.

alter table workspaces
  -- Polar's customer id. Set on the first checkout and then reused, so a
  -- founder who upgrades, cancels and resubscribes stays one customer with one
  -- billing history rather than accumulating duplicates.
  add column polar_customer_id     text,
  add column polar_subscription_id text,
  -- Polar's own status string, stored verbatim rather than mapped to a boolean.
  -- `past_due` is the reason: the subscription has not been revoked and the
  -- founder should keep their features while the retry runs, but the UI needs
  -- to be able to tell them a payment failed.
  add column subscription_status   text,
  -- When the current paid period ends. After a cancellation Polar keeps the
  -- subscription active until this moment, so the UI says "Pro until the 3rd"
  -- instead of pretending the downgrade already happened.
  add column current_period_end    timestamptz;

-- The webhook arrives with a Polar id and no session, so these are the lookup
-- paths into the table. Partial, because the overwhelming majority of rows are
-- free workspaces that will never have either.
create unique index workspaces_polar_customer_id_key
  on workspaces (polar_customer_id) where polar_customer_id is not null;
create unique index workspaces_polar_subscription_id_key
  on workspaces (polar_subscription_id) where polar_subscription_id is not null;

-- Apply a subscription state change from the Polar webhook.
--
-- This is a function rather than four statements in the route for one reason:
-- the webhook runs as the service role with no session, and routing every plan
-- change through a single definer function means there is exactly one place in
-- the system that can move a workspace between tiers. The route cannot write
-- `plan` any other way.
--
-- Idempotent on purpose. Polar retries a webhook that did not get a 2xx, and
-- `subscription.updated` fires alongside the more specific events, so the same
-- state arrives more than once as a matter of course.
create or replace function apply_subscription(
  p_workspace       uuid,
  p_plan            plan_tier,
  p_period          text,
  p_customer_id     text,
  p_subscription_id text,
  p_status          text,
  p_period_end      timestamptz
)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update workspaces
  set plan                  = p_plan,
      billing_period        = p_period,
      polar_customer_id     = coalesce(p_customer_id, polar_customer_id),
      polar_subscription_id = p_subscription_id,
      subscription_status   = p_status,
      current_period_end    = p_period_end
  where id = p_workspace;

  -- The free tier always carries the badge, and a downgrade has to put it back
  -- on. Doing it here rather than in the route means it cannot be forgotten by
  -- whichever of the webhook events happens to deliver the downgrade first.
  if p_plan = 'free' then
    update boards set show_badge = true where workspace_id = p_workspace;
  end if;
end;
$$;

revoke all on function apply_subscription(uuid, plan_tier, text, text, text, text, timestamptz)
  from public, anon, authenticated;
grant execute on function apply_subscription(uuid, plan_tier, text, text, text, text, timestamptz)
  to service_role;
