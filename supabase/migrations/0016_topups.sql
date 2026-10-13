-- Top-ups: one-time purchases that extend an allowance without moving a plan.
--
-- Two balances on the workspace, and a ledger of what was bought.
--
-- The balances are separate columns rather than a larger limit because they
-- behave differently in time. `prompts_used` and `chat_credits_used` are reset
-- by roll_usage_period on the first visit of each month; these are not, because
-- a founder paid cash for them. Modelled as "+250 to the monthly allowance" a
-- top-up would quietly re-grant itself every month forever.
--
-- roll_usage_period needs no change: it only ever touched the two used columns,
-- so carry-over is what already happens.

alter table workspaces add column extra_prompts      int not null default 0;
alter table workspaces add column extra_chat_credits int not null default 0;

-- The ledger. Its real job is idempotency.
--
-- Polar retries a webhook until it gets a 2xx, and it sent three events for a
-- single subscription state change during testing -- so an order arriving twice
-- is the expected case, not an edge one. `polar_order_id` is unique, and
-- apply_topup only credits the workspace when the insert actually inserted. The
-- rest is an audit trail: a founder asking "what did I buy and when" should be
-- answerable without reading Polar's dashboard.
create table credit_topups (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  polar_order_id text not null unique,
  kind           text not null check (kind in ('prompts', 'credits')),
  quantity       int  not null check (quantity > 0),
  created_at     timestamptz not null default now()
);

create index on credit_topups (workspace_id, created_at desc);

alter table credit_topups enable row level security;

-- Members may read their own workspace's purchase history; nobody may write it
-- from a session. Granting a balance is the service role's job alone, the same
-- rule apply_subscription follows -- a second path into billing that a browser
-- could reach would be a way to grant yourself credit.
create policy credit_topups_member_read on credit_topups
  for select using (is_member(workspace_id));

-- Apply one purchased pack, exactly once.
--
-- Returns true when it granted and false when the order had already been
-- applied, so the webhook can tell "done" from "done again" and say which in
-- its log without that difference mattering to the response.
create or replace function apply_topup(
  p_workspace uuid,
  p_order_id  text,
  p_kind      text,
  p_quantity  int
) returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  granted int;
begin
  if p_quantity <= 0 then
    raise exception 'apply_topup: quantity must be positive, got %', p_quantity;
  end if;

  insert into credit_topups (workspace_id, polar_order_id, kind, quantity)
  values (p_workspace, p_order_id, p_kind, p_quantity)
  on conflict (polar_order_id) do nothing;

  -- row_count is 0 when the unique order id already existed, which is the
  -- retry case: the ledger row stands and the balance must not move again.
  get diagnostics granted = row_count;
  if granted = 0 then
    return false;
  end if;

  if p_kind = 'prompts' then
    update workspaces set extra_prompts = extra_prompts + p_quantity
     where id = p_workspace;
  elsif p_kind = 'credits' then
    update workspaces set extra_chat_credits = extra_chat_credits + p_quantity
     where id = p_workspace;
  else
    raise exception 'apply_topup: unknown kind %', p_kind;
  end if;

  return true;
end;
$$;

revoke all on function apply_topup(uuid, text, text, int) from public, anon, authenticated;
grant execute on function apply_topup(uuid, text, text, int) to service_role;
