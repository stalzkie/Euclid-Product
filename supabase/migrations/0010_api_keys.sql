-- API keys for the MCP server (PRD P2).
--
-- A coding agent needs to reach a board without a browser session, so it
-- carries a key. Only a hash is stored: a leaked database row must not be
-- usable as a credential, and nobody — us included — can read a key back
-- after it is issued.

create table api_keys (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references boards(id) on delete cascade,
  name         text not null default 'Coding agent',
  -- sha-256 of the token, hex. Never the token itself.
  token_hash   text not null unique,
  -- First characters, so a founder can tell two keys apart in the list.
  token_prefix text not null,
  created_at   timestamptz not null default now(),
  last_used_at timestamptz,
  revoked_at   timestamptz
);
create index on api_keys (board_id);

alter table api_keys enable row level security;

-- Members manage their board's keys. The hash is useless to them, which is
-- the point.
create policy api_keys_member_all on api_keys
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

-- Resolve a presented key to its board, and record the use. Runs as the
-- service role from the MCP endpoint.
create or replace function board_for_api_key(p_hash text)
returns table (board_id uuid, key_id uuid)
language plpgsql
security definer
set search_path = public
as $$
begin
  return query
  update api_keys k
  set last_used_at = now()
  where k.token_hash = p_hash and k.revoked_at is null
  returning k.board_id, k.id;
end;
$$;

revoke all on function board_for_api_key(text) from public, anon, authenticated;
grant execute on function board_for_api_key(text) to service_role;
