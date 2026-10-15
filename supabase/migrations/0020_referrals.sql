-- Referrals: who sent whom, and what the sender earned for it.
--
-- Polar has no affiliate features and does not pretend to -- it sells
-- checkout, billing and merchant-of-record tax handling and stops there. What
-- it does give is metadata that survives from checkout to order to
-- subscription, confirmed on this organisation's own live payloads, and that
-- is the whole attribution hook.
--
-- The reward is Euclid credit, not cash, and that is the deliberate part.
-- Polar is the merchant of record: money lands in Euclid's balance and Polar
-- pays out to Euclid alone. Paying third parties means a second rail entirely
-- -- PayPal, Wise, Stripe Connect -- plus identity collection, tax forms,
-- thresholds, currency handling and clawing a payout back when the order
-- behind it is refunded. Granting Build Prompts needs none of that and reuses
-- machinery that has already processed a real purchase and a real refund.
--
-- Everything here mirrors credit_topups on purpose. Same idempotency key
-- shape, same "did it grant or recognise a replay" return, same floor-at-zero
-- reversal. A refund arriving after a commission is granted is the case that
-- matters: an order refunded five minutes after payment is not hypothetical,
-- it happened on 2026-10-15 while testing.

-- ---------------------------------------------------------------------------
-- Codes
-- ---------------------------------------------------------------------------

-- One code per workspace, created on demand rather than for everybody: a code
-- nobody asked for is a row nobody uses, and the table is nicer to read when
-- every row means someone opened the referral section at least once.
create table referral_codes (
  code         text primary key check (code ~ '^[a-z0-9-]{4,32}$'),
  workspace_id uuid not null unique references workspaces(id) on delete cascade,
  created_at   timestamptz not null default now()
);

alter table referral_codes enable row level security;

-- A member reads their own workspace's code. Nobody writes one from a session:
-- codes are minted by a definer function so the uniqueness retry can see rows
-- the policies rightly hide, exactly as create_workspace does for slugs.
create policy referral_codes_member_read on referral_codes
  for select using (is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Attribution
-- ---------------------------------------------------------------------------

-- Deliberately `on delete set null`: if a referrer deletes their workspace the
-- referred one must survive, having done nothing wrong. The commission rows
-- cascade away with the referrer, which is right -- there is nobody left to
-- pay -- but the workspace they introduced stays.
alter table workspaces
  add column referred_by text references referral_codes(code) on delete set null,
  add column referred_at timestamptz;

create index workspaces_referred_by_idx on workspaces (referred_by)
  where referred_by is not null;

-- ---------------------------------------------------------------------------
-- The ledger
-- ---------------------------------------------------------------------------

create table referral_commissions (
  id             uuid primary key default gen_random_uuid(),
  code           text not null references referral_codes(code) on delete cascade,
  -- Both ends are recorded rather than derived through the code, because the
  -- question asked later is "what did this workspace earn" and answering it
  -- should not depend on a code that may since have been reassigned.
  referrer_id    uuid not null references workspaces(id) on delete cascade,
  referred_id    uuid not null references workspaces(id) on delete cascade,
  polar_order_id text not null unique,
  -- What was granted. Separate from credit_topups' own ledger because one
  -- order can pay a buyer's top-up and a referrer's commission, and a shared
  -- unique order id would make the second one look like a replay of the first.
  quantity       int  not null check (quantity > 0),
  -- The order total that earned it, in cents. Kept so the rate can change
  -- later without making old rows unexplainable.
  order_cents    int  not null check (order_cents >= 0),
  created_at     timestamptz not null default now(),
  reversed_at    timestamptz,
  check (referrer_id <> referred_id)
);

create index referral_commissions_referrer_idx
  on referral_commissions (referrer_id, created_at desc);

alter table referral_commissions enable row level security;

create policy referral_commissions_member_read on referral_commissions
  for select using (is_member(referrer_id));

-- ---------------------------------------------------------------------------
-- Minting a code
-- ---------------------------------------------------------------------------

-- Returns the workspace's code, creating it if there is not one yet.
--
-- Definer for the same reason create_workspace is: de-duplicating against
-- codes owned by other workspaces means reading rows RLS hides, and a caller
-- must not be able to learn whether someone else holds a code by watching this
-- succeed or fail.
create or replace function ensure_referral_code(p_workspace uuid, p_base text)
returns text
language plpgsql
security definer
set search_path = public
as $$
declare
  v_existing text;
  v_base     text;
  v_code     text;
  v_attempt  int := 0;
begin
  if not is_member(p_workspace) then
    raise exception 'not a member of %', p_workspace using errcode = '42501';
  end if;

  select code into v_existing from referral_codes where workspace_id = p_workspace;
  if v_existing is not null then
    return v_existing;
  end if;

  -- Squeeze the suggestion into the shape the check constraint allows, then
  -- fall back to something valid if nothing usable survives.
  v_base := lower(regexp_replace(coalesce(p_base, ''), '[^a-zA-Z0-9]+', '-', 'g'));
  v_base := trim(both '-' from v_base);
  v_base := left(v_base, 20);
  if length(v_base) < 4 then
    v_base := 'euclid';
  end if;

  v_code := v_base;
  while exists (select 1 from referral_codes rc where rc.code = v_code) loop
    v_attempt := v_attempt + 1;
    if v_attempt > 50 then
      raise exception 'could not mint a referral code for %', p_workspace;
    end if;
    v_code := left(v_base, 20) || '-' || substr(md5(random()::text), 1, 4);
  end loop;

  insert into referral_codes (code, workspace_id) values (v_code, p_workspace);
  return v_code;
end;
$$;

revoke all on function ensure_referral_code(uuid, text) from public, anon;
grant execute on function ensure_referral_code(uuid, text) to authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Granting and reversing
-- ---------------------------------------------------------------------------

-- Credit a referrer for one paid order, exactly once.
--
-- Returns true when it granted, false when the order had already been counted
-- or there was nobody to credit -- the same "done" versus "done again" the
-- top-up functions make, so the webhook can log which without either being an
-- error worth retrying.
create or replace function grant_referral_commission(
  p_referred   uuid,
  p_order_id   text,
  p_quantity   int,
  p_order_cents int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_code     text;
  v_referrer uuid;
  granted    int;
begin
  if p_quantity <= 0 then
    return false;
  end if;

  select w.referred_by into v_code from workspaces w where w.id = p_referred;
  if v_code is null then
    return false;
  end if;

  select rc.workspace_id into v_referrer from referral_codes rc where rc.code = v_code;
  -- Nobody to pay, or the code somehow points back at the buyer. The table
  -- constraint would refuse the second case anyway; refusing here keeps it a
  -- quiet no rather than an exception on a webhook Polar would then retry.
  if v_referrer is null or v_referrer = p_referred then
    return false;
  end if;

  insert into referral_commissions
    (code, referrer_id, referred_id, polar_order_id, quantity, order_cents)
  values
    (v_code, v_referrer, p_referred, p_order_id, p_quantity, p_order_cents)
  on conflict (polar_order_id) do nothing;

  get diagnostics granted = row_count;
  if granted = 0 then
    return false;
  end if;

  update workspaces set extra_prompts = extra_prompts + p_quantity
   where id = v_referrer;

  return true;
end;
$$;

revoke all on function grant_referral_commission(uuid, text, int, int)
  from public, anon, authenticated;
grant execute on function grant_referral_commission(uuid, text, int, int) to service_role;

-- Take it back when the order behind it is refunded.
--
-- Floored at zero, for the reason reverse_topup is: a referrer who has already
-- spent the prompts cannot un-generate the briefs, and holding their next
-- balance hostage to someone else's refund would be a worse answer than
-- letting the difference go.
create or replace function reverse_referral_commission(p_order_id text)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  rec referral_commissions%rowtype;
begin
  select * into rec from referral_commissions
   where polar_order_id = p_order_id
   for update;

  if not found or rec.reversed_at is not null then
    return false;
  end if;

  update referral_commissions set reversed_at = now() where id = rec.id;

  update workspaces
     set extra_prompts = greatest(0, extra_prompts - rec.quantity)
   where id = rec.referrer_id;

  return true;
end;
$$;

revoke all on function reverse_referral_commission(text) from public, anon, authenticated;
grant execute on function reverse_referral_commission(text) to service_role;

-- ---------------------------------------------------------------------------
-- Attribution at signup
-- ---------------------------------------------------------------------------

-- create_workspace gains the referring code, defaulted so the existing
-- six-argument call still resolves while a deploy is half-done -- the same
-- reason apply_subscription took a default in 0018.
--
-- An unknown or self-owned code is ignored rather than refused: a founder
-- mistyping a friend's code should still get a workspace.
-- The old six-argument signature is dropped rather than left beside this one.
-- A default does not create a second function: it makes the six-argument call
-- resolve against this one, which is what keeps a half-done deploy working.
-- Leaving both would make that call ambiguous and fail outright -- the same
-- reasoning as 0018.
drop function if exists create_workspace(text, text, text, text[], text, text);

create or replace function create_workspace(
  p_name          text,
  p_slug          text,
  p_domain        text,
  p_tools         text[],
  p_member_name   text,
  p_board_heading text,
  p_referred_by   text default null
)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user      uuid := auth.uid();
  v_workspace uuid;
  v_base      text;
  v_slug      text;
  v_attempt   int := 1;
  v_ref       text;
begin
  -- The caller is the owner, always. There is no argument for whose workspace
  -- this is, which is what makes it safe to hand to `authenticated`.
  if v_user is null then
    raise exception 'not signed in' using errcode = '42501';
  end if;

  if coalesce(trim(p_name), '') = '' then
    raise exception 'a workspace needs a name' using errcode = '22023';
  end if;

  -- Idempotent: a founder who double-submits, or comes back to step one, gets
  -- the workspace they already have rather than a second one. The app relies
  -- on a founder having exactly one membership.
  select wm.workspace_id into v_workspace
    from workspace_members wm
   where wm.user_id = v_user
   limit 1;

  if v_workspace is not null then
    return v_workspace;
  end if;

  -- Slug resolution that can actually see the collisions. The base is
  -- resolved once: deriving it inside the loop would turn an empty slug into
  -- a null one, and a null slug exits the loop and then fails the not-null
  -- constraint rather than being caught here.
  v_base := coalesce(nullif(trim(p_slug), ''), 'workspace');
  v_slug := v_base;

  while exists (select 1 from workspaces w where w.slug = v_slug) loop
    v_attempt := v_attempt + 1;
    v_slug := v_base || '-' || v_attempt::text;
    -- Somebody is either very unlucky or doing this on purpose; either way,
    -- stop counting and take a random suffix.
    if v_attempt > 50 then
      v_slug := v_base || '-' || substr(md5(gen_random_uuid()::text), 1, 6);
      exit;
    end if;
  end loop;

  -- An unknown or mistyped code is ignored rather than refused. Someone who
  -- fat-fingers a friend's code should still end up with a workspace; the
  -- referral is the part that is allowed to fail.
  select rc.code into v_ref
    from referral_codes rc
   where rc.code = lower(trim(coalesce(p_referred_by, '')));

  insert into workspaces (name, slug, plan, app_name, app_url, coding_tools,
                          referred_by, referred_at)
  values (
    trim(p_name),
    v_slug,
    'free',
    trim(p_name),
    case when coalesce(p_domain, '') = '' then null else 'https://' || p_domain end,
    coalesce(p_tools, '{}'::text[]),
    v_ref,
    case when v_ref is null then null else now() end
  )
  returning id into v_workspace;

  insert into workspace_members (workspace_id, user_id, role, name)
  values (v_workspace, v_user, 'owner', nullif(trim(coalesce(p_member_name, '')), ''));

  insert into project_profiles (workspace_id, stack)
  values (v_workspace, '[]'::jsonb);

  -- public_id and the design defaults are filled in by boards_before_insert.
  insert into boards (
    workspace_id, name, slug, color, identity_mode,
    allowed_domains, show_badge, design
  )
  values (
    v_workspace,
    'Feature requests',
    'feature-requests',
    '#1A8CFF',
    'email',
    case when coalesce(p_domain, '') = '' then '{}'::text[] else array[p_domain] end,
    true,
    case
      when coalesce(trim(p_board_heading), '') = '' then '{}'::jsonb
      else jsonb_build_object('heading', trim(p_board_heading))
    end
  );

  return v_workspace;
end;
$$;

-- The founder's own session calls this, so `authenticated` needs it. It is
-- safe to hand over because the owner is `auth.uid()` and not a parameter:
-- the worst a caller can do with it is create their own workspace, once.
revoke all on function create_workspace(text, text, text, text[], text, text, text)
  from public, anon;
grant execute on function create_workspace(text, text, text, text[], text, text, text)
  to authenticated, service_role;
