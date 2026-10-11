-- Custom domain for the hosted board (PRD P1): serve the board from
-- feedback.theirapp.com instead of our subdomain.
--
-- A domain is only served once it has been verified, and verification is a
-- TXT record only the domain's owner can publish. Without that, claiming a
-- domain in this table would be enough to have us answer for a hostname
-- somebody else controls as soon as they ever pointed DNS at us.

-- custom_domain itself exists from 0001, where it was only ever stored and
-- never used. What was missing is the proof of ownership.
alter table boards add column custom_domain_token text;
alter table boards add column custom_domain_verified_at timestamptz;

-- One board per hostname, enforced by the database rather than by whoever
-- remembers to check first.
create unique index boards_custom_domain_key
  on boards (lower(custom_domain))
  where custom_domain is not null;

-- Hostname shape, lowercase, no scheme, no path, no port.
alter table boards add constraint boards_custom_domain_shape check (
  custom_domain is null
  or custom_domain ~ '^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\.[a-z0-9]([a-z0-9-]*[a-z0-9])?)+$'
);

-- Resolve a hostname to the board that has proved it owns it. Used on every
-- request to a custom domain, so it is one indexed lookup and nothing else.
create or replace function board_for_domain(p_host text)
returns table (public_id text)
language sql
stable
security definer
set search_path = public
as $$
  select b.public_id
  from boards b
  where lower(b.custom_domain) = lower(p_host)
    and b.custom_domain_verified_at is not null
  limit 1;
$$;

grant execute on function board_for_domain(text) to anon, authenticated, service_role;
