-- What people did, as opposed to what they left behind.
--
-- Every other number on /admin is derived from state: a post is a row, an
-- install is a timestamp, a prompt is a record. That was a deliberate choice
-- and it still is -- see the note on `funnel()` in src/server/admin-model.ts --
-- because a derived figure cannot double-count, cannot miss an event because
-- a deploy went out mid-signup, and is retroactive to the first row ever
-- written.
--
-- It has one blind spot, and this table is exactly the size of it:
--
--   * Opening a screen leaves no row. "How many founders opened the designer"
--     was unanswerable, and so was "which screen do they go to after
--     onboarding".
--   * Abandoning a step leaves no row either. The activation funnel can say
--     three workspaces never finished onboarding; it cannot say which of the
--     three steps they stopped on, because an unfinished step writes nothing.
--   * An intent that is not yet an action leaves no row. Copying the install
--     snippet and never installing is the single most useful thing to know
--     about a stalled board, and `boards.installed_at` is null either way.
--
-- So: captured events, for the questions that state cannot answer, and
-- nothing else. Anything derivable stays derived -- there is no `post.created`
-- here, because `posts.created_at` already says it better and cannot
-- disagree with itself.
--
-- WHAT IS NOT TRUSTED
--
-- The client sends a name, a path and a few properties. It does not send who
-- it is, which workspace it belongs to, or when the event happened. The route
-- reads identity from the session and the database stamps the time, for the
-- same reason `0030_retry_on_the_db_clock` moved the retry schedule into SQL:
-- a value a client can choose is a value an operator cannot rely on.
--
-- The name is checked against a catalogue in src/lib/analytics/events.ts
-- before it is written, and the shape is checked again here. An open text
-- column would make this table a place anyone with a session could write
-- arbitrary strings, and would make the console unable to label its own rows.

create table analytics_events (
  id bigserial primary key,

  -- Dot-separated, lower case: `screen.designer`, `onboarding.install`.
  -- The catalogue is the real gate; this constraint is the floor under it.
  name text not null check (name ~ '^[a-z][a-z0-9_]*(\.[a-z0-9_]+){1,3}$'),

  -- Which surface sent it. 'dashboard' is the only one that captures today;
  -- the others exist so adding the widget later is a row and not a migration.
  source text not null default 'dashboard'
    check (source in ('dashboard', 'widget', 'board', 'server')),

  /*
    Who, as four nullable columns rather than one polymorphic pair.

    A founder event has a user and a workspace. A visitor event, when the
    widget starts capturing, will have a board and maybe an end user. A
    server-side event may have only a workspace. Nullable columns make each of
    those a legal row without a type discriminator nobody would keep correct.
  */
  user_id      uuid references auth.users(id) on delete set null,
  workspace_id uuid references workspaces(id) on delete cascade,
  board_id     uuid references boards(id) on delete set null,
  end_user_id  uuid references end_users(id) on delete set null,

  /*
    Where, as a route rather than a URL.

    Normalised before it is written: the query string is dropped and ids are
    replaced with placeholders, so `/posts/42?from=home` is stored as
    `/posts/:n`. Two reasons, and the second is the important one. Grouping:
    without it every post detail page is its own screen. Hygiene: a query
    string is where a token, an address or a promo code ends up, and an
    analytics table is the last place that should be kept.
  */
  path text,

  -- A per-tab id the client mints in `sessionStorage`. Enough to count
  -- sessions and order a visit's screens; not a cookie, not persistent, and
  -- useless for joining two visits together.
  session_id text,

  -- Small, flat, and scrubbed by the route: at most ten keys, no nested
  -- objects, nothing that looks like an e-mail address.
  props jsonb not null default '{}'::jsonb,

  -- The database's clock, never the client's.
  created_at timestamptz not null default now()
);

-- The console reads this four ways: newest first, by name, by workspace and
-- by person. One index each, all descending by time, because every panel is
-- "the last N days of" something.
create index analytics_events_recent_idx on analytics_events (created_at desc);
create index analytics_events_name_idx on analytics_events (name, created_at desc);
create index analytics_events_workspace_idx on analytics_events (workspace_id, created_at desc);
create index analytics_events_user_idx on analytics_events (user_id, created_at desc);

alter table analytics_events enable row level security;

-- No policies, exactly as `error_events` has none. This table spans every
-- workspace and is written by one route running as the service role; a
-- founder reading their own rows back would gain nothing and a founder
-- writing them would make the table worthless. /admin reads it behind the
-- ADMIN_EMAILS allow-list.

/*
  Keep it bounded.

  This is the first table in the schema that grows with *attention* rather
  than with intent -- a founder who reads six screens writes six rows and
  leaves no other trace -- so it is also the first that needs an answer to
  "and then what". The answer is a window, not an archive: behavioural
  questions are asked about the last few weeks, and a row from March answers
  nothing that `posts`, `boards` and `build_prompts` do not already answer
  better and permanently.

  180 days, pruned by the daily job. Returns the number deleted so the job's
  log says what it did.
*/
create or replace function prune_analytics_events(p_days int default 180)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  removed int;
begin
  delete from analytics_events
  where created_at < now() - make_interval(days => greatest(p_days, 1));
  get diagnostics removed = row_count;
  return removed;
end;
$$;

revoke all on function prune_analytics_events(int) from public, anon, authenticated;
grant execute on function prune_analytics_events(int) to service_role;
