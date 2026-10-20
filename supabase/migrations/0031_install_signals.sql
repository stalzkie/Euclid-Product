-- Why an install did not happen, kept next to the fact that it did not.
--
-- `0024_board_installed` records the moment the widget is first served to a
-- real page. That is the only thing the install screen has ever known, so a
-- founder whose install is broken sees one grey dot and no reason -- and the
-- reason was already computed, one line earlier, and thrown away.
--
-- Two things get discarded on the public board read:
--
--   * a request refused by the allow-list. The 403 goes back to the visitor's
--     browser console, which is the one place the founder will never look.
--   * a request from loopback. It is served, deliberately, and deliberately
--     does not count as an install -- so a founder watching the widget work
--     on localhost is simultaneously told it is not installed. Correct, and
--     baffling without a sentence explaining it.
--
-- AGGREGATED, LIKE error_events, AND FOR THE SAME REASON
--
-- One row per refused request would be a log, and a public endpoint anyone
-- can call is the last place to put an unbounded insert. The key is
-- (board, origin, reason), so a loop refused four hundred times is one row
-- with a count -- which is also the sentence the founder wants to read.

create table install_signals (
  board_id uuid not null references boards(id) on delete cascade,
  -- The hostname only, lowercased. Scheme and port tell a founder nothing
  -- they do not know and would split one broken deploy across several rows.
  origin   text not null,
  -- 'blocked': refused by the allow-list, and the actionable one.
  -- 'local':   served to loopback while the board is still being set up.
  reason   text not null check (reason in ('blocked', 'local')),
  count    int  not null default 1 check (count > 0),
  first_seen timestamptz not null default now(),
  last_seen  timestamptz not null default now(),
  primary key (board_id, origin, reason)
);

create index install_signals_board_idx on install_signals (board_id, last_seen desc);

alter table install_signals enable row level security;

-- Read-only to the founders of the board it belongs to. There is no write
-- policy on purpose: the only writer is the function below, running as the
-- service role on a public endpoint, and a founder has no reason to forge a
-- diagnosis of their own install.
create policy install_signals_read on install_signals
  for select using (can_touch_board(board_id));

/*
  Record one refused or local request.

  Update-then-insert rather than an upsert, because of the cap. A board can
  accumulate at most MAX_ORIGINS distinct origins; past that, requests from a
  known origin still count and a new origin is dropped on the floor.

  That cap is the whole reason this is a function and not an insert from the
  route. The board's public id is in the snippet on the founder's own site, so
  it is not a secret, and the endpoint that calls this is reachable by anyone
  with it: without a ceiling, a loop varying the Origin header writes a row
  per request forever. Ten is far more than a real diagnosis needs -- a broken
  install has one origin, a confusing one has two.
*/
create or replace function note_install_signal(
  p_board  uuid,
  p_origin text,
  p_reason text
) returns void
language plpgsql
security definer
set search_path = public
as $$
declare
  v_max_origins constant int := 10;
  v_distinct int;
begin
  update install_signals
     set count     = install_signals.count + 1,
         last_seen = now()
   where board_id = p_board
     and origin   = p_origin
     and reason   = p_reason;

  -- The common path by a wide margin: a broken install repeats itself.
  if found then
    return;
  end if;

  select count(distinct origin) into v_distinct
    from install_signals
   where board_id = p_board;

  if v_distinct >= v_max_origins then
    return;
  end if;

  -- `do nothing` rather than `do update`: two first requests racing each other
  -- is a tie worth losing, not an error worth failing a board read over.
  insert into install_signals (board_id, origin, reason)
  values (p_board, p_origin, p_reason)
  on conflict do nothing;
end;
$$;

revoke all on function note_install_signal(uuid, text, text)
  from public, anon, authenticated;
grant execute on function note_install_signal(uuid, text, text) to service_role;

-- Forget a diagnosis nobody has seen in a while. Called from the same cron as
-- prune_rate_limits and prune_error_events. Unlike an unresolved error, a
-- stale install signal is not worth keeping: the install either happened --
-- in which case the screen stops asking -- or the founder walked away.
create or replace function prune_install_signals(p_keep interval default interval '30 days')
returns int
language plpgsql
set search_path = public
as $$
declare v_deleted int;
begin
  delete from install_signals where last_seen < now() - p_keep;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function prune_install_signals(interval) from public, anon, authenticated;
grant execute on function prune_install_signals(interval) to service_role;
