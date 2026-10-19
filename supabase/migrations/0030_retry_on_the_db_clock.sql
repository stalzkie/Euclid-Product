-- `deliver_after` was written on one clock and read on another.
--
-- Both outboxes computed the next attempt's timestamp in the application
-- (`retryAfter` in src/lib/retry.ts, `new Date()` plus a quadratic offset) and
-- then stored it in a column that is only ever compared against the
-- database's `now()`. Those are two different clocks, and nothing made them
-- agree.
--
-- On 2026-10-13 a proof run measured the gap at 185 seconds where 60 was
-- intended: this machine's clock ran roughly two minutes ahead of Supabase's.
-- Ahead is the harmless direction — the row simply waits longer than the
-- schedule says. Behind is not. A server whose clock trails the database's
-- computes a `deliver_after` that is *already in the past*, so the row is
-- immediately due again and the backoff it was given does nothing. The five
-- attempts a dead provider is allowed would then be spent in whatever time it
-- takes five requests to call `drainAfterResponse`, which on a busy board is
-- seconds — and for the email queue that means a magic link's five chances
-- are gone before the provider has had a chance to come back.
--
-- The fix is to stop having two clocks. The application still decides *how
-- long* to wait, because that schedule is a product decision tied to the
-- magic link's one-hour expiry and belongs next to the code that explains it.
-- The database decides *from when*, because it is what later does the
-- comparison. A delay is skew-free in a way an instant is not.
--
-- These also fold the `last_error` write into the same statement, so a failed
-- attempt records its reason and its backoff together rather than in two
-- updates that could half-apply.

-- An email that just failed: record why, and make it due again after the
-- delay the caller computed.
--
-- Deliberately does not touch `attempts`. The claim already incremented it on
-- the way out, which is what makes a row claimable exactly once; incrementing
-- here as well would double-count every failure and abandon rows at three
-- real attempts rather than five.
create or replace function fail_queued_email(
  p_id            uuid,
  p_error         text,
  p_delay_seconds int
)
returns void
language sql
security definer
set search_path = public
as $$
  update email_outbox
  set last_error    = left(p_error, 500),
      deliver_after = now() + make_interval(secs => greatest(p_delay_seconds, 0))
  where id = p_id;
$$;

-- The same, for a webhook delivery.
--
-- The caller still updates the parent `integrations` row separately — its
-- `last_error`, and `active = false` once the attempts are exhausted. That
-- stays in the application because deactivating an integration is a decision
-- about the integration, not a property of this one failed delivery.
create or replace function fail_integration_delivery(
  p_id            uuid,
  p_error         text,
  p_delay_seconds int
)
returns void
language sql
security definer
set search_path = public
as $$
  update integration_deliveries
  set last_error    = left(p_error, 500),
      deliver_after = now() + make_interval(secs => greatest(p_delay_seconds, 0))
  where id = p_id;
$$;

-- Both queues run as the service role, and both tables hold things nobody
-- else should be writing: an unsent email may carry a sign-in link, and a
-- delivery carries a payload bound for someone's webhook.
revoke all on function fail_queued_email(uuid, text, int)
  from public, anon, authenticated;
grant execute on function fail_queued_email(uuid, text, int) to service_role;

revoke all on function fail_integration_delivery(uuid, text, int)
  from public, anon, authenticated;
grant execute on function fail_integration_delivery(uuid, text, int) to service_role;
