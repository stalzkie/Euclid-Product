-- ============================================================================
-- Euclid · seed
-- The Driftnote workspace from the product UI, so a fresh database renders the
-- same screens the designs show. Safe to run more than once.
--
-- Votes are inserted as real rows rather than written as counts: the recount
-- trigger owns `posts.vote_count`, and generating the rows means the paying
-- share, vote velocity, segment split and sparklines are all genuine.
--
-- Run after the migrations:  psql "$DATABASE_URL" -f supabase/seed.sql
-- ============================================================================

begin;

delete from workspaces where slug = 'driftnote';

insert into workspaces (id, name, slug, plan, coding_tools, app_name, app_url,
                        prompts_used, chat_credits_used, onboarded_at)
values ('11111111-1111-1111-1111-111111111111', 'Driftnote', 'driftnote',
        'indie', '{"Claude Code","Cursor"}', 'Driftnote',
        'https://driftnote.app', 18, 188, now());

insert into project_profiles (workspace_id, stack, conventions, rules_file, rules_file_name)
values (
  '11111111-1111-1111-1111-111111111111',
  '[{"kind":"Framework","name":"Next.js 15 (App Router)"},
    {"kind":"Language","name":"TypeScript"},
    {"kind":"Database","name":"Supabase Postgres"},
    {"kind":"Auth","name":"Clerk"},
    {"kind":"UI","name":"Tailwind + shadcn/ui"},
    {"kind":"Hosting","name":"Vercel"}]'::jsonb,
  E'Server actions over API routes. Zod for every input.\nFeature flags live in lib/flags.ts.',
  E'# Driftnote\nJournaling app. Next.js 15 App Router, TypeScript strict.\n\n## Commands\n- pnpm dev · pnpm test · pnpm lint\n\n## Conventions\n- Server actions over API routes\n- Zod schema for every input\n- Feature flags live in lib/flags.ts\n- Never import the Supabase service key in client code',
  'CLAUDE.md'
);

-- ---------------------------------------------------------------------------
-- Boards
-- ---------------------------------------------------------------------------
insert into boards (id, workspace_id, public_id, name, slug, color, identity_mode,
                    allowed_domains, show_badge, design)
values
  ('22222222-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111',
   'brd_8f2k1x', 'Feature requests', 'feature-requests', '#1A8CFF', 'email',
   '{}', false,
   '{"heading":"Help shape Driftnote","subheading":"Suggest an idea or vote on one. We read every post."}'::jsonb),
  ('22222222-0000-0000-0000-000000000002', '11111111-1111-1111-1111-111111111111',
   'brd_bugs01', 'Bug reports', 'bug-reports', '#EC4899', 'email', '{}', false, '{}'::jsonb),
  ('22222222-0000-0000-0000-000000000003', '11111111-1111-1111-1111-111111111111',
   'brd_integr1', 'Integrations', 'integrations', '#16A34A', 'email', '{}', false, '{}'::jsonb);

-- ---------------------------------------------------------------------------
-- Themes · the clusters the Themes screen shows
-- ---------------------------------------------------------------------------
insert into themes (id, board_id, name, summary) values
  ('33333333-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
   'Data export and backups',
   'Users want a copy of their writing they control: Markdown files, CSV, and a path into Notion.'),
  ('33333333-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001',
   'Editor and formatting',
   'Dark mode leads, then paste reliability and keyboard shortcuts for headings and lists.'),
  ('33333333-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001',
   'Integrations',
   'Notion is the clear first ask. Readwise and Zapier follow with a much smaller pull.'),
  ('33333333-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000001',
   'Mobile',
   'Writing on the go: offline mode and a home-screen widget for a quick daily entry.'),
  ('33333333-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000001',
   'Search',
   'People cannot find old entries. Full-text search inside attachments and date filters.'),
  ('33333333-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000001',
   'Pricing and plans',
   'Requests for student and yearly discounts. Mostly Free-plan users, low paying share.');

-- ---------------------------------------------------------------------------
-- A voter pool. Plan mix matches the Insights design: Pro 46%, Team 16%,
-- Free 38%. Deterministic so re-running the seed is idempotent.
-- ---------------------------------------------------------------------------
insert into end_users (board_id, kind, external_key, email, email_verified, segments, vote_weight)
select
  '22222222-0000-0000-0000-000000000001',
  'email',
  'seed:voter' || i,
  'voter' || i || '@example.com',
  true,
  case
    when i % 100 < 46 then '{"plan":"pro"}'::jsonb
    when i % 100 < 62 then '{"plan":"team"}'::jsonb
    else '{"plan":"free"}'::jsonb
  end,
  case
    when i % 100 < 46 then 1.25
    when i % 100 < 62 then 1.5
    else 1
  end
from generate_series(1, 320) as i;

-- The named authors from the designs.
insert into end_users (id, board_id, kind, external_key, email, email_verified, segments, vote_weight)
values
  ('44444444-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001', 'email', 'jules@kestrel.io',   'jules@kestrel.io',   true, '{"plan":"pro"}',  1.25),
  ('44444444-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001', 'email', 'sam.o@hey.com',      'sam.o@hey.com',      true, '{"plan":"free"}', 1),
  ('44444444-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001', 'email', 'priya@lumen.dev',    'priya@lumen.dev',    true, '{"plan":"team"}', 1.5),
  ('44444444-0000-0000-0000-000000000004', '22222222-0000-0000-0000-000000000001', 'email', 'leo@fastmail.com',   'leo@fastmail.com',   true, '{"plan":"free"}', 1),
  ('44444444-0000-0000-0000-000000000005', '22222222-0000-0000-0000-000000000001', 'email', 'ana@birch.so',       'ana@birch.so',       true, '{"plan":"pro"}',  1.25),
  ('44444444-0000-0000-0000-000000000006', '22222222-0000-0000-0000-000000000001', 'email', 'kai@tidepool.app',   'kai@tidepool.app',   true, '{"plan":"pro"}',  1.25),
  ('44444444-0000-0000-0000-000000000007', '22222222-0000-0000-0000-000000000001', 'email', 'mo@quill.ink',       'mo@quill.ink',       true, '{"plan":"free"}', 1),
  ('44444444-0000-0000-0000-000000000008', '22222222-0000-0000-0000-000000000001', 'email', 'ines@uni.pt',        'ines@uni.pt',        true, '{"plan":"free"}', 1);

-- ---------------------------------------------------------------------------
-- Posts. `target_votes` drives how many real vote rows get generated below.
-- ---------------------------------------------------------------------------
create temporary table seed_posts (
  id uuid, number int, title text, body text, category text,
  status post_status, theme_id uuid, author_id uuid,
  target_votes int, age_days int, momentum numeric, shipped boolean
) on commit drop;

insert into seed_posts values
  ('55555555-0000-0000-0000-000000000142', 142, 'Export entries to CSV and Markdown',
   E'I have written in Driftnote every day for two years and I have no way to get it out. I would love a one-click export to Markdown files, one per entry, with the date in the filename, so I can keep backups and move things into Notion when I need to.\n\nA CSV would be fine too for the spreadsheet people.',
   'Feature', 'planned', '33333333-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000001', 184, 32, 2.6, false),
  ('55555555-0000-0000-0000-000000000097', 97, 'Dark mode for the editor',
   'Writing at night is painful. A real dark theme for the editor, not just the shell.',
   'Feature', 'in_progress', '33333333-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000002', 141, 48, 1.8, false),
  ('55555555-0000-0000-0000-000000000203', 203, 'Sync with Notion databases',
   'Two-way sync between Driftnote entries and a Notion database would close the loop for me.',
   'Integration', 'under_review', '33333333-0000-0000-0000-000000000003',
   '44444444-0000-0000-0000-000000000003', 96, 19, 2.1, false),
  ('55555555-0000-0000-0000-000000000088', 88, 'Offline mode on iOS',
   'I write on the train with no signal. The app should queue entries and sync later.',
   'Feature', 'under_review', '33333333-0000-0000-0000-000000000004',
   '44444444-0000-0000-0000-000000000004', 88, 26, 1.3, false),
  ('55555555-0000-0000-0000-000000000071', 71, 'Editor freezes when pasting long text',
   'Pasting anything over about 2,000 words locks the editor for several seconds.',
   'Bug', 'in_progress', '33333333-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000005', 72, 12, 1.1, false),
  ('55555555-0000-0000-0000-000000000061', 61, 'Search inside attachments',
   'Search only looks at entry text. I need it to look inside the PDFs I attach.',
   'Feature', 'planned', '33333333-0000-0000-0000-000000000005',
   '44444444-0000-0000-0000-000000000006', 61, 40, 1.2, false),
  ('55555555-0000-0000-0000-000000000058', 58, 'Pin entries to the top',
   'Let me pin a handful of entries so they stay above the feed.',
   'Feature', 'shipped', '33333333-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000007', 58, 60, 1.0, true),
  ('55555555-0000-0000-0000-000000000019', 19, 'Cheaper yearly plan for students',
   'The yearly price is a lot on a student budget. A discount with a .edu address would help.',
   'Other', 'declined', '33333333-0000-0000-0000-000000000006',
   '44444444-0000-0000-0000-000000000008', 19, 70, 0.8, false),
  ('55555555-0000-0000-0000-000000000188', 188, 'Backup my journal to Dropbox',
   E'Backups. I do not trust any app with two years of my writing. A nightly drop into my own Dropbox folder would let me sleep.',
   'Feature', 'under_review', '33333333-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000005', 31, 9, 2.4, false),
  ('55555555-0000-0000-0000-000000000190', 190, 'Download all entries as Markdown files',
   'One file per entry, with the date in the filename. Nothing fancy.',
   'Feature', 'under_review', '33333333-0000-0000-0000-000000000001',
   '44444444-0000-0000-0000-000000000006', 22, 7, 2.2, false),
  ('55555555-0000-0000-0000-000000000204', 204, 'Zapier trigger on new entry',
   'A "new entry" trigger in Zapier so I can push entries into my own tools.',
   'Integration', 'under_review', '33333333-0000-0000-0000-000000000003',
   '44444444-0000-0000-0000-000000000003', 38, 15, 1.5, false),
  ('55555555-0000-0000-0000-000000000205', 205, 'Home screen quick-entry widget',
   'An iOS widget that opens straight into a new entry.',
   'Feature', 'under_review', '33333333-0000-0000-0000-000000000004',
   '44444444-0000-0000-0000-000000000004', 41, 21, 1.2, false),
  ('55555555-0000-0000-0000-000000000206', 206, 'Daily writing streak reminders',
   'A gentle nudge at the hour I usually write, and a streak I can turn off.',
   'Feature', 'under_review', '33333333-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000001', 7, 1, 3.0, false),
  ('55555555-0000-0000-0000-000000000033', 33, 'Weekly prompts you can turn off',
   'A writing prompt on Sundays, with a clear switch to turn it off.',
   'Feature', 'planned', '33333333-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000002', 33, 35, 1.1, false),
  ('55555555-0000-0000-0000-000000000027', 27, 'Filter entries by date range',
   'Let me pull up everything I wrote in a given month.',
   'Feature', 'under_review', '33333333-0000-0000-0000-000000000005',
   '44444444-0000-0000-0000-000000000006', 27, 44, 0.9, false),
  ('55555555-0000-0000-0000-000000000015', 15, 'Family plan',
   'My partner and I both write. One bill would be easier.',
   'Other', 'under_review', '33333333-0000-0000-0000-000000000006',
   '44444444-0000-0000-0000-000000000008', 15, 52, 0.9, false),
  ('55555555-0000-0000-0000-000000000031', 31, 'Faster sync on Android',
   'Sync stalls on large journals.',
   'Bug', 'shipped', '33333333-0000-0000-0000-000000000004',
   '44444444-0000-0000-0000-000000000004', 31, 55, 1.0, true),
  ('55555555-0000-0000-0000-000000000102', 102, 'Weekly writing recap email',
   'A Sunday email with what I wrote that week.',
   'Feature', 'shipped', '33333333-0000-0000-0000-000000000002',
   '44444444-0000-0000-0000-000000000003', 102, 72, 1.0, true);

insert into posts (id, board_id, number, title, body, category, status, theme_id,
                   author_id, created_at, shipped_at)
select id, '22222222-0000-0000-0000-000000000001', number, title, body, category,
       status, theme_id, author_id,
       now() - make_interval(days => age_days),
       case when shipped then now() - make_interval(days => (age_days / 4)) else null end
from seed_posts;

-- ---------------------------------------------------------------------------
-- Votes. Each post draws its voters from the pool, with timestamps weighted
-- toward the present by `momentum`, so vote velocity and the 30-day chart have
-- a real shape rather than a flat line.
-- ---------------------------------------------------------------------------
insert into votes (post_id, end_user_id, weight, created_at)
select
  sp.id,
  eu.id,
  eu.vote_weight,
  -- Newer votes cluster near today when momentum is high.
  now() - make_interval(
    days => greatest(
      0,
      least(
        sp.age_days,
        (sp.age_days * power(random(), sp.momentum))::int
      )
    )
  )
from seed_posts sp
join lateral (
  select id, vote_weight
  from end_users
  where board_id = '22222222-0000-0000-0000-000000000001'
    and external_key like 'seed:voter%'
  order by md5(external_key || sp.id::text)
  limit sp.target_votes
) eu on true;

-- The named author of each post votes for it too.
insert into votes (post_id, end_user_id, weight, created_at)
select sp.id, sp.author_id, eu.vote_weight, now() - make_interval(days => sp.age_days)
from seed_posts sp
join end_users eu on eu.id = sp.author_id
on conflict (post_id, end_user_id) do nothing;

-- ---------------------------------------------------------------------------
-- Comments on #142 · the quotes the Build Prompt pulls from
-- ---------------------------------------------------------------------------
insert into comments (post_id, end_user_id, author_name, body, internal, created_at) values
  ('55555555-0000-0000-0000-000000000142', '44444444-0000-0000-0000-000000000005', 'ana@birch.so',
   E'Backups. I do not trust any app with two years of my writing.', false, now() - interval '20 days'),
  ('55555555-0000-0000-0000-000000000142', '44444444-0000-0000-0000-000000000006', 'kai@tidepool.app',
   'One file per entry, with the date in the filename, and my tags as front matter.', false, now() - interval '14 days'),
  ('55555555-0000-0000-0000-000000000142', '44444444-0000-0000-0000-000000000003', 'priya@lumen.dev',
   'So I can move things into Notion when I need to.', false, now() - interval '9 days'),
  ('55555555-0000-0000-0000-000000000142', '44444444-0000-0000-0000-000000000002', 'sam.o@hey.com',
   E'Honestly I will cancel if I cannot get my writing out. It is two years of my life.', false, now() - interval '6 days'),
  ('55555555-0000-0000-0000-000000000142', null, 'Maya Reyes',
   E'Shipping this behind the export_v1 flag. Free gets CSV only to start.', true, now() - interval '2 days'),
  ('55555555-0000-0000-0000-000000000097', '44444444-0000-0000-0000-000000000004', 'leo@fastmail.com',
   'The shell is dark but the editor is still blinding white at night.', false, now() - interval '11 days'),
  ('55555555-0000-0000-0000-000000000188', '44444444-0000-0000-0000-000000000001', 'jules@kestrel.io',
   'Dropbox or any folder I control, really. I just want a copy off your servers.', false, now() - interval '5 days'),
  ('55555555-0000-0000-0000-000000000203', '44444444-0000-0000-0000-000000000006', 'kai@tidepool.app',
   'One way would do. Entries into a Notion database, nightly.', false, now() - interval '8 days');

-- ---------------------------------------------------------------------------
-- Duplicate queue · what the merge queue offers on #142
-- ---------------------------------------------------------------------------
insert into duplicate_suggestions (board_id, post_id, target_id, similarity) values
  ('22222222-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000188',
   '55555555-0000-0000-0000-000000000142', 0.940),
  ('22222222-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000190',
   '55555555-0000-0000-0000-000000000142', 0.910),
  ('22222222-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000204',
   '55555555-0000-0000-0000-000000000203', 0.860),
  ('22222222-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000027',
   '55555555-0000-0000-0000-000000000061', 0.830);

-- ---------------------------------------------------------------------------
-- The weekly recommendation the Home screen leads with
-- ---------------------------------------------------------------------------
insert into recommendations (board_id, headline, reasons, source_posts, theme_id) values
  ('22222222-0000-0000-0000-000000000001', 'Build data export next',
   '["Most-voted theme for 3 weeks, 237 votes across 3 posts",
     "62% of voters pay, the highest share of any theme",
     "3 comments mention leaving over backups"]'::jsonb,
   '[{"number":142,"title":"CSV export"},{"number":188,"title":"Backups"},
     {"number":203,"title":"Notion sync"}]'::jsonb,
   '33333333-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------
-- Changelog
-- ---------------------------------------------------------------------------
insert into changelog_entries (id, board_id, title, body, published, published_at, voters_notified)
values
  ('66666666-0000-0000-0000-000000000001', '22222222-0000-0000-0000-000000000001',
   'Pin entries to the top',
   E'You can now pin entries so they stay above the feed. Long-press on mobile, or use the pin icon on desktop.\n\nThanks to the 58 of you who voted for this.',
   true, now() - interval '2 days', 58),
  ('66666666-0000-0000-0000-000000000002', '22222222-0000-0000-0000-000000000001',
   'Faster sync on Android',
   'Entries now sync in the background, so the app opens to your latest writing straight away.',
   true, now() - interval '9 days', 31),
  ('66666666-0000-0000-0000-000000000003', '22222222-0000-0000-0000-000000000001',
   'Weekly writing recap email',
   'A Sunday email with what you wrote that week. Turn it off in Settings.',
   true, now() - interval '17 days', 102);

insert into changelog_posts (entry_id, post_id) values
  ('66666666-0000-0000-0000-000000000001', '55555555-0000-0000-0000-000000000058'),
  ('66666666-0000-0000-0000-000000000002', '55555555-0000-0000-0000-000000000031'),
  ('66666666-0000-0000-0000-000000000003', '55555555-0000-0000-0000-000000000102');

-- ---------------------------------------------------------------------------
-- Activity feed
-- ---------------------------------------------------------------------------
insert into activity (workspace_id, board_id, post_id, kind, text, meta, created_at) values
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000206', 'post',
   'New post: Daily writing streak reminders',
   'Feature requests · via widget · jules@kestrel.io', now() - interval '12 minutes'),
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000142', 'merge',
   'Euclid merged 3 duplicates into Export entries to CSV',
   '27 votes combined · you approved', now() - interval '1 hour'),
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000058', 'ship',
   'Shipped: Pin entries to the top',
   '58 voters emailed · changelog published', now() - interval '1 day'),
  ('11111111-1111-1111-1111-111111111111', '22222222-0000-0000-0000-000000000001',
   '55555555-0000-0000-0000-000000000097', 'prompt',
   'Build Prompt copied for Dark mode (Cursor)',
   'v3 · 2 assumptions corrected', now() - interval '1 day 2 hours');

commit;

-- What the seed produced.
select p.number, p.title, p.vote_count, p.status
from posts p
where p.board_id = '22222222-0000-0000-0000-000000000001'
order by p.vote_count desc
limit 8;
