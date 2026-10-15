-- Knowing that a subscription has been cancelled.
--
-- Polar does not change `status` when someone cancels. A cancelled plan keeps
-- running to the end of the period it is paid for, so it stays `trialing` or
-- `active` and carries the news in a separate field. Read from the real
-- payload of the cancellation on 2026-10-15:
--
--   "status": "trialing",
--   "cancel_at_period_end": true,
--   "canceled_at": "2026-10-15T13:00:06.618030Z",
--   "ends_at": "2026-10-22T12:28:47.171143Z"
--
-- `applySubscription` only ever read `status`, so the workspace row did not
-- change at all and the billing page went on saying Active with a Cancel
-- button under it. The founder cancels, is told nothing happened, and is still
-- promised a renewal.
--
-- One boolean fixes it. `subscription.uncanceled` arrives through the same
-- path with the flag false, so resuming heals itself without special casing.

alter table workspaces
  add column cancel_at_period_end boolean not null default false;

comment on column workspaces.cancel_at_period_end is
  'Polar''s cancel_at_period_end. The plan keeps its tier until '
  'current_period_end and then drops; status stays active/trialing meanwhile.';

-- The function gains a parameter rather than being replaced by a second one.
-- A default makes the old seven-argument call still resolve, so a deploy that
-- lands after this migration but before the new code -- or a rollback the
-- other way -- keeps working instead of erroring on every webhook. Two
-- overloads would make the seven-argument call ambiguous and fail outright,
-- which is why the old signature is dropped rather than left beside it.
drop function if exists apply_subscription(uuid, plan_tier, text, text, text, text, timestamptz);

create or replace function apply_subscription(
  p_workspace       uuid,
  p_plan            plan_tier,
  p_period          text,
  p_customer_id     text,
  p_subscription_id text,
  p_status          text,
  p_period_end      timestamptz,
  p_cancel_at_period_end boolean default false
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
      current_period_end    = p_period_end,
      cancel_at_period_end  = coalesce(p_cancel_at_period_end, false)
  where id = p_workspace;

  -- The free tier always carries the badge, and a downgrade has to put it back
  -- on. Doing it here rather than in the route means it cannot be forgotten by
  -- whichever of the webhook events happens to deliver the downgrade first.
  if p_plan = 'free' then
    update boards set show_badge = true where workspace_id = p_workspace;
  end if;
end;
$$;

revoke all on function apply_subscription(uuid, plan_tier, text, text, text, text, timestamptz, boolean)
  from public, anon, authenticated;
grant execute on function apply_subscription(uuid, plan_tier, text, text, text, text, timestamptz, boolean)
  to service_role;

-- A workspace that dropped to free has no subscription to cancel, so the flag
-- would be noise on a row nobody can act on.
update workspaces set cancel_at_period_end = false where plan = 'free';
