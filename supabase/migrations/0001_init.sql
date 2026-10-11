-- ============================================================================
-- Euclid · 0001_init
-- Core entities: Workspace > Board > Post > (Vote, Comment), EndUser, Theme,
-- BuildPrompt, ChangelogEntry. Embeddings live on posts for duplicate
-- detection and theme clustering (PRD "Architecture and data model").
-- ============================================================================

create extension if not exists "pgcrypto";
create extension if not exists "vector";

-- ---------------------------------------------------------------------------
-- Enums
-- ---------------------------------------------------------------------------
create type post_status as enum (
  'under_review', 'planned', 'in_progress', 'shipped', 'declined'
);
create type plan_tier as enum ('free', 'indie', 'pro');
create type identity_mode as enum ('anonymous', 'email', 'jwt');
create type end_user_kind as enum ('anonymous', 'email', 'jwt');
create type prompt_target as enum ('claude', 'codex', 'cursor', 'builder', 'generic');
create type member_role as enum ('owner', 'admin', 'member');

-- ---------------------------------------------------------------------------
-- Workspace · owns boards, a project profile and a plan
-- ---------------------------------------------------------------------------
create table workspaces (
  id              uuid primary key default gen_random_uuid(),
  name            text not null,
  slug            text not null unique,
  plan            plan_tier not null default 'free',
  billing_period  text not null default 'monthly'
                    check (billing_period in ('monthly', 'yearly')),
  -- What the founder builds with: Claude Code, Cursor, Codex, ...
  coding_tools    text[] not null default '{}',
  app_name        text,
  app_url         text,
  -- AI metering. Caps come from the plan; usage resets monthly.
  prompts_used        int not null default 0,
  chat_credits_used   int not null default 0,
  usage_period_start  date not null default date_trunc('month', now())::date,
  onboarded_at    timestamptz,
  created_at      timestamptz not null default now()
);

create table workspace_members (
  workspace_id uuid not null references workspaces(id) on delete cascade,
  user_id      uuid not null references auth.users(id) on delete cascade,
  role         member_role not null default 'owner',
  name         text,
  created_at   timestamptz not null default now(),
  primary key (workspace_id, user_id)
);
create index on workspace_members (user_id);

-- ---------------------------------------------------------------------------
-- Project profile · the one-time setup that makes Build Prompts specific
-- ---------------------------------------------------------------------------
create table project_profiles (
  workspace_id uuid primary key references workspaces(id) on delete cascade,
  -- Array of { kind, name } rows, e.g. Framework / Next.js 15 (App Router)
  stack        jsonb not null default '[]'::jsonb,
  conventions  text,
  -- Pasted CLAUDE.md / AGENTS.md / rules file
  rules_file       text,
  rules_file_name  text default 'CLAUDE.md',
  updated_at   timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Board · design config (JSON), allowed domains, identity mode
-- ---------------------------------------------------------------------------
create table boards (
  id             uuid primary key default gen_random_uuid(),
  workspace_id   uuid not null references workspaces(id) on delete cascade,
  -- Public id used by the widget script tag, e.g. brd_8f2k1x
  public_id      text not null unique,
  name           text not null,
  slug           text not null,
  color          text not null default '#1A8CFF',
  description    text,
  identity_mode  identity_mode not null default 'anonymous',
  jwt_secret     text,
  allowed_domains text[] not null default '{}',
  -- Anonymous vote ceiling per visitor cookie
  anon_vote_limit int not null default 10,
  require_approval boolean not null default false,
  show_badge      boolean not null default true,
  custom_domain   text,
  design          jsonb not null default '{}'::jsonb,
  categories     text[] not null default '{Feature,Bug,Integration,Other}',
  created_at     timestamptz not null default now(),
  unique (workspace_id, slug)
);
create index on boards (workspace_id);

-- ---------------------------------------------------------------------------
-- EndUser · anonymous, email-verified or JWT-identified
-- ---------------------------------------------------------------------------
create table end_users (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references boards(id) on delete cascade,
  kind          end_user_kind not null default 'anonymous',
  -- Cookie value for anonymous, email for magic link, host user id for JWT
  external_key  text not null,
  email         text,
  email_verified boolean not null default false,
  name          text,
  -- Segment attributes from the signed JWT, e.g. plan and signup date
  segments      jsonb not null default '{}'::jsonb,
  -- Plan-weighted votes multiply a vote's weight
  vote_weight   numeric(4,2) not null default 1,
  created_at    timestamptz not null default now(),
  unique (board_id, external_key)
);
create index on end_users (board_id, email);

-- ---------------------------------------------------------------------------
-- Theme · clusters of posts, named by an LLM
-- ---------------------------------------------------------------------------
create table themes (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references boards(id) on delete cascade,
  name          text not null,
  summary       text,
  centroid      vector(1536),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now()
);
create index on themes (board_id);

-- ---------------------------------------------------------------------------
-- Post
-- ---------------------------------------------------------------------------
create table posts (
  id            uuid primary key default gen_random_uuid(),
  board_id      uuid not null references boards(id) on delete cascade,
  -- Human-facing number per board, e.g. 142
  number        int not null,
  title         text not null,
  body          text,
  category      text,
  status        post_status not null default 'under_review',
  theme_id      uuid references themes(id) on delete set null,
  author_id     uuid references end_users(id) on delete set null,
  -- Set when this post is folded into another; its votes move with it.
  merged_into   uuid references posts(id) on delete set null,
  embedding     vector(1536),
  -- Denormalised counters, kept true by the triggers below.
  vote_count    int not null default 0,
  comment_count int not null default 0,
  -- Moderation
  approved      boolean not null default true,
  spam_score    numeric(3,2) not null default 0,
  -- Set when the prompt pipeline sees injection-shaped text in the post.
  injection_flagged boolean not null default false,
  founder_notes text,
  pinned        boolean not null default false,
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  shipped_at    timestamptz,
  unique (board_id, number)
);
create index on posts (board_id, status);
create index on posts (board_id, vote_count desc);
create index on posts (theme_id);
create index on posts (merged_into);
-- Approximate nearest-neighbour search for duplicates and clustering.
create index posts_embedding_idx on posts
  using ivfflat (embedding vector_cosine_ops) with (lists = 100);

-- ---------------------------------------------------------------------------
-- Vote · one per end user per post, carrying its weight
-- ---------------------------------------------------------------------------
create table votes (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  end_user_id uuid not null references end_users(id) on delete cascade,
  weight      numeric(4,2) not null default 1,
  created_at  timestamptz not null default now(),
  unique (post_id, end_user_id)
);
create index on votes (post_id);
create index on votes (created_at);

-- ---------------------------------------------------------------------------
-- Comment · public replies and internal notes
-- ---------------------------------------------------------------------------
create table comments (
  id          uuid primary key default gen_random_uuid(),
  post_id     uuid not null references posts(id) on delete cascade,
  end_user_id uuid references end_users(id) on delete set null,
  -- Set when a founder replies from the dashboard
  author_user_id uuid references auth.users(id) on delete set null,
  author_name text,
  body        text not null,
  internal    boolean not null default false,
  pinned      boolean not null default false,
  created_at  timestamptz not null default now()
);
create index on comments (post_id, created_at);

-- ---------------------------------------------------------------------------
-- Duplicate suggestions · the merge queue
-- ---------------------------------------------------------------------------
create table duplicate_suggestions (
  id          uuid primary key default gen_random_uuid(),
  board_id    uuid not null references boards(id) on delete cascade,
  post_id     uuid not null references posts(id) on delete cascade,
  target_id   uuid not null references posts(id) on delete cascade,
  similarity  numeric(4,3) not null,
  state       text not null default 'pending'
                check (state in ('pending', 'merged', 'dismissed')),
  created_at  timestamptz not null default now(),
  unique (post_id, target_id)
);
create index on duplicate_suggestions (board_id, state);

-- ---------------------------------------------------------------------------
-- BuildPrompt · target tool, generated text, assumptions, version history
-- ---------------------------------------------------------------------------
create table build_prompts (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  post_id      uuid references posts(id) on delete cascade,
  theme_id     uuid references themes(id) on delete cascade,
  target       prompt_target not null default 'claude',
  version      int not null default 1,
  title        text not null,
  body         text not null,
  context_block text,
  -- Array of { id, text, confirmed } — the list the founder corrects
  assumptions  jsonb not null default '[]'::jsonb,
  -- Which optional sections were switched on when it was generated
  includes     jsonb not null default '{}'::jsonb,
  founder_notes text,
  token_estimate int not null default 0,
  copied       boolean not null default false,
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now(),
  check (post_id is not null or theme_id is not null)
);
create index on build_prompts (workspace_id, created_at desc);
create index on build_prompts (post_id, version desc);

create table build_prompt_messages (
  id              uuid primary key default gen_random_uuid(),
  build_prompt_id uuid not null references build_prompts(id) on delete cascade,
  role            text not null check (role in ('user', 'assistant')),
  content         text not null,
  created_at      timestamptz not null default now()
);
create index on build_prompt_messages (build_prompt_id, created_at);

-- ---------------------------------------------------------------------------
-- ChangelogEntry · links to shipped posts
-- ---------------------------------------------------------------------------
create table changelog_entries (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references boards(id) on delete cascade,
  title        text not null,
  body         text not null default '',
  published    boolean not null default false,
  published_at timestamptz,
  -- Voter notification bookkeeping
  notify_voters boolean not null default true,
  voters_notified int not null default 0,
  show_badge   boolean not null default true,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index on changelog_entries (board_id, published_at desc);

create table changelog_posts (
  entry_id uuid not null references changelog_entries(id) on delete cascade,
  post_id  uuid not null references posts(id) on delete cascade,
  primary key (entry_id, post_id)
);

-- ---------------------------------------------------------------------------
-- Ask Euclid · chat threads with cited answers
-- ---------------------------------------------------------------------------
create table chat_threads (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  board_id     uuid references boards(id) on delete set null,
  title        text not null default 'New question',
  created_by   uuid references auth.users(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on chat_threads (workspace_id, created_at desc);

create table chat_messages (
  id         uuid primary key default gen_random_uuid(),
  thread_id  uuid not null references chat_threads(id) on delete cascade,
  role       text not null check (role in ('user', 'assistant')),
  content    text not null,
  -- The tool calls the model made, shown under "How I worked this out"
  steps      jsonb not null default '[]'::jsonb,
  -- Posts the answer cites, so the founder can verify it
  citations  jsonb not null default '[]'::jsonb,
  follow_ups jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now()
);
create index on chat_messages (thread_id, created_at);

-- ---------------------------------------------------------------------------
-- Recommendations · the weekly digest
-- ---------------------------------------------------------------------------
create table recommendations (
  id           uuid primary key default gen_random_uuid(),
  board_id     uuid not null references boards(id) on delete cascade,
  headline     text not null,
  reasons      jsonb not null default '[]'::jsonb,
  source_posts jsonb not null default '[]'::jsonb,
  theme_id     uuid references themes(id) on delete set null,
  created_at   timestamptz not null default now()
);
create index on recommendations (board_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Activity feed · what the Home screen shows
-- ---------------------------------------------------------------------------
create table activity (
  id           uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references workspaces(id) on delete cascade,
  board_id     uuid references boards(id) on delete cascade,
  post_id      uuid references posts(id) on delete set null,
  kind         text not null,
  text         text not null,
  meta         text,
  created_at   timestamptz not null default now()
);
create index on activity (workspace_id, created_at desc);

-- ---------------------------------------------------------------------------
-- Rate limiting · board-scoped buckets for posts, votes and comments
-- ---------------------------------------------------------------------------
create table rate_limits (
  id         bigserial primary key,
  board_id   uuid not null references boards(id) on delete cascade,
  bucket     text not null,
  actor      text not null,
  created_at timestamptz not null default now()
);
create index on rate_limits (board_id, bucket, actor, created_at desc);

-- ---------------------------------------------------------------------------
-- Email outbox · magic links and status notifications, drained by a worker
-- ---------------------------------------------------------------------------
create table email_outbox (
  id         uuid primary key default gen_random_uuid(),
  to_email   text not null,
  subject    text not null,
  body       text not null,
  kind       text not null,
  sent_at    timestamptz,
  created_at timestamptz not null default now()
);
create index on email_outbox (sent_at nulls first, created_at);

create table magic_links (
  token      text primary key,
  board_id   uuid not null references boards(id) on delete cascade,
  email      text not null,
  used_at    timestamptz,
  expires_at timestamptz not null,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------------
-- Jobs · anything slow or expensive runs here, so board reads stay fast
-- ---------------------------------------------------------------------------
create table jobs (
  id         uuid primary key default gen_random_uuid(),
  kind       text not null,
  payload    jsonb not null default '{}'::jsonb,
  run_after  timestamptz not null default now(),
  attempts   int not null default 0,
  locked_at  timestamptz,
  done_at    timestamptz,
  last_error text,
  created_at timestamptz not null default now()
);
create index on jobs (done_at, run_after);
