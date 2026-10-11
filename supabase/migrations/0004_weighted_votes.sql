-- ============================================================================
-- Euclid · 0004_weighted_votes
--
-- Splits "how many people asked for this" from "how much demand this carries".
--
-- The PRD leaves one question open: how should plan-weighted votes be shown,
-- if at all, so end users do not feel ranked by payment? This is the answer:
--   · vote_count     — a headcount. One person, one vote. Shown everywhere an
--                      end user can see: the widget, the hosted board, emails.
--   · weighted_score — the sum of vote weights. Never shown to end users; it
--                      only orders the founder's inbox when the board knows
--                      who is paying.
--
-- So a Pro user's vote never makes the public number look inflated, and the
-- founder still sees which requests carry revenue behind them.
-- ============================================================================

alter table posts
  add column if not exists weighted_score numeric(10,2) not null default 0;

create index if not exists posts_weighted_idx
  on posts (board_id, weighted_score desc);

-- Recount both numbers in one pass. Votes on a post that was merged away still
-- count toward the post it merged into.
create or replace function recount_post_votes(p_post uuid) returns void
language sql as $$
  update posts p
     set vote_count = coalesce((
           select count(*)
           from votes v
           join posts src on src.id = v.post_id
           where src.id = p.id or src.merged_into = p.id
         ), 0),
         weighted_score = coalesce((
           select round(sum(v.weight), 2)
           from votes v
           join posts src on src.id = v.post_id
           where src.id = p.id or src.merged_into = p.id
         ), 0)
   where p.id = p_post;
$$;

-- Backfill everything that already exists.
do $$
declare r record;
begin
  for r in select id from posts loop
    perform recount_post_votes(r.id);
  end loop;
end;
$$;

-- ---------------------------------------------------------------------------
-- Ranking helper. A board that does not know who is paying has nothing to
-- weight by, so it falls back to the headcount and the two agree.
-- ---------------------------------------------------------------------------
create or replace function board_ranked_posts(
  p_board uuid,
  p_weighted boolean default false,
  p_limit int default 50
)
returns table (
  id uuid, number int, title text, status post_status,
  vote_count int, weighted_score numeric
)
language sql stable as $$
  select p.id, p.number, p.title, p.status, p.vote_count, p.weighted_score
    from posts p
   where p.board_id = p_board
     and p.merged_into is null
     and p.approved = true
   order by case when p_weighted then p.weighted_score else p.vote_count end desc
   limit p_limit;
$$;
