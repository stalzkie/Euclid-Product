-- Workspace creation, which could not work under RLS.
--
-- Onboarding inserted a workspace, read its id back, then inserted the
-- membership. Every one of those steps fought the policies:
--
--   * `workspaces_read` is `using (is_member(id))`, and the founder is not a
--     member until the row after. `insert ... returning` applies the SELECT
--     policy to the new row, so reading the id back was refused — the
--     "violates row-level security policy" the onboarding form reported.
--
--   * The slug was de-duplicated by selecting from `workspaces` with the
--     founder's own session, which RLS correctly answers with nothing. Every
--     founder therefore believed their slug was free, and the second person to
--     name an app "Driftnote" hit a unique violation instead.
--
--   * The four writes were not atomic. A failure after the first one left a
--     workspace with no members, which no policy can see and no founder can
--     delete — invisible rows accumulating forever.
--
-- All three are the same problem: bootstrapping an owner cannot be done by a
-- caller who is not yet an owner. So it happens here instead, in one
-- transaction, as a definer function that can see the whole table while still
-- being unable to create a workspace for anyone but its caller.
create or replace function create_workspace(
  p_name          text,
  p_slug          text,
  p_domain        text,
  p_tools         text[],
  p_member_name   text,
  p_board_heading text
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

  insert into workspaces (name, slug, plan, app_name, app_url, coding_tools)
  values (
    trim(p_name),
    v_slug,
    'free',
    trim(p_name),
    case when coalesce(p_domain, '') = '' then null else 'https://' || p_domain end,
    coalesce(p_tools, '{}'::text[])
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
revoke all on function create_workspace(text, text, text, text[], text, text)
  from public, anon;
grant execute on function create_workspace(text, text, text, text[], text, text)
  to authenticated, service_role;

-- With bootstrapping behind the function, nothing needs to insert a workspace
-- directly any more. The old policy let any signed-in user append unlimited
-- rows to `workspaces` — rows they then could not read, because reading needs
-- a membership they had no way to create. Dropping it closes that, and makes
-- the function the only way in.
drop policy if exists workspaces_insert on workspaces;
