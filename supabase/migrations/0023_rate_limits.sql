-- Making the rate limiter atomic, and usable outside a board.
--
-- Three separate faults in the original (0001_init.sql, 0002_functions.sql):
--
-- 1. IT COUNTED, THEN INSERTED. Two concurrent requests both read a count
--    below the ceiling and both inserted, so the limit was advisory. For
--    votes that is a rounding error; the moment anything expensive is put
--    behind it, it is the whole hole.
--
-- 2. IT SWEPT THE TABLE ON EVERY CALL. `delete from rate_limits where
--    created_at < now() - interval '1 day'` ran before every vote, post and
--    comment. That is a full scan per request, and it silently capped every
--    window at 24 hours -- ask for '7 days' and you quietly got one.
--
-- 3. IT WAS BOARD-SCOPED, with `board_id uuid not null`. Nothing outside a
--    board could use it at all, which is why requestStudentVerification grew
--    its own hand-rolled count against student_verifications instead. The AI
--    actions, the billing routes and the MCP endpoint had nothing available.
--
-- The lock is the fix for (1). An advisory transaction lock keyed on the
-- bucket serialises callers who share one, and nobody else -- a workspace
-- hammering its own AI limit does not slow down a stranger's votes. Taking a
-- row lock instead would need a row to exist first, which is the problem.

-- ---------------------------------------------------------------------------
-- Shape
-- ---------------------------------------------------------------------------

-- Workspace-scoped buckets need somewhere to hang. Both columns are nullable
-- and at least one must be set, rather than a single generic text key, so the
-- foreign keys and their cascades survive: rate limit rows for a deleted board
-- or workspace should go with it, not linger as orphans keyed on a stale id.
alter table rate_limits
  alter column board_id drop not null,
  add column workspace_id uuid references workspaces(id) on delete cascade,
  add constraint rate_limits_scoped check (board_id is not null or workspace_id is not null);

create index rate_limits_workspace_idx
  on rate_limits (workspace_id, bucket, actor, created_at desc)
  where workspace_id is not null;

-- ---------------------------------------------------------------------------
-- Board-scoped: the public widget API
-- ---------------------------------------------------------------------------

-- Called only by the service role, from the public API, which authorises per
-- board itself. Deliberately NOT security definer and deliberately not
-- reachable by `authenticated`: a signed-in stranger must not be able to burn
-- an end user's posting budget on someone else's board.
--
-- `p_window` keeps its position so every existing five-argument call site --
-- public-board.ts and the magic link route -- resolves unchanged.
create or replace function check_rate_limit(
  p_board uuid, p_bucket text, p_actor text,
  p_max int, p_window interval
) returns boolean
language plpgsql
set search_path = public
as $$
declare v_count int;
begin
  -- Serialise everyone sharing this exact bucket, and nobody else. Released
  -- at the end of the transaction, so there is nothing to unlock by hand.
  perform pg_advisory_xact_lock(
    hashtextextended(coalesce(p_board::text, '') || '|' || p_bucket || '|' || p_actor, 0)
  );

  select count(*) into v_count
    from rate_limits
   where board_id = p_board and bucket = p_bucket and actor = p_actor
     and created_at > now() - p_window;

  -- Recorded whether or not it is allowed, so a client that keeps hammering
  -- keeps extending its own lockout rather than getting a fresh allowance the
  -- moment the window rolls. Someone who hits the limit once and waits is
  -- unaffected. Unconditional, so there is one insert rather than one per
  -- branch that could drift apart.
  insert into rate_limits (board_id, bucket, actor) values (p_board, p_bucket, p_actor);

  return v_count < p_max;
end;
$$;

revoke all on function check_rate_limit(uuid, text, text, int, interval)
  from public, anon, authenticated;
grant execute on function check_rate_limit(uuid, text, text, int, interval) to service_role;

-- ---------------------------------------------------------------------------
-- Workspace-scoped: the dashboard
-- ---------------------------------------------------------------------------

-- A separate function rather than a nullable board on the one above, because
-- the two have different authorisation stories and merging them would mean
-- sniffing the caller's role inside the body to decide which applies. One
-- function, one answer to "who may call this".
--
-- Definer, so a founder's own session can write to a table RLS closes to it.
-- The is_member check is therefore load-bearing: without it this is a way to
-- exhaust another workspace's AI budget from any account, the same hole
-- spend_allowance would have had in 0022.
create or replace function check_workspace_rate_limit(
  p_workspace uuid, p_bucket text, p_actor text,
  p_max int, p_window interval
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare v_count int;
begin
  if not is_member(p_workspace) then
    raise exception 'not a member of %', p_workspace using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_workspace::text || '|' || p_bucket || '|' || p_actor, 0)
  );

  select count(*) into v_count
    from rate_limits
   where workspace_id = p_workspace and bucket = p_bucket and actor = p_actor
     and created_at > now() - p_window;

  insert into rate_limits (workspace_id, bucket, actor)
  values (p_workspace, p_bucket, p_actor);

  return v_count < p_max;
end;
$$;

revoke all on function check_workspace_rate_limit(uuid, text, text, int, interval)
  from public, anon;
grant execute on function check_workspace_rate_limit(uuid, text, text, int, interval)
  to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Cleanup, on the schedule instead of on the hot path
-- ---------------------------------------------------------------------------

-- Replaces the sweep that used to run before every vote. A day of retention
-- is kept from the original, but it is now a floor on how long a window may
-- be rather than an invisible ceiling: anything asking for a window longer
-- than this will read short, so raise it here before raising one there.
create or replace function prune_rate_limits(p_keep interval default interval '1 day')
returns int
language plpgsql
set search_path = public
as $$
declare v_deleted int;
begin
  delete from rate_limits where created_at < now() - p_keep;
  get diagnostics v_deleted = row_count;
  return v_deleted;
end;
$$;

revoke all on function prune_rate_limits(interval) from public, anon, authenticated;
grant execute on function prune_rate_limits(interval) to service_role;
