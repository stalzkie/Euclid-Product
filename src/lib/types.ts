/**
 * Domain types. These mirror the tables in supabase/migrations exactly — if a
 * column moves, it moves here too.
 */

export type PostStatus =
  | "under_review"
  | "planned"
  | "in_progress"
  | "shipped"
  | "declined";

export type PlanTier = "free" | "indie" | "pro";
export type IdentityMode = "anonymous" | "email" | "jwt";
export type EmbedMode = "inline" | "floating";
export type EndUserKind = "anonymous" | "email" | "jwt";
export type PromptTarget = "claude" | "codex" | "cursor" | "builder" | "generic";

/** The five statuses, in the order the UI always lists them. */
export const POST_STATUSES: PostStatus[] = [
  "under_review",
  "planned",
  "in_progress",
  "shipped",
  "declined",
];

export const STATUS_LABEL: Record<PostStatus, string> = {
  under_review: "Under review",
  planned: "Planned",
  in_progress: "In progress",
  shipped: "Shipped",
  declined: "Declined",
};

/**
 * Status chip colours from Foundations: grey for untriaged, blue for planned,
 * amber for in-flight, green for shipped, red for declined.
 */
export const STATUS_LOOK: Record<PostStatus, { bg: string; fg: string; dot: string }> = {
  under_review: { bg: "#F1F1EF", fg: "#5F5F66", dot: "#A1A1AA" },
  planned: { bg: "#EEF6FF", fg: "#0A72DC", dot: "#1A8CFF" },
  in_progress: { bg: "#FFF7E6", fg: "#B45309", dot: "#F59E0B" },
  shipped: { bg: "#ECFDF3", fg: "#15803D", dot: "#16A34A" },
  declined: { bg: "#FEF2F2", fg: "#DC2626", dot: "#DC2626" },
};

export function statusFromLabel(label: string): PostStatus | null {
  const hit = POST_STATUSES.find((s) => STATUS_LABEL[s] === label);
  return hit ?? null;
}

/** Design config stored on every board and fetched by the widget on load. */
export interface BoardDesign {
  preset: string;
  accent: string;
  theme: "Light" | "Dark" | "Auto";
  radius: "Sharp" | "Soft" | "Round";
  mode: EmbedMode;
  heading: string;
  subheading: string;
  submitCta: string;
  showStatuses: boolean;
  showComments: boolean;
  showChangelog: boolean;
  showRoadmap: boolean;
  showVoteCounts: boolean;
}

export interface Workspace {
  id: string;
  name: string;
  slug: string;
  plan: PlanTier;
  billing_period: "monthly" | "yearly";
  coding_tools: string[];
  app_name: string | null;
  app_url: string | null;
  prompts_used: number;
  chat_credits_used: number;
  /**
   * Allowance bought with a top-up, on top of the plan's monthly one.
   *
   * A balance that depletes, not a larger limit: `roll_usage_period` clears
   * the two `_used` counters each month and deliberately leaves these alone,
   * so a founder keeps what they paid for. See `Allowance` in `plans.ts`.
   */
  extra_prompts: number;
  extra_chat_credits: number;
  usage_period_start: string;
  onboarded_at: string | null;
  created_at: string;
  /** Polar's ids. Null on every workspace that has never been to checkout. */
  polar_customer_id: string | null;
  polar_subscription_id: string | null;
  /** Polar's status verbatim — `active`, `past_due`, `canceled`, … */
  subscription_status: string | null;
  /** End of the paid period. A cancelled plan keeps its tier until this. */
  current_period_end: string | null;
  /** The address the student discount was granted against, if any. */
  student_email: string | null;
  /** When it was granted. Expiry is computed from this, not stored. */
  student_verified_at: string | null;
}

export interface StackItem {
  kind: string;
  name: string;
}

export interface ProjectProfile {
  workspace_id: string;
  stack: StackItem[];
  conventions: string | null;
  rules_file: string | null;
  rules_file_name: string | null;
  updated_at: string;
}

export interface Board {
  id: string;
  workspace_id: string;
  public_id: string;
  name: string;
  slug: string;
  color: string;
  description: string | null;
  identity_mode: IdentityMode;
  allowed_domains: string[];
  anon_vote_limit: number;
  require_approval: boolean;
  show_badge: boolean;
  custom_domain: string | null;
  /** Null until a TXT record has proved the domain belongs to this board. */
  custom_domain_token: string | null;
  custom_domain_verified_at: string | null;
  design: BoardDesign;
  categories: string[];
  created_at: string;
}

export interface Theme {
  id: string;
  board_id: string;
  name: string;
  summary: string | null;
  created_at: string;
  updated_at: string;
}

export interface Post {
  id: string;
  board_id: string;
  number: number;
  title: string;
  body: string | null;
  category: string | null;
  status: PostStatus;
  theme_id: string | null;
  author_id: string | null;
  merged_into: string | null;
  /** Headcount. One person, one vote. This is the number end users see. */
  vote_count: number;
  /**
   * Sum of vote weights. Never shown to end users — it only orders the
   * founder's view when the board knows who is paying.
   */
  weighted_score: number;
  comment_count: number;
  approved: boolean;
  spam_score: number;
  injection_flagged: boolean;
  founder_notes: string | null;
  pinned: boolean;
  created_at: string;
  updated_at: string;
  shipped_at: string | null;
  /** Set once the post has been exported to an issue tracker. */
  external_url: string | null;
  external_kind: "github" | "linear" | null;
}

export interface Comment {
  id: string;
  post_id: string;
  end_user_id: string | null;
  author_user_id: string | null;
  author_name: string | null;
  body: string;
  internal: boolean;
  pinned: boolean;
  created_at: string;
}

export interface EndUser {
  id: string;
  board_id: string;
  kind: EndUserKind;
  external_key: string;
  email: string | null;
  email_verified: boolean;
  name: string | null;
  segments: Record<string, string>;
  vote_weight: number;
}

export interface Assumption {
  id: number;
  text: string;
  confirmed: boolean;
}

export interface BuildPrompt {
  id: string;
  workspace_id: string;
  post_id: string | null;
  theme_id: string | null;
  target: PromptTarget;
  version: number;
  title: string;
  body: string;
  context_block: string | null;
  assumptions: Assumption[];
  includes: PromptIncludes;
  founder_notes: string | null;
  token_estimate: number;
  copied: boolean;
  created_at: string;
}

/** The five toggles beside the prompt on the Build Prompt screen. */
export interface PromptIncludes {
  quotes: boolean;
  demand: boolean;
  profile: boolean;
  rules: boolean;
  notes: boolean;
}

export const DEFAULT_INCLUDES: PromptIncludes = {
  quotes: true,
  demand: true,
  profile: true,
  rules: true,
  notes: true,
};

export interface ChangelogEntry {
  id: string;
  board_id: string;
  title: string;
  body: string;
  published: boolean;
  published_at: string | null;
  notify_voters: boolean;
  voters_notified: number;
  show_badge: boolean;
  created_at: string;
  updated_at: string;
}

export interface Citation {
  number: number;
  title: string;
  votes: number;
  id?: string;
}

export interface ChatStep {
  tool: string;
  detail: string;
}

export interface ChatMessage {
  id: string;
  thread_id: string;
  role: "user" | "assistant";
  content: string;
  steps: ChatStep[];
  citations: Citation[];
  follow_ups: string[];
  created_at: string;
}

export interface Recommendation {
  id: string;
  board_id: string;
  headline: string;
  reasons: string[];
  source_posts: { number: number; title: string }[];
  theme_id: string | null;
  created_at: string;
}

export interface ActivityItem {
  id: string;
  kind: string;
  text: string;
  meta: string | null;
  post_id: string | null;
  created_at: string;
}

export interface DuplicateSuggestion {
  id: string;
  post_id: string;
  target_id: string;
  similarity: number;
  state: "pending" | "merged" | "dismissed";
}
