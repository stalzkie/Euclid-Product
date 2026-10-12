-- Student verification.
--
-- A discount for students needs some evidence of being one. This stores the
-- weakest evidence that is still worth having: that the founder controls an
-- address at an institution. A link is mailed to that address and has to be
-- clicked, which is the same mechanism `magic_links` already uses for end-user
-- email identity -- a separate table because those are scoped to a board and
-- these belong to a workspace.
--
-- What this deliberately does **not** do is hold a discount code. The checkout
-- route reads `student_verified_at` and applies the discount server-side, so
-- there is no code to leak, cap or rotate.

alter table workspaces
  -- The address the discount was granted against. Kept so the founder can see
  -- which one it was, and so a re-verification a year later can be offered to
  -- the same place without making them remember it.
  add column student_email       text,
  -- When it was granted. Null means never. Expiry is computed from this rather
  -- than stored, so changing the window is a code change and not a migration
  -- plus a backfill of every row.
  add column student_verified_at timestamptz;

create table student_verifications (
  token        text primary key,
  workspace_id uuid not null references workspaces(id) on delete cascade,
  email        text not null,
  -- 'auto'   -- the domain looked academic; the link went to the student.
  -- 'review' -- it did not; the link went to the operator to approve by hand.
  --            Same mechanism either way, different recipient, which is why
  --            there is no separate approvals table and no admin screen.
  kind         text not null check (kind in ('auto', 'review')),
  expires_at   timestamptz not null,
  used_at      timestamptz,
  created_at   timestamptz not null default now()
);
create index on student_verifications (workspace_id, created_at desc);

alter table student_verifications enable row level security;
-- No policy: nothing reaches this table except the service role. A founder
-- being able to read their own pending token would let them verify an address
-- they do not control, which is the one thing the token exists to prevent.

-- Redeem a verification token.
--
-- Single statement, so a token cannot be redeemed twice by two requests racing:
-- the `used_at is null` predicate is the lock. Returns the workspace it
-- verified, or nothing if the token was unknown, expired or already spent --
-- the caller cannot tell those apart, and should not.
create or replace function verify_student(p_token text)
returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
  v_workspace uuid;
  v_email     text;
begin
  update student_verifications
  set used_at = now()
  where token = p_token
    and used_at is null
    and expires_at > now()
  returning workspace_id, email into v_workspace, v_email;

  if v_workspace is null then
    return null;
  end if;

  update workspaces
  set student_email       = v_email,
      student_verified_at = now()
  where id = v_workspace;

  return v_workspace;
end;
$$;

revoke all on function verify_student(text) from public, anon, authenticated;
grant execute on function verify_student(text) to service_role;
