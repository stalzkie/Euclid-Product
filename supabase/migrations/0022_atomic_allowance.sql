-- Metering AI usage in one statement instead of three.
--
-- Both AI paths read a snapshot, called the model, then wrote an *absolute*
-- value back:
--
--   const spent = spendAllowance({ used: ctx.workspace.prompts_used, ... });
--   await db.from("workspaces").update({ prompts_used: spent.used })
--
-- `ctx.workspace.prompts_used` was read when the request started, so twenty
-- concurrent generations all read 0 and all wrote 1. Twenty model calls, one
-- counted. This is not a boundary race that over-grants by one -- it is
-- last-write-wins on a counter, so the monthly allowance stopped bounding
-- anything at all for anyone willing to open tabs. The cost is real: a Build
-- Prompt is about $0.034 and an Ask Euclid question four to seven credits.
--
-- The fix is to do the arithmetic where the current value can be seen. The
-- row is locked with `for update` -- the same thing reverse_topup does, for
-- the same reason -- so concurrent callers serialise and each one's increment
-- is applied to the value the previous one left behind.
--
-- The limit is a parameter rather than read from a plan table in here. PLANS
-- in src/lib/plans.ts is the one place pricing lives, tests cover it, and a
-- second copy in SQL would be a second thing to forget on a pricing change.
--
-- WHAT THIS DELIBERATELY DOES NOT DO
--
-- It is an accountant, not a gate. The call sites still decide whether to do
-- the work, by checking the allowance they already hold, and this records what
-- was spent afterwards. So the boundary is still soft: at used=49 of 50,
-- twenty simultaneous requests all pass their own check and nineteen of them
-- are not paid for. That is bounded -- nineteen prompts is about $0.65, once,
-- and only for someone deliberately racing it -- where the bug above was
-- unbounded. Closing it completely means gating inside this function and
-- reserving before the model call, which needs a refund path for every way a
-- generation can fail. A per-minute ceiling on the AI actions is the cheaper
-- half of that and is the next migration.
--
-- The floor on `extra` is kept from the TypeScript it replaces: a question
-- that costs more credits than remain is allowed to finish rather than being
-- killed mid-answer.

create or replace function spend_allowance(
  p_workspace uuid,
  p_kind      text,
  p_cost      int,
  p_limit     int
) returns table (used int, extra int)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_used     int;
  v_extra    int;
  v_from_plan  int;
  v_from_extra int;
begin
  if p_cost <= 0 then
    raise exception 'spend_allowance: cost must be positive, got %', p_cost;
  end if;
  if p_limit < 0 then
    raise exception 'spend_allowance: limit cannot be negative, got %', p_limit;
  end if;
  if p_kind not in ('prompts', 'credits') then
    raise exception 'spend_allowance: unknown kind %', p_kind;
  end if;

  -- Definer, and the workspace arrives as a parameter, so this check is the
  -- only thing standing between a signed-in stranger and someone else's
  -- monthly allowance. Without it this function is a way to burn a
  -- competitor's Build Prompts to zero from any account, which would make it
  -- a griefing tool rather than a guard rail. Same shape and errcode as
  -- ensure_referral_code and referral_stats.
  if not is_member(p_workspace) then
    raise exception 'not a member of %', p_workspace using errcode = '42501';
  end if;

  -- The lock is the whole point. Without it this is the same read-then-write
  -- the TypeScript was doing, only further from the call site.
  if p_kind = 'prompts' then
    select w.prompts_used, w.extra_prompts into v_used, v_extra
      from workspaces w where w.id = p_workspace for update;
  else
    select w.chat_credits_used, w.extra_chat_credits into v_used, v_extra
      from workspaces w where w.id = p_workspace for update;
  end if;

  if not found then
    raise exception 'spend_allowance: no workspace %', p_workspace;
  end if;

  -- The monthly allowance first, the purchased balance only once it is gone.
  -- Mirrors spendAllowance() in src/lib/plans.ts, which keeps the argument for
  -- the ordering: the plan's allowance expires at the end of the month and a
  -- bought balance does not, so spending the perishable one first is what the
  -- founder would choose if asked.
  v_from_plan  := greatest(0, least(p_cost, p_limit - v_used));
  v_from_extra := p_cost - v_from_plan;

  if p_kind = 'prompts' then
    update workspaces
       set prompts_used  = v_used + v_from_plan,
           extra_prompts = greatest(0, v_extra - v_from_extra)
     where id = p_workspace;
  else
    update workspaces
       set chat_credits_used  = v_used + v_from_plan,
           extra_chat_credits = greatest(0, v_extra - v_from_extra)
     where id = p_workspace;
  end if;

  -- Computed rather than read back with RETURNING. The row is still locked by
  -- the select above, so a re-read could only return these same two numbers,
  -- and writing it this way keeps the arithmetic in one place to check.
  used  := v_used + v_from_plan;
  extra := greatest(0, v_extra - v_from_extra);
  return next;
end;
$$;

-- The founder's own session spends their own allowance, so `authenticated` is
-- the role that needs it. `is_member` above is what makes that safe.
--
-- Not granted to service_role, which would not pass that check anyway:
-- `auth.uid()` is null on a service-role connection, so is_member is false.
-- A background job that one day needs to meter usage wants a separate
-- function with its own authorisation, not this one with the check removed.
--
-- Note the asymmetry with apply_topup, which is service_role only: that one
-- *grants* balance and must never be reachable from a browser. This one can
-- only consume, which is why a session may call it at all.
revoke all on function spend_allowance(uuid, text, int, int) from public, anon, service_role;
grant execute on function spend_allowance(uuid, text, int, int) to authenticated;
