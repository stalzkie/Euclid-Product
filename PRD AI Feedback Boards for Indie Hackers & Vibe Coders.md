# PRD: AI Feedback Boards for Indie Hackers & Vibe Coders

Oct 11, 2026 · @Grimdark Fantasy

## Summary

The product is an embeddable feedback board for indie hackers and vibe coders: one script tag puts a customizable board in any app, where users suggest and upvote features. An AI layer ranks and explains what users want, and a **Build Prompt** button turns any request into a ready-to-paste prompt for Claude Code, Codex, Cursor or any other AI coding tool.

The wedge is the last step. Existing feedback tools stop at "here is what users want." This one continues to "here is the prompt to build it," so a solo founder who ships by prompting can go from user request to shipped feature in one sitting.

- **Who:** solo founders and tiny teams who build with AI coding tools
- **Core loop:** collect, deduplicate and rank, generate Build Prompt, ship, announce in the changelog
- **Scope principle:** small enough for one person to build and run; every feature must pay for itself in the solo-founder workflow

## Problem and opportunity

Solo founders collect feedback in scattered places: DMs, email, X replies, Discord, and a contact form that nobody reads. There is no ranked list of what users want, so the loudest voice wins and the roadmap follows whoever messaged last.

Three gaps show up for this audience:

1. **Setup and pricing friction.** Feedback tools are mostly designed around product-team workflows (roadmaps, seats, approvals). A solo founder wants a board live in minutes and a flat, small bill.
2. **No signal from the noise.** Once 100+ posts exist, duplicates and near-duplicates hide the real demand. Founders have no time to cluster them by hand.
3. **The feedback-to-code gap.** Even a clear request needs real work before a coding agent can act on it: restating the stack, conventions, edge cases and what users actually said. Vibe coders do this translation daily, and many are unsure how to specify a feature well.

**Thesis:** AI coding tools have made building fast, so deciding what to build, and briefing the agent well, is now the slow part. A feedback product that owns that handoff has a position that general feedback tools do not.

## Target users

The primary buyer is a founder who ships alone or with one other person and builds mostly by prompting an AI coding tool. The end users of their app are a secondary audience: they never pay, but the product fails if they find the board clumsy.

| Persona | Profile | Job to be done | Pain today |
| --- | --- | --- | --- |
| Indie hacker (primary) | Solo SaaS founder, tens to a few thousand users, ships weekly | Know what to build next and show users they are heard | Feedback lives in DMs and email; no ranking |
| Vibe coder (primary) | Builds mainly by prompting Claude Code, Cursor, Lovable or similar; may have limited engineering background | Turn a user request into a working feature without writing a spec | Unsure how to brief the agent; prompts come out vague and the feature drifts |
| Micro-team (secondary) | 2 to 5 people, one or two developers | Lightweight prioritization without a PM tool | Heavy tools feel like overhead |
| End user (secondary) | Customer of the founder's app | Suggest a feature, vote, see its status | Contact forms feel like a black hole |

## Goals, non-goals and positioning

**v1 goals** (targets to validate, not measured facts):

- A founder goes from signup to a live embedded board in under 10 minutes.
- A Build Prompt generates in under 15 seconds at the median.
- At least 40% of active boards generate one or more Build Prompts within 30 days of launch.
- Duplicate suggestions catch the majority of repeat requests before they are posted.

**Non-goals for v1:**

- Enterprise features such as SAML SSO, audit logs and seat management
- Full roadmap or project management, or replacing an issue tracker
- Customer support ticketing or a help center
- Automatically committing code or opening pull requests
- Native mobile SDKs (the web widget works in mobile web views)

**Positioning.** Established feedback boards such as Canny, Featurebase, Fider and Upvoty already cover voting, roadmaps and changelogs, so the basic board is table stakes and not the pitch. The pitch is the combination: a board that takes minutes to install, analysis a solo founder can ask questions of, and a Build Prompt that hands the work to the founder's coding agent. Competitor features and pricing change quickly and were not re-checked for this draft; verify them before any external messaging.

## Feature 1: Embeddable feedback board

One script tag puts a board on any site. The founder designs it in a dashboard, and changes go live without redeploying their app.

```html
<script src="https://cdn.example.com/widget.js" data-board="BOARD_ID" async></script>
```

**Embed modes**

- **Inline:** the full board renders inside a container element on the founder's page.
- **Floating:** a button opens a side panel or modal on any page.
- **Hosted page:** a public URL on a subdomain, for sharing in a newsletter or on X. Custom domain is P1.

**Designer.** Each board's look is stored as a JSON config (colors, font, corner radius, light or dark theme, copy, layout, visible fields). The widget fetches it on load, so edits apply instantly. The dashboard shows a live preview beside the controls and ships with a handful of presets. Matching the host site's colors automatically is P2.

**Isolation.** The widget mounts in a Shadow DOM so the host app's CSS cannot break it, loads asynchronously, and must not block the host page.

**Identity, in three levels**

- **Anonymous:** cookie-based, with a vote limit per visitor. Zero friction, easy to game.
- **Email:** magic link, so votes and replies tie to a real address.
- **Signed JWT from the host app:** the founder's backend passes user ID, email and plan. This enables segment-aware analytics and plan-weighted votes. Copy-paste snippets for common auth setups (Supabase, Clerk, Auth.js) are P1.

**Posts and voting.** A post has a title, description, category and status (Under review, Planned, In progress, Shipped, Declined). Users upvote and comment. While typing a title, the submitter sees similar existing posts and is nudged to vote on one instead.

**Moderation and abuse control.** Allow-listed domains per board, rate limits, a honeypot field, a spam filter, and an optional approval queue.

**Changelog.** Marking a post Shipped creates a changelog entry and, if the founder chooses, emails everyone who voted.

## Feature 2: Analytics and AI assistant

The dashboard answers one question for a busy founder: what should I build next, and why? It combines plain counts with AI summaries that always point back to the underlying posts.

**Dashboard**

- Top requests by votes, plus vote velocity (what is rising this week)
- Status funnel from submitted to shipped
- Votes by segment when JWT identity is on (plan, signup date, custom attributes)
- Trend over time per theme

**Duplicate detection and merging.** Each post is embedded and compared with existing ones. Likely duplicates appear at submit time for users, and in a merge queue for the founder, where one click combines posts and their votes.

**Theme clustering.** Embeddings are clustered and an LLM names each cluster (for example, "Better onboarding" or "Export options"). Hundreds of scattered posts become a short list of themes with a combined vote count.

**AI recommendations.** A weekly digest ranks suggested priorities with reasons: demand, momentum, segment mix and effort signals from the founder's notes. Each recommendation links to its source posts.

**Chat assistant.** The founder asks questions in plain language, such as "What do paying users want most this month?" or "Which requests are quick wins?" The model answers by calling tools (list posts, count votes by segment, fetch trends, read comments) instead of receiving the whole database in its prompt. Answers cite the posts used, so the founder can verify them.

**Boundaries.** The assistant reads feedback data only. It cannot edit posts, change statuses or email users without the founder confirming the action.

## Feature 3: Build Prompt

From any post or theme, the founder clicks **Build Prompt** and gets a structured prompt for their AI coding tool of choice. Its quality depends on context the founder only has to enter once.

**Project profile (one-time setup).** Stack and framework, database, auth, UI library, hosting, coding conventions, and an optional pasted CLAUDE.md, AGENTS.md or rules file. A "detect from package.json" paste helper is P1.

**What goes into a prompt**

- The request itself, with the real wording users used (short quotes from posts and comments)
- Demand context: vote count, segments, related duplicates merged into it
- The project profile
- Optional founder notes ("keep it behind a feature flag")

**What comes out**

- Goal and user stories
- Acceptance criteria and edge cases
- Suggested approach, marked as a suggestion
- Out of scope
- Test plan
- A list of assumptions the AI made, so the founder can correct them

**Output targets**

| Target | Format | Notes |
| --- | --- | --- |
| Claude Code | Plan-first prompt, with optional CLAUDE.md-style context block | Asks the agent to propose a plan before editing |
| Codex | Task prompt, with optional AGENTS.md-style context block | Same structure, different packaging |
| Cursor | Prompt plus a rules-file snippet | Conventions can be saved as project rules |
| Lovable, Bolt, v0 | Chat-style prompt, no file paths | These tools work without repo access |
| Generic | Plain Markdown | Works anywhere; copy or download as .md |

Tool conventions change often, so each template needs a quick check against current docs before launch.

**Refinement.** A short chat beside the prompt lets the founder say "make it smaller" or "use Supabase row-level security," and regenerates it. Prompts are saved with the post so the history is visible.

**Safety and quality rules**

- Post text is untrusted. A malicious submission could try to inject instructions that a coding agent later follows. Posts are passed to the model as quoted data, suspicious content is flagged, and the founder reviews the full prompt before copying it. Nothing is ever executed automatically.
- Without repo access, the prompt must not invent file paths or function names. It describes what to change and lets the agent find where.
- Prompts have a length cap so they stay usable.

**Later (P2).** Read-only GitHub access so prompts reference real files and patterns, and an MCP server so a coding agent can fetch the top requests and the Build Prompt directly, then mark a post Shipped when done.

## Key user flows

**Core loop**

&#91;embedded content: core loop · 3 lanes, 6 steps\]

A user suggests an idea or votes, the product clusters and ranks requests, and the founder picks one, runs its Build Prompt in their coding tool and marks the post Shipped. Voters are notified and keep suggesting.

**Founder setup (target: under 10 minutes)**

1. Sign up and create a workspace.
2. Create a board and pick a design preset.
3. Fill in the project profile: stack, auth, conventions.
4. Copy the script tag into the app.
5. Open the live board and submit a test post.

**End-user submission**

1. Open the board from the founder's app.
2. Type a title and see similar posts as you type.
3. Vote on a match, or submit the new idea.
4. Get an email when its status changes, if an address was given.

## Requirements

P0 is the MVP, P1 follows within the first months after launch, and P2 is a later bet.

| Area | Requirement | Priority |
| --- | --- | --- |
| Widget | Single script tag; inline and floating modes; Shadow DOM isolation | P0 |
| Widget | Hosted public board page | P0 |
| Board | Posts, upvotes, comments, statuses | P0 |
| Board | Anonymous and email-magic-link identity | P0 |
| Board | Moderation queue, domain allow-list, rate limits, honeypot | P0 |
| Designer | JSON-config designer with live preview and presets | P0 |
| Changelog | Public changelog and voter email on Shipped | P0 |
| AI | Embedding-based duplicate suggestions and merge queue | P0 |
| Build Prompt | Project profile and prompt generation for Claude Code, Codex, Cursor, generic | P0 |
| Build Prompt | Prompt refinement chat, prompt history, copy and .md download | P1 |
| Analytics | Top requests, vote velocity, status funnel | P1 |
| AI | Theme clustering with LLM-named clusters | P1 |
| AI | Weekly recommendation digest | P1 |
| AI | Chat assistant with cited answers | P1 |
| Identity | Signed JWT from host app, segments and plan-weighted votes | P1 |
| Board | Custom domain for the hosted page | P1 |
| Integrations | Slack or Discord notifications; GitHub or Linear issue export | P1 |
| Build Prompt | Read-only GitHub repo context | P2 |
| Build Prompt | MCP server so coding agents can fetch requests and prompts | P2 |
| Designer | Auto-match host site colors | P2 |

**Non-functional requirements**

- **Performance:** widget bundle target of 40 KB gzipped or less; loads async; p95 API response under 300 ms for board reads.
- **Accessibility:** WCAG 2.1 AA for the widget and hosted page, including keyboard voting.
- **Security:** per-board domain allow-list, signed JWT verification, rate limiting, output sanitization, and prompt-injection defenses on every AI path.
- **Privacy:** data export and deletion endpoints for end users, per-board retention settings.
- **Reliability:** a widget outage must degrade silently and never break the host app.
- **AI cost control:** per-account usage caps and metering on prompt generation and chat.

## Architecture and data model

&#91;embedded content: system architecture · 7 components\]

The widget, the dashboard and (later) coding tools all talk to one API. Anything slow or expensive, such as embeddings, clustering, digests and emails, runs in a queue so board reads stay fast.

**Suggested stack** (a starting point, not a requirement)

- A full-stack TypeScript web framework for the dashboard and API
- Postgres with the pgvector extension for posts, votes and embeddings
- A small bundle for the widget (Preact or similar), served from a CDN
- A Postgres-backed job queue, to keep infrastructure minimal
- One LLM provider API for chat and Build Prompt, plus an embeddings model

**Core entities**

- **Workspace** owns Boards, a project profile and a plan
- **Board** has a design config (JSON), allowed domains and an identity mode
- **Post** has a title, description, category, status, an optional merged-into link and an embedding
- **Vote** and **Comment** belong to a Post and an EndUser
- **EndUser** is anonymous, email-verified or JWT-identified, with optional segment attributes
- **Theme** groups Posts by cluster and carries an LLM-written name
- **BuildPrompt** stores the target tool, the generated text, its assumptions and its history
- **ChangelogEntry** links to a shipped Post

**AI design notes**

- Chat uses read-only tools scoped to one board; it never sees another customer's data.
- Build Prompt uses one template per target tool with structured output, then a check that no file paths were invented when no repo is connected.
- Keep a small fixed set of sample requests and compare generated prompts against it whenever a template or model changes.
- Use a cheaper model for routine jobs such as naming clusters, and a stronger one for Build Prompt.

## Pricing and packaging

Pricing is a proposal to test in customer interviews, not a validated number. The principle is flat, small plans with no per-tracked-user fees, because indie hackers dislike bills that grow with their success. AI features are metered in monthly credits because they cost real tokens.

| Plan | Price (proposed) | Includes |
| --- | --- | --- |
| Free | $0 | 1 board, anonymous and email identity, basic moderation, 3 Build Prompts per month, "Powered by" badge |
| Indie | $12 per month | 3 boards, badge removed, JWT identity, analytics, duplicate merging, 50 Build Prompts per month |
| Pro | $29 per month | Unlimited boards, chat assistant, recommendations digest, custom domain, 300 Build Prompts per month, GitHub context (when shipped) |

**Open pricing options:** bring-your-own LLM key as a cheaper tier (attractive to developers, but adds support burden), and a one-time lifetime deal for early adopters (cash up front, but a long-run AI cost liability).

## Success metrics and launch

All targets are starting hypotheses for the first 90 days after public launch.

| Metric | Target | Why it matters |
| --- | --- | --- |
| Time from signup to live board | Under 10 minutes (median) | Setup friction is the main reason founders abandon tools |
| Signups that embed within 7 days | 60% | Measures activation |
| Active boards generating a Build Prompt within 30 days | 40% | Proves the differentiator is used |
| Prompts copied after generation | 70% of generated prompts | Prompt quality proxy |
| Free to paid conversion | 5% | Revenue viability |
| Monthly board churn | Under 5% | Retention |

**Launch plan**

- **Dogfood:** the product's own feedback board runs on the product, and its changelog is the public build log.
- **Design partners:** recruit 5 to 10 indie hackers before launch; their boards become case studies.
- **Distribution:** build-in-public posts on X, Indie Hackers and relevant developer communities, plus a launch on Product Hunt.
- **Growth loop:** the free-tier "Powered by" badge, and ready-made install guides for popular frameworks and AI app builders.

## Roadmap

&#91;embedded content: roadmap · 4 phases, 3 gates\]

The MVP is every P0 requirement, which means phases 0 and 1. The bands are equal width and not drawn to scale. Week ranges are estimates for one full-time builder, so stretch them to match the hours actually available. Gate criteria are proposals to revisit after the first design partners.

## Risks, privacy and open questions

| Risk | Impact | Mitigation |
| --- | --- | --- |
| Crowded market; incumbents add AI features | Wedge erodes | Stay focused on indie hackers and vibe coders; make Build Prompt and the MCP server the core, not the board |
| Prompt injection through user posts into coding agents | Founder's agent follows a malicious instruction | Treat posts as quoted data, flag suspicious content, require founder review, never auto-execute |
| Generic or wrong prompts without repo context | Founders stop trusting the feature | Project profile, assumption list, no invented paths, GitHub context in P2 |
| Spam and vote manipulation on anonymous boards | Board loses credibility | Rate limits, domain allow-list, JWT identity option, moderation queue |
| AI cost outpaces revenue | Margin loss | Credits, caps, caching of embeddings and summaries, cheaper models for routine tasks |
| Vibe-coder audience has low willingness to pay | Weak revenue | Free tier as a growth loop; prove value with the Build Prompt before charging for the rest |

**Privacy and compliance.** The product stores end-user emails and feedback on behalf of its customers, so it acts as a data processor. Needs: a data processing agreement, a subprocessor list (including the LLM provider), export and delete endpoints, retention settings, and confirmation that customer content is not used to train third-party models. Get legal review before launch; requirements vary by region.

**Open questions**

- What is the product name and domain?
- Open-source or self-hostable core, as Fider does, or hosted only?
- Should bring-your-own LLM key be offered at launch?
- Which identity method should the default install snippet use: anonymous or email?
- How should plan-weighted votes be shown, if at all, so end users do not feel ranked by payment?
