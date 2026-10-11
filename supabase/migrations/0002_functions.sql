-- ============================================================================
-- Euclid · 0002_functions
-- Counters, per-board post numbering, duplicate search, merge, and the
-- analytics aggregates the dashboard reads.
-- ============================================================================

-- ---------------------------------------------------------------------------
-- Board defaults. The design config shape is the single contract between the
-- designer screen and the widget, so it is seeded here rather than in app code.
-- ---------------------------------------------------------------------------
create or replace function default_board_design() returns jsonb
language sql immutable as $$
  select jsonb_build_object(
    'preset', 'minimal',
    'accent', '#17171A',
    'theme', 'Light',
    'radius', 'Soft',
    'mode', 'floating',
    'heading', 'What should we build next?',
    'subheading', 'Suggest an idea or vote on one. We read every post.',
    'submitCta', 'Post idea',
    'showStatuses', true,
    'showComments', true,
    'showChangelog', true,
    'showRoadmap', true,
    'showVoteCounts', true
  );
$$;

alter table boards alter column design set default default_board_design();

-- A short, URL-safe public id for the script tag.
create or replace function gen_public_id(prefix text) returns text
language sql volatile as $$
  select prefix || '_' || lower(
    translate(encode(gen_random_bytes(5), 'base64'), '+/=', 'xyz')
  );
$$;

create or replace function boards_before_insert() returns trigger
language plpgsql as $$
begin
  if new.public_id is null or new.public_id = '' then
    new.public_id := gen_public_id('brd');
  end if;
  if new.design = '{}'::jsonb then
    new.design := default_board_design();
  else
    new.design := default_board_design() || new.design;
  end if;
  return new;
end;
$$;

create trigger boards_before_insert
  before insert on boards
  for each row execute function boards_before_insert();

-- ---------------------------------------------------------------------------
-- Per-board post numbers. Posts are referred to as #142 everywhere in the UI,
-- so the number has to be board-scoped and gapless-enough to be readable.
-- ---------------------------------------------------------------------------
create or replace function posts_before_insert() returns trigger
language plpgsql as $$
begin
  if new.number is null or new.number = 0 then
    select coalesce(max(number), 0) + 1 into new.number
    from posts where board_id = new.board_id;
  end if;
  return new;
end;
$$;

create trigger posts_before_insert
  before insert on posts
  for each row execute function posts_before_insert();

create or replace function touch_updated_at() returns trigger
language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger posts_touch before update on posts
  for each row execute function touch_updated_at();
create trigger themes_touch before update on themes
  for each row execute function touch_updated_at();
create trigger changelog_touch before update on changelog_entries
  for each row execute function touch_updated_at();

-- ---------------------------------------------------------------------------
-- Vote and comment counters. Votes carry a weight so plan-weighted votes work
-- without a second code path; an unweighted board simply stores 1.
-- ---------------------------------------------------------------------------
create or replace function recount_post_votes(p_post uuid) returns void
language sql as $$
  update posts p
     set vote_count = coalesce((
           select round(sum(v.weight))
           from votes v
           join posts src on src.id = v.post_id
           -- Votes on merged posts count toward the post they merged into.
           where src.id = p.id or src.merged_into = p.id
         ), 0)
   where p.id = p_post;
$$;

create or replace function votes_after_change() returns trigger
language plpgsql as $$
declare
  v_post uuid := coalesce(new.post_id, old.post_id);
  v_target uuid;
begin
  perform recount_post_votes(v_post);
  select merged_into into v_target from posts where id = v_post;
  if v_target is not null then
    perform recount_post_votes(v_target);
  end if;
  return null;
end;
$$;

create trigger votes_after_change
  after insert or delete or update on votes
  for each row execute function votes_after_change();

create or replace function comments_after_change() returns trigger
language plpgsql as $$
declare v_post uuid := coalesce(new.post_id, old.post_id);
begin
  update posts p
     set comment_count = (
           select count(*) from comments c
           where c.post_id = p.id and c.internal = false
         )
   where p.id = v_post;
  return null;
end;
$$;

create trigger comments_after_change
  after insert or delete on comments
  for each row execute function comments_after_change();

-- ---------------------------------------------------------------------------
-- Duplicate detection. Returns the nearest posts by cosine distance, which is
-- what the submit-time nudge and the merge queue both consume.
-- ---------------------------------------------------------------------------
create or replace function match_posts(
  p_board uuid,
  p_embedding vector(1536),
  p_exclude uuid default null,
  p_threshold float default 0.78,
  p_limit int default 5
)
returns table (
  id uuid, number int, title text, status post_status,
  vote_count int, similarity float
)
language sql stable as $$
  select p.id, p.number, p.title, p.status, p.vote_count,
         1 - (p.embedding <=> p_embedding) as similarity
    from posts p
   where p.board_id = p_board
     and p.embedding is not null
     and p.merged_into is null
     and p.approved = true
     and (p_exclude is null or p.id <> p_exclude)
     and 1 - (p.embedding <=> p_embedding) >= p_threshold
   order by p.embedding <=> p_embedding
   limit p_limit;
$$;

-- ---------------------------------------------------------------------------
-- Merge. One click combines posts and their votes: the duplicate keeps its
-- row (so its permalink still resolves) and points at the survivor.
-- ---------------------------------------------------------------------------
create or replace function merge_posts(p_source uuid, p_target uuid)
returns void language plpgsql as $$
begin
  if p_source = p_target then
    raise exception 'cannot merge a post into itself';
  end if;

  -- Move votes that the target does not already have, so a voter who voted on
  -- both does not count twice.
  update votes v
     set post_id = p_target
   where v.post_id = p_source
     and not exists (
       select 1 from votes t
       where t.post_id = p_target and t.end_user_id = v.end_user_id
     );
  delete from votes where post_id = p_source;

  update comments set post_id = p_target where post_id = p_source;
  update posts set merged_into = p_target, theme_id = (
    select theme_id from posts where id = p_target
  ) where id = p_source;

  update duplicate_suggestions
     set state = 'merged'
   where (post_id = p_source and target_id = p_target)
      or (post_id = p_target and target_id = p_source);

  perform recount_post_votes(p_target);
end;
$$;

-- ---------------------------------------------------------------------------
-- Analytics. The Insights screen needs one series per day plus the KPI row;
-- doing it in SQL keeps the p95 board read well inside the 300 ms target.
-- ---------------------------------------------------------------------------
create or replace function board_daily_series(p_board uuid, p_days int default 30)
returns table (day date, votes bigint, posts bigint)
language sql stable as $$
  with days as (
    select generate_series(
      (current_date - (p_days - 1)), current_date, interval '1 day'
    )::date as day
  )
  select d.day,
         (select count(*) from votes v
            join posts p on p.id = v.post_id
           where p.board_id = p_board and v.created_at::date = d.day) as votes,
         (select count(*) from posts p
           where p.board_id = p_board and p.created_at::date = d.day) as posts
    from days d
   order by d.day;
$$;

-- Vote velocity: how many votes a post picked up in the last 7 days.
create or replace function post_vote_velocity(p_board uuid, p_days int default 7)
returns table (post_id uuid, recent bigint)
language sql stable as $$
  select p.id,
         count(v.id) filter (
           where v.created_at > now() - make_interval(days => p_days)
         )
    from posts p
    left join votes v on v.post_id = p.id
   where p.board_id = p_board
   group by p.id;
$$;

-- Share of a post's votes that come from paying segments. The JWT identity
-- mode writes a plan into end_users.segments; anonymous boards return 0.
create or replace function post_paying_share(p_post uuid)
returns numeric language sql stable as $$
  select case when count(*) = 0 then 0
         else round(
           100.0 * count(*) filter (
             where coalesce(eu.segments->>'plan', 'free') <> 'free'
           ) / count(*)
         ) end
    from votes v
    join end_users eu on eu.id = v.end_user_id
   where v.post_id = p_post;
$$;

create or replace function board_votes_by_plan(p_board uuid)
returns table (plan text, votes bigint)
language sql stable as $$
  select coalesce(initcap(eu.segments->>'plan'), 'Free') as plan, count(*)
    from votes v
    join posts p on p.id = v.post_id
    join end_users eu on eu.id = v.end_user_id
   where p.board_id = p_board
   group by 1
   order by 2 desc;
$$;

-- Median days from post to shipped, for the "Time to ship" KPI.
create or replace function board_time_to_ship(p_board uuid)
returns numeric language sql stable as $$
  select round(percentile_cont(0.5) within group (
           order by extract(epoch from (shipped_at - created_at)) / 86400
         )::numeric, 0)
    from posts
   where board_id = p_board and shipped_at is not null;
$$;

-- ---------------------------------------------------------------------------
-- Rate limiting. A board-scoped sliding window; the caller decides the budget.
-- ---------------------------------------------------------------------------
create or replace function check_rate_limit(
  p_board uuid, p_bucket text, p_actor text,
  p_max int, p_window interval
) returns boolean
language plpgsql as $$
declare v_count int;
begin
  delete from rate_limits
   where created_at < now() - interval '1 day';

  select count(*) into v_count
    from rate_limits
   where board_id = p_board and bucket = p_bucket and actor = p_actor
     and created_at > now() - p_window;

  if v_count >= p_max then
    return false;
  end if;

  insert into rate_limits (board_id, bucket, actor)
  values (p_board, p_bucket, p_actor);
  return true;
end;
$$;

-- ---------------------------------------------------------------------------
-- Monthly AI usage reset. Called on read so a dormant workspace still gets a
-- fresh allowance without a scheduled job.
-- ---------------------------------------------------------------------------
create or replace function roll_usage_period(p_workspace uuid)
returns void language plpgsql as $$
begin
  update workspaces
     set prompts_used = 0,
         chat_credits_used = 0,
         usage_period_start = date_trunc('month', now())::date
   where id = p_workspace
     and usage_period_start < date_trunc('month', now())::date;
end;
$$;
