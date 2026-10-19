-- Let the outbox carry an HTML part and a Reply-To.
--
-- Every email the app sends has been plain text, posted to Resend as `text`
-- alone. That is fine for a magic link and wrong for anything a customer is
-- meant to keep: the first promo-code email went out as an unstyled wall of
-- text from an address with no display name, and Gmail filed it under
-- Promotions.
--
-- Landing in Promotions is not a styling problem, it is a signals problem,
-- and the signals are: who it is from, whether a human can reply, whether the
-- subject reads like an offer, and whether the message is multipart. Three of
-- those four are addressed here; the fourth is copy.
--
-- `html` is nullable on purpose. A row without it still sends as text, so
-- nothing that queues today has to change at once and the magic link -- which
-- genuinely wants to be plain -- can stay as it is.
--
-- `reply_to` matters more than it looks. A transactional email a real person
-- answers is one of the strongest signals against the Promotions tab, and the
-- marketing site's email spec already requires it for the same reason: the
-- copy promises a human reply, so the header has to make one possible.

alter table email_outbox
  add column html     text,
  add column reply_to text;

comment on column email_outbox.html is
  'HTML part. Null sends text only, which is right for the magic link and '
  'wrong for anything a customer keeps.';

comment on column email_outbox.reply_to is
  'Reply-To header. Null falls back to the sender. Set it wherever the copy '
  'invites a reply -- a transactional mail a human answers is a strong signal '
  'against Gmail filing it under Promotions.';

-- ---------------------------------------------------------------------------
-- The claim has to hand the new columns over
-- ---------------------------------------------------------------------------

-- `claim_queued_emails` returns a fixed column list, so adding columns to the
-- table is not enough -- the drain would never see them. The return type
-- changes, so the old function is dropped rather than replaced.
--
-- Everything else about it is unchanged from 0015: `for update skip locked`
-- plus the attempt increment, so a row is claimable exactly once even with
-- `drainAfterResponse` firing on every post, publish and magic link.
drop function if exists claim_queued_emails(int);

create or replace function claim_queued_emails(p_limit int default 50)
returns table (
  id       uuid,
  to_email text,
  subject  text,
  body     text,
  html     text,
  reply_to text,
  kind     text,
  attempts int
)
language sql
security definer
set search_path = public
as $$
  with due as (
    select e.id
    from email_outbox e
    where e.sent_at is null
      and e.deliver_after <= now()
      and e.attempts < 5
    order by e.deliver_after
    limit p_limit
    for update skip locked
  )
  update email_outbox e
  set attempts = e.attempts + 1
  from due
  where e.id = due.id
  returning e.id, e.to_email, e.subject, e.body, e.html, e.reply_to, e.kind, e.attempts;
$$;

revoke all on function claim_queued_emails(int) from public, anon, authenticated;
grant execute on function claim_queued_emails(int) to service_role;
