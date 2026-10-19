-- Server errors, kept where the rest of the operational state already lives.
--
-- Until now a production failure was visible only in Vercel's log tail: a
-- broken provider fetch, a webhook throwing, a server action failing for one
-- founder. Logs are fine for a failure you already know about and useless for
-- the one nobody noticed, because nothing counts, groups or keeps them.
--
-- GROUPING IS THE POINT, NOT STORAGE
--
-- One row per occurrence would be a log with extra steps. What makes this
-- answerable is the fingerprint: the same error from the same place collapses
-- into one row with a count and a last-seen, so "what is broken right now" is
-- a short list rather than a scroll. That is the one thing a log tail cannot
-- do and the only reason this table earns its place.
--
-- It is deliberately less than Sentry. No source maps, no release tracking, no
-- alerting, no breadcrumbs. The trade being made is one place and one bill
-- against a worse tool -- see ROADMAP.md, where that decision is recorded.

create table error_events (
  -- The fingerprint is the primary key, so an occurrence is an upsert rather
  -- than an insert and the table cannot grow faster than the number of
  -- distinct faults.
  fingerprint text primary key,
  -- What it was, for reading. Truncated by the writer: a stack trace is
  -- useful for the first few frames and noise afterwards.
  kind        text not null,
  message     text not null,
  route       text,
  stack       text,
  count       int  not null default 1 check (count > 0),
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now(),
  -- Marked done by hand. Reopens on its own if the same fault comes back,
  -- which is what makes it safe to resolve something optimistically.
  resolved_at timestamptz
);

create index error_events_recent_idx on error_events (last_seen desc);
create index error_events_open_idx on error_events (last_seen desc) where resolved_at is null;

alter table error_events enable row level security;
-- No policies. An error carries request paths and failure detail from every
-- workspace, so it belongs to the operator and not to any founder. The admin
-- page reads it with the service role behind its own allow-list.

/*
  Record one occurrence.

  An upsert rather than an insert, keyed on the fingerprint the caller
  computes. `count` goes up, `last_seen` moves, `first_seen` does not, and a
  previously resolved fault reopens -- a fault that comes back was not fixed,
  and silently leaving it resolved is how a regression hides.

  The message and stack are overwritten with the newest ones rather than kept
  from the first, because the most recent occurrence is the one somebody is
  about to go and look at.
*/
create or replace function record_error(
  p_fingerprint text,
  p_kind        text,
  p_message     text,
  p_route       text,
  p_stack       text
) returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into error_events (fingerprint, kind, message, route, stack)
  values (p_fingerprint, p_kind, p_message, p_route, p_stack)
  on conflict (fingerprint) do update
    set count       = error_events.count + 1,
        last_seen   = now(),
        message     = excluded.message,
        stack       = excluded.stack,
        route       = coalesce(excluded.route, error_events.route),
        resolved_at = null;
end;
$$;

revoke all on function record_error(text, text, text, text, text)
  from public, anon, authenticated;
grant execute on function record_error(text, text, text, text, text) to service_role;

-- Drop faults nobody has seen in a while and that were dealt with. Called from
-- the same cron that prunes rate limits. Unresolved ones are kept however old,
-- because an old unresolved fault is a thing still broken.
create or replace function prune_error_events(p_keep interval default interval '30 days')
returns int
language plpgsql
set search_path = public
as $$
declare v_deleted int;
begin
  delete from error_events
   where resolved_at is not null and last_seen < now() - p_keep;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function prune_error_events(interval) from public, anon, authenticated;
grant execute on function prune_error_events(interval) to service_role;
