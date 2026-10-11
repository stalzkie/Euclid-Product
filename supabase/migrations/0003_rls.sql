-- ============================================================================
-- Euclid · 0003_rls
-- Everything is workspace-scoped. The dashboard reads with the founder's
-- session; the widget and the hosted board read through the service role,
-- which bypasses RLS and does its own per-board authorisation in the API layer.
-- ============================================================================

alter table workspaces            enable row level security;
alter table workspace_members     enable row level security;
alter table project_profiles      enable row level security;
alter table boards                enable row level security;
alter table end_users             enable row level security;
alter table themes                enable row level security;
alter table posts                 enable row level security;
alter table votes                 enable row level security;
alter table comments              enable row level security;
alter table duplicate_suggestions enable row level security;
alter table build_prompts         enable row level security;
alter table build_prompt_messages enable row level security;
alter table changelog_entries     enable row level security;
alter table changelog_posts       enable row level security;
alter table chat_threads          enable row level security;
alter table chat_messages         enable row level security;
alter table recommendations       enable row level security;
alter table activity              enable row level security;
alter table rate_limits           enable row level security;
alter table email_outbox          enable row level security;
alter table magic_links           enable row level security;
alter table jobs                  enable row level security;

-- Is the caller a member of this workspace?
create or replace function is_member(p_workspace uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from workspace_members
    where workspace_id = p_workspace and user_id = auth.uid()
  );
$$;

-- Which workspace does this board belong to?
create or replace function board_workspace(p_board uuid) returns uuid
language sql stable security definer set search_path = public as $$
  select workspace_id from boards where id = p_board;
$$;

create or replace function can_touch_board(p_board uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select is_member(board_workspace(p_board));
$$;

create or replace function can_touch_post(p_post uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select can_touch_board((select board_id from posts where id = p_post));
$$;

-- ---------------------------------------------------------------------------
-- Workspace and membership
-- ---------------------------------------------------------------------------
create policy workspaces_read on workspaces
  for select using (is_member(id));
create policy workspaces_write on workspaces
  for update using (is_member(id));
-- A signed-in user may create their own workspace during sign-up.
create policy workspaces_insert on workspaces
  for insert with check (auth.uid() is not null);

create policy members_read on workspace_members
  for select using (user_id = auth.uid() or is_member(workspace_id));
create policy members_insert on workspace_members
  for insert with check (user_id = auth.uid() or is_member(workspace_id));
create policy members_delete on workspace_members
  for delete using (is_member(workspace_id));

create policy profiles_all on project_profiles
  for all using (is_member(workspace_id)) with check (is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Boards and everything hanging off them
-- ---------------------------------------------------------------------------
create policy boards_all on boards
  for all using (is_member(workspace_id)) with check (is_member(workspace_id));

create policy end_users_all on end_users
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

create policy themes_all on themes
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

create policy posts_all on posts
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

create policy votes_all on votes
  for all using (can_touch_post(post_id)) with check (can_touch_post(post_id));

create policy comments_all on comments
  for all using (can_touch_post(post_id)) with check (can_touch_post(post_id));

create policy dupes_all on duplicate_suggestions
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

create policy prompts_all on build_prompts
  for all using (is_member(workspace_id)) with check (is_member(workspace_id));

create policy prompt_messages_all on build_prompt_messages
  for all using (exists (
    select 1 from build_prompts bp
    where bp.id = build_prompt_id and is_member(bp.workspace_id)
  ));

create policy changelog_all on changelog_entries
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

create policy changelog_posts_all on changelog_posts
  for all using (exists (
    select 1 from changelog_entries e
    where e.id = entry_id and can_touch_board(e.board_id)
  ));

create policy threads_all on chat_threads
  for all using (is_member(workspace_id)) with check (is_member(workspace_id));

create policy chat_messages_all on chat_messages
  for all using (exists (
    select 1 from chat_threads t
    where t.id = thread_id and is_member(t.workspace_id)
  ));

create policy recommendations_all on recommendations
  for all using (can_touch_board(board_id)) with check (can_touch_board(board_id));

create policy activity_all on activity
  for all using (is_member(workspace_id)) with check (is_member(workspace_id));

-- ---------------------------------------------------------------------------
-- Service-role only. No policies are defined for these, so RLS denies every
-- authenticated request and only the service key can reach them.
-- ---------------------------------------------------------------------------
-- rate_limits, email_outbox, magic_links, jobs

-- ---------------------------------------------------------------------------
-- Privacy · export and delete endpoints for end users (PRD non-functional
-- requirements). Both run as the service role from the API layer.
-- ---------------------------------------------------------------------------
create or replace function export_end_user(p_board uuid, p_email text)
returns jsonb language sql stable as $$
  select jsonb_build_object(
    'email', p_email,
    'exported_at', now(),
    'posts', coalesce((
      select jsonb_agg(jsonb_build_object(
        'number', p.number, 'title', p.title, 'body', p.body,
        'status', p.status, 'created_at', p.created_at
      ))
      from posts p join end_users eu on eu.id = p.author_id
      where p.board_id = p_board and eu.email = p_email
    ), '[]'::jsonb),
    'votes', coalesce((
      select jsonb_agg(jsonb_build_object(
        'post', p.title, 'created_at', v.created_at
      ))
      from votes v
      join end_users eu on eu.id = v.end_user_id
      join posts p on p.id = v.post_id
      where eu.board_id = p_board and eu.email = p_email
    ), '[]'::jsonb),
    'comments', coalesce((
      select jsonb_agg(jsonb_build_object(
        'post', p.title, 'body', c.body, 'created_at', c.created_at
      ))
      from comments c
      join end_users eu on eu.id = c.end_user_id
      join posts p on p.id = c.post_id
      where eu.board_id = p_board and eu.email = p_email and c.internal = false
    ), '[]'::jsonb)
  );
$$;

-- Deleting an end user leaves their posts standing but unattributed, so the
-- board's vote counts stay honest while the person is forgotten.
create or replace function delete_end_user(p_board uuid, p_email text)
returns void language plpgsql as $$
begin
  update comments c set body = '[deleted]', end_user_id = null
    from end_users eu
   where c.end_user_id = eu.id and eu.board_id = p_board and eu.email = p_email;

  delete from end_users where board_id = p_board and email = p_email;
end;
$$;

-- Per-board retention: drop end-user identities older than the window while
-- keeping the aggregate feedback.
create or replace function apply_retention(p_board uuid, p_days int)
returns void language plpgsql as $$
begin
  update end_users
     set email = null, name = null, segments = '{}'::jsonb,
         kind = 'anonymous'
   where board_id = p_board
     and created_at < now() - make_interval(days => p_days);
end;
$$;
