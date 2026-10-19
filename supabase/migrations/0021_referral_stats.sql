-- The two numbers the referral section shows, read where they can be seen.
--
-- `referralState` counted referred workspaces with the founder's own session
-- client:
--
--   db.from("workspaces").select("id", { count: "exact", head: true })
--     .eq("referred_by", code)
--
-- which can only ever return zero. `workspaces_read` is `using (is_member(id))`
-- (0003_rls.sql), so that query sees exactly one row -- the founder's own --
-- and their own `referred_by` holds whoever referred *them*, never their own
-- code. `create_workspace` gives each user one membership, so there is no
-- arrangement in which a founder is a member of a workspace they referred.
-- The count was structurally 0 rather than occasionally wrong, which is why
-- nothing looked broken: a new referrer's real total is also 0.
--
-- Counting rows RLS hides is the same problem `ensure_referral_code` already
-- solved by being a definer, so this is the same answer. It is a new function
-- rather than a wider `ensure_referral_code` because changing that signature
-- means dropping and recreating it, and 0020 has the whole argument for why a
-- signature change is the thing to avoid mid-deploy.
--
-- The workspace is the parameter and the code is looked up from it, instead of
-- taking the code directly. A caller holding somebody else's code -- they are
-- shared in public, that is their job -- must not be able to ask this how well
-- it is doing.

create or replace function referral_stats(p_workspace uuid)
returns table (signups int, earned int)
language plpgsql
security definer
set search_path = public
as $$
begin
  -- Definer, so the membership check is the authorisation and has to be here.
  -- Same shape and same errcode as ensure_referral_code.
  if not is_member(p_workspace) then
    raise exception 'not a member of %', p_workspace using errcode = '42501';
  end if;

  return query
  select
    (
      select count(*)
        from workspaces w
        join referral_codes rc on rc.code = w.referred_by
       where rc.workspace_id = p_workspace
    )::int,
    (
      -- Reversed rows stay in the ledger and are excluded from the total, so
      -- this is what the founder actually has rather than what a since-refunded
      -- order once promised them. coalesce because a referrer with no paid
      -- orders yet must read 0, not null.
      select coalesce(sum(c.quantity), 0)
        from referral_commissions c
       where c.referrer_id = p_workspace
         and c.reversed_at is null
    )::int;
end;
$$;

-- The founder's own session calls this. Safe to hand to `authenticated`
-- because the only workspace it will answer about is one they belong to.
revoke all on function referral_stats(uuid) from public, anon;
grant execute on function referral_stats(uuid) to authenticated, service_role;
