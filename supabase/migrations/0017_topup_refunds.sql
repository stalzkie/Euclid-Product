-- Reversing a top-up when Polar reports the order refunded.
--
-- Without this a refunded pack keeps its credit: `apply_topup` adds to a
-- balance and nothing ever subtracts. That is free money in the wrong
-- direction, and it only shows up once real cards are involved.
--
-- `refunded_at` is both the record and the idempotency key, the mirror of the
-- unique `polar_order_id` on the way in. Polar retries a webhook until it gets
-- a 2xx, so a refund arriving twice is expected, and reversing twice would
-- take the balance down by double what was granted.

alter table credit_topups add column refunded_at timestamptz;

-- Reverse one purchased pack, exactly once.
--
-- Returns true when it reversed, false when the order was unknown or had
-- already been reversed -- the same "done" versus "done again" distinction
-- apply_topup makes, so the webhook can log which without either being an
-- error.
create or replace function reverse_topup(p_order_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rec credit_topups%rowtype;
begin
  -- Locked, so two deliveries of the same refund cannot both pass the
  -- already-reversed check before either writes.
  select * into rec from credit_topups
   where polar_order_id = p_order_id
   for update;

  if not found or rec.refunded_at is not null then
    return false;
  end if;

  update credit_topups set refunded_at = now() where id = rec.id;

  /*
    Floored at zero rather than allowed to go negative.

    A founder who bought 50 prompts, used 30 and then refunded keeps the 30
    they have already spent -- there is no way to un-generate those briefs --
    and loses the 20 they had left. Going negative would instead hold their
    next purchase hostage to the old one, which is a worse answer to a
    situation they are allowed to be in. `spendAllowance` floors at zero for
    the same reason.
  */
  if rec.kind = 'prompts' then
    update workspaces
       set extra_prompts = greatest(0, extra_prompts - rec.quantity)
     where id = rec.workspace_id;
  elsif rec.kind = 'credits' then
    update workspaces
       set extra_chat_credits = greatest(0, extra_chat_credits - rec.quantity)
     where id = rec.workspace_id;
  else
    raise exception 'reverse_topup: unknown kind %', rec.kind;
  end if;

  return true;
end;
$$;

revoke all on function reverse_topup(text) from public, anon, authenticated;
grant execute on function reverse_topup(text) to service_role;
