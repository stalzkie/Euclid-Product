-- ============================================================================
-- Euclid · 0005_match_counts
--
-- `match_posts` returned ids and similarity only, so every caller followed it
-- with a second query just to read the vote and comment counts it needs to
-- render a row. On a board whose database sits a continent away that second
-- round trip is the difference between a type-ahead that feels instant and one
-- that arrives after the person has already hit Post.
--
-- Returning the counts in the same call removes it.
-- ============================================================================

drop function if exists match_posts(uuid, vector, uuid, float, int);

create or replace function match_posts(
  p_board uuid,
  p_embedding vector(1536),
  p_exclude uuid default null,
  p_threshold float default 0.42,
  p_limit int default 5
)
returns table (
  id uuid,
  number int,
  title text,
  status post_status,
  vote_count int,
  comment_count int,
  similarity float
)
language sql stable as $$
  select p.id, p.number, p.title, p.status, p.vote_count, p.comment_count,
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
