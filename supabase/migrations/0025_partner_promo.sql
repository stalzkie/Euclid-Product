-- The Bernn half of the "4 months for the price of 3" promotion.
--
-- Euclid's half is a Polar discount and needs no schema: 25% off, duration
-- repeating, four months, restricted to Indie Monthly. Polar has no four-month
-- interval and a repeating discount applies the same percentage every period,
-- so "pay three, get the fourth free" is not expressible as a subscription --
-- $9 x 4 is the same $36 and the same promise, said in the form Polar can
-- actually bill.
--
-- The Bernn half is a promo code, because Bernn already works that way: its
-- `promo_codes` table is single-use with a `trial_days` column, redeemed at
-- POST /users/:id/redeem-promo-code, and EntitlementsRepository.get() reverts
-- the entitlement to free once trial_ends_at passes. Nothing needs building on
-- that side. What is needed here is somewhere to keep codes minted in advance
-- and a way to hand exactly one to each qualifying workspace.
--
-- A POOL, NOT AN API CALL
--
-- Euclid could ask Bernn for a code at the moment it is needed. It does not,
-- because that puts a second service on the critical path of a paid webhook:
-- if Bernn is down when Polar delivers order.paid, either the webhook fails
-- and Polar retries for hours, or the founder silently never gets their code.
-- Codes minted ahead of time and handed out from a table need neither service
-- to be up at the same moment, and the only failure left is running out --
-- which is visible, and recoverable, in a way a missed webhook is not.

create table partner_codes (
  code       text primary key,
  -- Named rather than assumed, so a second partner later is a row and not a
  -- migration. 'bernn' is the only one today.
  partner    text not null,
  trial_days int  not null check (trial_days > 0),
  created_at timestamptz not null default now()
);

create index partner_codes_partner_idx on partner_codes (partner, created_at);

alter table partner_codes enable row level security;
-- No policy at all: unclaimed codes are inventory, and a founder able to read
-- this table could read codes that are not theirs. The service role mints and
-- claims; a founder only ever sees the one in their own grant row.

create table partner_grants (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  partner        text not null,
  /*
    Nullable on purpose, and this is the interesting part.

    If the pool is empty when a founder qualifies, the alternative to a null
    here is dropping the obligation on the floor: they paid, the promotion
    promised them a month of Bernn, and nothing would record that they are
    owed one. A grant row with no code is an IOU that `fill_partner_grants`
    settles as soon as codes are added, and it is also the thing to count when
    asking whether the pool needs topping up.
  */
  code           text references partner_codes(code),
  -- The order that earned it. Audit only -- the uniqueness that matters is
  -- one grant per workspace, not one per order.
  polar_order_id text,
  created_at     timestamptz not null default now(),
  filled_at      timestamptz,
  -- One code per workspace per partner, ever. A founder who resubscribes does
  -- not get a second month of Bernn, and a webhook Polar delivers three times
  -- grants once without needing an idempotency key of its own.
  unique (workspace_id, partner)
);

-- A code belongs to one grant. Partial, because null means "owed" and several
-- workspaces may be owed at the same time.
create unique index partner_grants_code_idx on partner_grants (code) where code is not null;

create index partner_grants_unfilled_idx on partner_grants (created_at) where code is null;

alter table partner_grants enable row level security;

create policy partner_grants_member_read on partner_grants
  for select using (is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Claiming
-- ---------------------------------------------------------------------------

-- Hand this workspace its code, minting the grant if there is not one yet.
--
-- Returns the code, or null when the workspace is owed one the pool could not
-- cover. Both are success: the caller is a webhook, and a 5xx over an empty
-- pool would make Polar retry a payment that was processed perfectly well.
--
-- Shaped like grant_referral_commission and apply_topup -- look for the
-- existing row first, act only if there is not one -- because it faces the
-- same problem they do: Polar sent three events for one state change during
-- testing, so the same order arriving twice is expected rather than an edge.
create or replace function claim_partner_code(
  p_workspace uuid,
  p_partner   text,
  p_order_id  text
) returns text
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

  -- Already granted, or already owed. Either way this workspace is settled
  -- and a replay must not consume a second code.
  if found then
    return v_existing.code;
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

  return v_code;
end;
$$;

revoke all on function claim_partner_code(uuid, text, text) from public, anon, authenticated;
grant execute on function claim_partner_code(uuid, text, text) to service_role;

-- ---------------------------------------------------------------------------
-- Settling the IOUs
-- ---------------------------------------------------------------------------

-- Give a code to everyone who qualified while the pool was empty, oldest
-- first. Returns how many it settled, so the job that calls it can report
-- "nothing to do" distinctly from not having run.
create or replace function fill_partner_grants(p_partner text, p_limit int default 100)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_grant  partner_grants%rowtype;
  v_code   text;
  v_filled int := 0;
begin
  for v_grant in
    select * from partner_grants
     where partner = p_partner and code is null
     order by created_at
     limit p_limit
  loop
    select pc.code into v_code
      from partner_codes pc
     where pc.partner = p_partner
       and not exists (select 1 from partner_grants g where g.code = pc.code)
     order by pc.created_at
     limit 1
     for update skip locked;

    -- Pool exhausted again; the rest stay owed rather than erroring.
    exit when v_code is null;

    update partner_grants
       set code = v_code, filled_at = now()
     where id = v_grant.id;
    v_filled := v_filled + 1;
  end loop;

  return v_filled;
end;
$$;

revoke all on function fill_partner_grants(text, int) from public, anon, authenticated;
grant execute on function fill_partner_grants(text, int) to service_role;

-- How much inventory is left, for the low-water warning: codes nobody holds,
-- and workspaces still waiting on one.
create or replace function partner_pool_status(p_partner text)
returns table (available int, owed int)
language sql
stable
security definer
set search_path = public
as $$
  select
    (select count(*)::int from partner_codes pc
      where pc.partner = p_partner
        and not exists (select 1 from partner_grants g where g.code = pc.code)),
    (select count(*)::int from partner_grants g
      where g.partner = p_partner and g.code is null);
$$;

revoke all on function partner_pool_status(text) from public, anon, authenticated;
grant execute on function partner_pool_status(text) to service_role;
