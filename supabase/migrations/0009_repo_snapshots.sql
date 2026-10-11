-- Read-only repository context for Build Prompt (PRD P2).
--
-- The PRD names "generic or wrong prompts without repo context" as a risk to
-- founder trust. A prompt that can name real files is worth far more than one
-- that has to say "the relevant file", and a stored snapshot means generating
-- a prompt does not wait on GitHub.

create table repo_snapshots (
  board_id   uuid primary key references boards(id) on delete cascade,
  repo       text not null,
  branch     text not null,
  -- Paths only. No file contents are read, stored, or sent to a model.
  paths      text[] not null default '{}',
  file_count int not null default 0,
  truncated  boolean not null default false,
  fetched_at timestamptz not null default now(),
  last_error text
);

alter table repo_snapshots enable row level security;

create policy repo_snapshots_member_all on repo_snapshots
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));
