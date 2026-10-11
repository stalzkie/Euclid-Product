-- Integrations (PRD P1): post new feedback to Slack or Discord, and export a
-- post to GitHub or Linear.
--
-- Two shapes, because they are two different jobs. Chat notifications are
-- events the board pushes out, so they go through an outbox and are delivered
-- by the queue — a slow webhook must never slow down a visitor's submission.
-- Issue export is something a founder does deliberately to one post, so it is
-- a synchronous action that hands back the issue URL.

create type integration_kind as enum ('slack', 'discord', 'github', 'linear');

create table integrations (
  id                uuid primary key default gen_random_uuid(),
  board_id          uuid not null references boards(id) on delete cascade,
  kind              integration_kind not null,
  -- Secrets live here: webhook URLs and API tokens. Never selected into the
  -- browser; the dashboard is shown a redacted summary instead.
  config            jsonb not null default '{}'::jsonb,
  events            text[] not null default array['post.created', 'post.status_changed'],
  active            boolean not null default true,
  last_delivered_at timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  -- One of each kind per board. Reconnecting replaces rather than accumulates.
  unique (board_id, kind)
);
create index on integrations (board_id);

create table integration_deliveries (
  id             uuid primary key default gen_random_uuid(),
  integration_id uuid not null references integrations(id) on delete cascade,
  event          text not null,
  payload        jsonb not null,
  attempts       int not null default 0,
  deliver_after  timestamptz not null default now(),
  delivered_at   timestamptz,
  last_error     text,
  created_at     timestamptz not null default now()
);
create index on integration_deliveries (delivered_at nulls first, deliver_after);

-- Where a post was exported to, so the dashboard can link out and refuse to
-- open a second issue for the same post.
alter table posts add column external_url  text;
alter table posts add column external_kind integration_kind;

alter table integrations enable row level security;
alter table integration_deliveries enable row level security;

-- Members may see that an integration exists and remove it. The config column
-- is readable by them too — they own these credentials — but the server never
-- sends it to the browser.
create policy integrations_member_all on integrations
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

-- Deliveries carry no policy at all: the queue runs as the service role, and
-- nobody else has a reason to read an undelivered webhook payload.

-- Claim a batch of due deliveries without two workers taking the same row.
create or replace function claim_integration_deliveries(p_limit int default 20)
returns table (
  id uuid,
  integration_id uuid,
  kind integration_kind,
  config jsonb,
  event text,
  payload jsonb,
  attempts int
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select d.id
    from integration_deliveries d
    join integrations i on i.id = d.integration_id
    where d.delivered_at is null
      and d.deliver_after <= now()
      and d.attempts < 5
      and i.active
    order by d.deliver_after
    limit p_limit
    for update of d skip locked
  )
  update integration_deliveries d
  set attempts = d.attempts + 1
  from due, integrations i
  where d.id = due.id and i.id = d.integration_id
  returning d.id, d.integration_id, i.kind, i.config, d.event, d.payload, d.attempts;
$$;

revoke all on function claim_integration_deliveries(int) from public, anon, authenticated;
grant execute on function claim_integration_deliveries(int) to service_role;
