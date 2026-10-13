-- The email outbox could not recover from a single failure.
--
-- `integration_deliveries` has carried `attempts`, `deliver_after` and
-- `last_error` since 0007, so a webhook that fails is retried on a backoff and
-- abandoned after five tries. `email_outbox` had none of that: a row was
-- selected on `sent_at is null` and, if the send failed, simply left there.
-- The next thing to call sendQueuedEmails would try it again immediately, and
-- the only thing guaranteed to call it is the scheduled job — which on Vercel
-- Hobby runs once a day. A magic link expires in an hour, so a transient
-- Resend failure meant the sign-in silently could not happen at all, and the
-- retry, when it came, delivered a link that was already dead.
--
-- With these columns any later request's `drainAfterResponse` performs the
-- retry on a sensible backoff, so recovery no longer depends on the
-- scheduler's interval.

alter table email_outbox add column attempts      int         not null default 0;
alter table email_outbox add column deliver_after timestamptz not null default now();
alter table email_outbox add column last_error    text;

-- The old index ordered the queue by `created_at`, which is no longer what the
-- claim reads: a row waiting out a backoff must not be picked up because it
-- happens to be the oldest. Named explicitly because 0001 created it
-- anonymously and Postgres' generated name is predictable; `if exists` keeps
-- this safe on a database where it was named something else.
drop index if exists email_outbox_sent_at_created_at_idx;
create index on email_outbox (sent_at nulls first, deliver_after);

-- Claim due emails atomically, the same way deliveries are claimed.
--
-- This is not only about the cron racing a request. `drainAfterResponse` fires
-- on every post, vote-notification and changelog publish, so two overlapping
-- requests could previously select the same unsent row and both send it —
-- which for a magic link means two links, and for a ship notification means
-- the same person told twice. `for update skip locked` plus the attempt
-- increment makes a row claimable exactly once.
create or replace function claim_queued_emails(p_limit int default 50)
returns table (
  id       uuid,
  to_email text,
  subject  text,
  body     text,
  kind     text,
  attempts int
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select e.id
    from email_outbox e
    where e.sent_at is null
      and e.deliver_after <= now()
      and e.attempts < 5
    order by e.deliver_after
    limit p_limit
    for update skip locked
  )
  update email_outbox e
  set attempts = e.attempts + 1
  from due
  where e.id = due.id
  returning e.id, e.to_email, e.subject, e.body, e.kind, e.attempts;
$$;

-- The outbox runs as the service role and nobody else has a reason to read an
-- unsent email, which may hold a sign-in link.
revoke all on function claim_queued_emails(int) from public, anon, authenticated;
grant execute on function claim_queued_emails(int) to service_role;
