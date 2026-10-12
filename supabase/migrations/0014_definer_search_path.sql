-- Pinning search_path to `public` alone was too narrow.
--
-- create_workspace() inserts a board, which fires boards_before_insert, which
-- calls gen_public_id(), which calls gen_random_bytes() -- and that comes from
-- pgcrypto, which Supabase installs in the `extensions` schema rather than
-- `public`. An ordinary request resolves it because the role's default
-- search_path already includes `extensions`; a definer function that pins
-- `search_path = public` does not, so creating a workspace failed with
-- "function gen_random_bytes(integer) does not exist".
--
-- Fixed in both places, because either alone would leave the trap set:
--
--   * gen_public_id no longer needs pgcrypto at all. gen_random_uuid() is
--     built into Postgres 13 and up, so it lives in pg_catalog and resolves
--     under any search_path. Same 40 bits of randomness as the five bytes it
--     replaces, and the id stays an opaque `brd_` token either way. Only new
--     boards are affected; existing public ids are untouched.
--   * create_workspace still adds `extensions` to its path, so anything else
--     in the trigger chain that does want pgcrypto can find it.
--
-- `set search_path` stays on both: dropping it to inherit the caller's is what
-- makes a definer function a privilege-escalation vector, which is the problem
-- the narrow path was solving in the first place.

create or replace function gen_public_id(prefix text) returns text
language sql
volatile
set search_path = public, extensions
as $$
  select prefix || '_' || substr(replace(gen_random_uuid()::text, '-', ''), 1, 10);
$$;

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
set search_path = public, extensions
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

-- `create or replace` keeps existing grants, but state them again so this
-- migration is complete on its own rather than depending on 0013 having run.
revoke all on function create_workspace(text, text, text, text[], text, text)
  from public, anon;
grant execute on function create_workspace(text, text, text, text[], text, text)
  to authenticated, service_role;
