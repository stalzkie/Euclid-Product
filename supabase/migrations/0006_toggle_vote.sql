-- Voting was three round trips: look for an existing vote, insert or delete it,
-- then read back the trigger-maintained count. Between the write and the read
-- the client sees a count that may not include its own vote yet, which reads to
-- a user as "I voted and the number didn't move".
--
-- One function, one transaction, one round trip. The returned count is the
-- count after this change, by construction.
create or replace function toggle_vote(
  p_post uuid,
  p_user uuid,
  p_weight numeric default 1
)
returns table (voted boolean, vote_count integer, weighted_score numeric)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing uuid;
  v_voted boolean;
begin
  -- Serialise concurrent toggles of the same post by the same visitor, so a
  -- double-tap cannot insert twice or read a half-applied state.
  perform pg_advisory_xact_lock(hashtextextended(p_post::text || p_user::text, 0));

  select id into v_existing
  from votes
  where post_id = p_post and end_user_id = p_user;

  if v_existing is not null then
    delete from votes where id = v_existing;
    v_voted := false;
  else
    insert into votes (post_id, end_user_id, weight)
    values (p_post, p_user, p_weight);
    v_voted := true;
  end if;

  -- Read in the same transaction as the write, after the trigger has run.
  return query
    select v_voted, p.vote_count, p.weighted_score
    from posts p
    where p.id = p_post;
end;
$$;

revoke all on function toggle_vote(uuid, uuid, numeric) from public, anon, authenticated;
grant execute on function toggle_vote(uuid, uuid, numeric) to service_role;
