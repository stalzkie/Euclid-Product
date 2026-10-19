-- Let claim_partner_code say whether it granted or recognised a replay.
--
-- As written in 0025 it returned the code and nothing else, and returning the
-- *existing* grant's code on a replay is what makes it idempotent. The webhook
-- then did:
--
--     } else if (claim.code) {
--       await sendPartnerCode(buyer, claim.code);
--
-- so every redelivery of the same order sent the founder another copy of the
-- same email. The grant was idempotent; the notification was not. Polar sent
-- three events for one state change during testing, so that is three emails
-- for one purchase, and a resubscribe a year later is a fourth.
--
-- Confirmed live on 2026-10-19: one grant, one code consumed, two identical
-- "Your free month of Bernn" emails.
--
-- apply_topup and grant_referral_commission both already return "did I grant,
-- or did I recognise a replay" for exactly this reason. This should have been
-- written the same way the first time; the fix is to make it so.
--
-- The return type changes, so the old function has to go rather than be
-- replaced -- `create or replace` cannot change a signature. Nothing else
-- calls it.

drop function if exists claim_partner_code(uuid, text, text);

create or replace function claim_partner_code(
  p_workspace uuid,
  p_partner   text,
  p_order_id  text
) returns table (code text, granted boolean)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing partner_grants%rowtype;
  v_code     text;
begin
  select * into v_existing
    from partner_grants
   where workspace_id = p_workspace and partner = p_partner;

  -- Already granted, or already owed. Either way this workspace is settled:
  -- a replay must not consume a second code, and must not send a second
  -- email. `granted` false is what tells the caller which of those it is.
  if found then
    code := v_existing.code;
    granted := false;
    return next;
    return;
  end if;

  -- `skip locked` so two webhooks claiming at once take different codes
  -- rather than one waiting on the other and then failing the unique index.
  select pc.code into v_code
    from partner_codes pc
   where pc.partner = p_partner
     and not exists (select 1 from partner_grants g where g.code = pc.code)
   order by pc.created_at
   limit 1
   for update skip locked;

  insert into partner_grants (workspace_id, partner, code, polar_order_id, filled_at)
  values (p_workspace, p_partner, v_code, p_order_id,
          case when v_code is null then null else now() end);

  code := v_code;
  -- True even when the pool was empty and `code` is null. The grant is new
  -- either way, and the caller distinguishes "here is your code" from "you
  -- are owed one" by the code itself rather than by this flag.
  granted := true;
  return next;
end;
$$;

revoke all on function claim_partner_code(uuid, text, text) from public, anon, authenticated;
grant execute on function claim_partner_code(uuid, text, text) to service_role;
