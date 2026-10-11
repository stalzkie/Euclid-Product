# Euclid

An embeddable feedback board for indie hackers and vibe coders. One script tag
puts a board in any app, where users suggest and upvote features. An AI layer
ranks and explains what they want, and **Build Prompt** turns any request into a
ready-to-paste brief for Claude Code, Codex, Cursor or anything else.

The wedge is the last step. Other feedback tools stop at "here is what users
want." This one continues to "here is the prompt to build it."

---

## Running it

```bash
npm install
cp .env.example .env.local     # fill in the values below
npm run dev
```

Without `.env.local` the app serves a setup page at `/setup` that lists exactly
what is missing, rather than crashing.

### Database

Apply the migrations in order, then the seed if you want demo data:

```
supabase/migrations/0001_init.sql            tables, enums, indexes, pgvector
supabase/migrations/0002_functions.sql       triggers, counters, analytics
supabase/migrations/0003_rls.sql             row-level security, privacy endpoints
supabase/migrations/0004_weighted_votes.sql  headcount vs weighted demand
supabase/migrations/0005_match_counts.sql    one-round-trip duplicate matching
supabase/seed.sql                            the Driftnote demo board
```

Paste them into the Supabase SQL editor, or `psql "$DATABASE_URL" -f <file>`.

After seeding, give the posts embeddings so duplicate detection works:

```bash
node scripts/backfill-embeddings.mjs
```

### Environment

| Variable | Needed | What it does |
|---|---|---|
| `NEXT_PUBLIC_SUPABASE_URL` | required | Supabase project URL |
| `NEXT_PUBLIC_SUPABASE_ANON_KEY` | required | Founder's session, under RLS |
| `SUPABASE_SERVICE_ROLE_KEY` | required | Widget API and jobs. Server only |
| `NEXT_PUBLIC_APP_URL` | required | Where this deployment lives; install snippets are built from it |
| `ANTHROPIC_API_KEY` | AI features | Build Prompt, Ask Euclid, theme names, changelog drafts |
| `ANTHROPIC_WORKSPACE_ID` | sometimes | Only if the key is an org key rather than workspace-scoped |
| `EMBEDDINGS_API_KEY` | optional | Duplicate detection and clustering. Falls back to a local hash |
| `EUCLID_SECRET` | JWT identity | Shared secret with the host app |
| `RESEND_API_KEY`, `EMAIL_FROM` | email | Without these, queued email is logged instead of sent |
| `CRON_SECRET` | jobs | Protects `/api/jobs/*` |

Add `<APP_URL>/**` to Supabase → Authentication → URL Configuration → Redirect
URLs, or sign-in links bounce.

---

## How it fits together

```
widget.js  ──iframe──▶  /embed/[publicId]  ──▶  /api/public/*  ──▶  Postgres
  (host page,                (Shadow DOM,            (service role,     (+ pgvector)
   one script tag)            own origin)             per-board auth)
                                                            ▲
dashboard  ──────────────────────────────────────────────────┘
  (founder's session, RLS)
```

- **`src/app/(dashboard)`** — the founder's product: Home, Feedback, Themes,
  Insights, Build Prompts, Changelog, Designer, Install, Profile, Billing.
- **`src/app/b/[publicId]`** — the hosted public board, shareable on its own URL.
- **`src/app/embed/[publicId]`** — what the widget iframe loads.
- **`public/widget.js`** — the loader. No framework, no dependencies, mounts in
  a Shadow DOM, degrades silently if Euclid is unreachable.
- **`src/components/board-widget.tsx`** — one component serves the designer
  preview, the embed and the hosted page, so what the founder designs is what
  ships.
- **`src/lib/ai/`** — Build Prompt, the chat assistant's read-only tools,
  clustering, embeddings, and the prompt-injection defenses.
- **`src/server/`** — data access. `queries.ts` runs as the founder (RLS);
  `public-board.ts` runs as the service role and authorises per board itself.

### Things worth knowing

**Votes are two numbers.** `vote_count` is a headcount — one person, one vote —
and it is the only number end users ever see. `weighted_score` sums plan
weights and only orders the founder's view. That is the answer to the PRD's
open question about showing plan-weighted votes without making users feel
ranked by payment.

**Similarity thresholds are measured, not guessed.** See
`src/lib/ai/thresholds.ts`. Re-run `node scripts/calibrate.mjs` after changing
the embeddings model — thresholds set too high do not fail loudly, they just
silently stop finding duplicates.

**The duplicate nudge runs twice.** A keyword pass answers immediately, a
semantic pass replaces it when the embedding returns. A suggestion that lands
after the person has hit Post is worth nothing.

**Do not apply SQL through the Windows clipboard.** `clip.exe` re-encodes
non-ASCII characters, which turns `·` into `┬╖` on the way into Postgres. Use
`psql` or the Supabase CLI. `scripts/repair-text.mjs` cleans up anything that
already slipped through, and `src/lib/ai/text.ts` repairs model output on the
way in.

**Post text is untrusted everywhere.** It is fenced as quoted data before it
reaches any model, injection-shaped text is flagged on the post and in the
generated prompt, and nothing is ever executed. Prompts also refuse to invent
file paths when no repo is connected.

---

## Scripts

| Command | What it does |
|---|---|
| `node scripts/check-db.mjs` | Verifies every table and RPC exists |
| `node scripts/seed-check.mjs` | Prints what the seed produced |
| `node scripts/backfill-embeddings.mjs` | Embeds posts that have none |
| `node scripts/rescan-duplicates.mjs` | Rebuilds the merge queue |
| `node scripts/calibrate.mjs` | Measures similarity thresholds for your model |
| `node scripts/widget-e2e.mjs` | Exercises the public API as a browser would |
| `node scripts/email-check.mjs` | Resend domain and DNS status |
| `node scripts/drain-outbox.mjs [--send]` | Shows or dispatches queued email |
| `node scripts/send-test.mjs <email>` | Sends one real email |
| `node scripts/repair-text.mjs [--write]` | Finds and fixes mis-decoded characters in stored text |
| `node scripts/tune-clustering.mjs` | Compares clustering strategies on your real board |
| `node scripts/audit.mjs` | Reports which features have actually been exercised |
| `node scripts/make-session.mjs <email>` | Local sign-in link |

`/demo/host.html` is a test host page that loads the widget against a
deliberately hostile stylesheet, to prove the Shadow DOM isolation holds. Add
`?mode=inline` to switch embed modes.

## Tests

```bash
npm test              # unit, no services needed
npm run test:integration   # needs a running app and database
npm run verify        # typecheck + lint + unit, what CI gates on
```

**Unit tests** cover the pure logic: JWT verification, prompt-injection
scanning, mojibake repair, clustering, plan limits, spam scoring and the
domain allow-list. They run anywhere in about a second.

**Integration tests** drive `/api/public/*` over real HTTP with real cookies
against a real database. Nothing is mocked, because the bugs worth catching
live between the route, the SQL and the identity rules. They read `.env.local`,
so locally they run against whatever project that points at and print the
target host before they start; set `TEST_SUPABASE_URL` and
`TEST_SERVICE_ROLE_KEY` to aim them elsewhere. Each file creates its own
workspace and deletes it afterwards. If no app or database answers, the suite
skips rather than fails.

### CI

`.github/workflows/ci.yml` runs typecheck and lint, the unit suite, the
integration suite against a throwaway Supabase stack it starts itself, and a
production build using placeholder environment values — which is also the
proof that the app builds without any real credential.

**It needs no GitHub Actions secrets.** Nothing in the workflow reads
`secrets.*`. If you later add a job that deploys or talks to the live
project, that is the point at which secrets become necessary; until then
there is nothing to configure, and nothing of yours is stored on GitHub.

Tests were checked by mutation: the implementation was deliberately broken
(accept any JWT algorithm, skip the signature check, remove the honeypot,
bypass the allow-list, reinstate the clustering drift bug) and each test that
should have caught it did. A test that has never failed has not been shown to
work.

## Integrations

Slack and Discord receive new feedback and status changes. GitHub and Linear
receive a post when the founder exports it.

Chat notifications are queued, never sent inline: a visitor's submission must
not wait on someone's webhook, nor fail because it was revoked last week. The
queue retries with a widening gap and switches an integration off after five
failures, because a webhook that has failed five times is gone rather than
slow.

Webhook URLs are checked against an exact host allow-list — `hooks.slack.com`
for Slack, Discord's own hosts for Discord. The field is typed in by a user
and then fetched by our server, so without that check it is a request
forwarder pointed at anything the server can reach, including link-local
metadata addresses. Suffix matching is not enough: `evilhooks.slack.com`
ends with the allowed host.

Credentials are written with the service role and never selected into the
browser. The dashboard is shown a redacted label (`hooks.slack.com/…aB3f`)
and when the integration last worked.

## Custom domains

A board can be served from the founder's own subdomain. Claiming one is not
owning one: the board is served only after a TXT record at
`_euclid.<domain>` proves control of the domain's DNS. A CNAME alone would
not do — anyone can point a hostname at us, and we would then answer for a
name that is not theirs.

Routing happens in middleware, before authentication: a request whose
hostname is not this deployment's is rewritten to the hosted board and
returns there, so no dashboard path is reachable on a customer's hostname.
The hostname is read from `x-forwarded-host` first, because behind a proxy
the `Host` header carries the internal name. If `NEXT_PUBLIC_APP_URL` is
unset the rewrite is skipped entirely, so a missing variable makes custom
domains inert rather than making the dashboard unreachable.

## Repository context

With GitHub connected, a Build Prompt can name real files instead of saying
"the relevant file". **Only the file listing is read — never the contents of
any file**, so no code passes through Euclid or reaches a model.

The listing is stored as a snapshot, so generating a prompt never waits on
GitHub. The prompt gets the directory shape, the files that identify the
stack, and a short list of paths whose names match the request — labelled as
matched on filename alone, because that is all it is.

The snapshot also sharpens the invented-path filter. Without a repository,
any path the model writes that the founder did not mention is replaced with
"the relevant file". With one, paths are checked against the real tree:
genuine ones survive, invented ones still do not.

## MCP server

A coding agent can reach a board directly at `POST /api/mcp`, carrying a key
the founder issues on the Install page. Four tools: `list_requests`,
`get_request`, `get_build_prompt`, `mark_shipped`.

The key decides which board the caller is talking to, so no request
parameter can widen the scope — there is no board id in the protocol to
tamper with. Keys are stored as a SHA-256 hash and shown once: a leaked
database row is not a usable credential, and nobody, us included, can read a
key back after it is issued.

`mark_shipped` creates a **draft** changelog entry. An agent does not publish
anything and does not email voters, and the tool description says so, because
an agent should not believe it is about to notify users.

Post and comment text reaching an agent is labelled as quoted user data. It
arrives from the public internet, and the MCP instructions say to read it as
a description of a request rather than as instructions.

```json
{
  "mcpServers": {
    "euclid": {
      "type": "http",
      "url": "https://your-deployment/api/mcp",
      "headers": { "Authorization": "Bearer euc_..." }
    }
  }
}
```

## Background jobs

Point a scheduler at these with `Authorization: Bearer $CRON_SECRET`:

- `POST /api/jobs/run` — drains the email outbox, clears expired magic links.
  Every few minutes.
- `POST /api/jobs/digest` — the weekly recommendation and embedding backfill.
  Weekly.

## Not built yet

Read-only GitHub repo context and the MCP server are P2 in the PRD and are not
here. Billing changes plans without charging — no payment provider is wired up.
Slack, Discord, GitHub and Linear integrations are placeholders on the Install
screen.
