-- When a board's widget was first served to a real page.
--
-- The install screen has an indicator that waits for the widget to phone home,
-- and it was reading two different signals that disagreed:
--
--   * the server render passed `installed={(posts ?? 0) > 0}` -- has anyone
--     posted;
--   * the client poll, /api/board/installed, counted rate_limits rows with
--     `bucket = 'load'`.
--
-- Nothing has ever written the 'load' bucket. The string occurs twice in the
-- whole repo and both are inside the route that reads it, so the poll could
-- only ever answer false and the indicator never flipped on its own. Two rows
-- on the seeded Driftnote board, both from 2026-10-13, were masking it: the old
-- sweep inside check_rate_limit only ran when check_rate_limit was called, and
-- nothing had voted since, so they were never collected. 0023 moves that sweep
-- onto the scheduler, which would have collected them and made the breakage
-- total.
--
-- Neither signal was the right one anyway:
--
--   * "has a post" is not "is installed". A founder who installs the widget and
--     waits for their users to say something is installed and shows as not.
--   * a rate_limit row is deliberately short-lived -- 0023 prunes after a day --
--     so a board installed last week with a quiet Tuesday would un-install
--     itself. Install is a thing that happened once, not a recent event, and
--     storing it in a table whose whole purpose is to forget was the mistake
--     underneath the dead bucket.
--
-- So it goes on the board, where it is written once and never expires.

alter table boards add column installed_at timestamptz;

comment on column boards.installed_at is
  'First time the widget was served to a page that is not one of ours. Null '
  'means never seen. Written once by the public board API and never cleared -- '
  'uninstalling is not a state the install screen needs to show.';

-- Backfill, so no board that currently reads as installed regresses to not.
--
-- The earliest post rather than the board's own created_at: a post can only
-- exist if the widget reached somebody, so its timestamp is a real lower bound
-- on when the install happened, where the board's creation is only when the
-- founder got as far as the install screen.
update boards b
   set installed_at = p.first_post
  from (
    select board_id, min(created_at) as first_post
      from posts
     group by board_id
  ) p
 where p.board_id = b.id
   and b.installed_at is null;

-- Partial: the only question asked of this column is "is it null", and once a
-- board is installed it never comes back. Indexing the stamped ones would be
-- indexing the rows nobody looks up.
create index boards_not_installed_idx on boards (id) where installed_at is null;
