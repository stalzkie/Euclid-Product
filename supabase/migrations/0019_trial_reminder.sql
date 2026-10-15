-- Remembering that a founder was warned their trial is ending.
--
-- Polar's trial checkout collects no card. Confirmed on 2026-10-15 by taking a
-- real trial on production: email and country, then "Start trial", and no card
-- field at any point. The $5 top-up checkout immediately afterwards did ask
-- for one, so this is the trial flow specifically, and there is no "require
-- payment method" option on the product to turn on -- the trial settings are a
-- toggle and a duration, nothing else.
--
-- So every trial reaches day 7 with no way to charge it. Polar fails the
-- payment, moves the subscription to past_due, retries for a few days and then
-- revokes it. The app keeps the founder entitled through past_due on purpose
-- (`ENTITLED` in lib/polar.ts) and then quietly drops them to free. At no
-- point does anything tell them: the app sends exactly three kinds of email
-- -- magic link, changelog, student verification -- and none are about
-- billing.
--
-- That is the whole trial funnel ending in silence. A reminder before the
-- trial ends is the cheapest thing that changes it.
--
-- This column is the idempotency key. The drain runs on every post, publish
-- and magic link as well as on the cron, so without it a founder would be
-- reminded several times an hour for the last two days of their trial.

alter table workspaces
  add column trial_reminder_sent_at timestamptz;

comment on column workspaces.trial_reminder_sent_at is
  'When the "your trial is ending" email was queued. Null means not yet sent. '
  'Cleared when a new trial starts, so a second trial is reminded again.';

-- Partial, because the job asks exactly one question: which trialing
-- workspaces have not been reminded yet. The vast majority of rows are neither
-- trialing nor unreminded, and they should not be in the index at all.
create index workspaces_trial_reminder_due_idx
  on workspaces (current_period_end)
  where subscription_status = 'trialing' and trial_reminder_sent_at is null;

-- A second trial, on a new subscription, has to be reminded again. The stored
-- flag belongs to the subscription that earned it, so it is cleared whenever
-- the workspace moves to a different one. Keyed on the id rather than on
-- status, because a workspace can go free and come back, and "is this a
-- different subscription" is the question that actually matters.
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
      cancel_at_period_end  = coalesce(p_cancel_at_period_end, false),
      trial_reminder_sent_at = case
        when polar_subscription_id is distinct from p_subscription_id then null
        else trial_reminder_sent_at
      end
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
