/**
 * The catalogue of captured events, and the rules for what may be written.
 *
 * Shared by the browser that sends them and the route that stores them, and
 * pure so both can be tested without either. Three decisions live here:
 *
 * **An allow-list, not a free text field.** A name the catalogue does not
 * know is dropped. The cost is that adding an event is a code change; what it
 * buys is that the console can label and group every row it reads, and that a
 * session cannot be used to write arbitrary strings into a table that spans
 * every workspace. An analytics table whose contents nobody can enumerate is
 * one nobody can trust, and it becomes a dumping ground within a month.
 *
 * **Only what state cannot answer.** There is no `post.created` here, because
 * `posts.created_at` already records it and cannot disagree with itself. What
 * is here is attention — screens opened, steps abandoned, intentions that
 * leave no row.
 *
 * **Nothing identifying in the properties.** The route already knows who sent
 * an event, from the session; a prop carrying an address would be the same
 * fact recorded a second time in the one place with no policies on it.
 * `cleanProps` enforces that rather than trusting the convention.
 */

/* -------------------------------------------------------------------------- */
/* The catalogue                                                              */
/* -------------------------------------------------------------------------- */

/**
 * Every event the dashboard may send, with how the console labels it.
 *
 * `screen.*` is a view of a dashboard screen, fired once per mount — not per
 * render and not on a prefetch, since a prefetched route is never mounted.
 * Anything else is an action that would otherwise leave no trace.
 */
export const EVENT_CATALOGUE = {
  "screen.home": "Home",
  "screen.feedback": "Feedback",
  "screen.post": "Post detail",
  "screen.themes": "Themes",
  "screen.prompts": "Build Prompts",
  "screen.prompt": "Build Prompt detail",
  "screen.prompt_new": "Build Prompt · new",
  "screen.ask": "Ask Euclid",
  "screen.insights": "Insights",
  "screen.changelog": "Changelog",
  "screen.designer": "Board designer",
  "screen.install": "Install",
  "screen.billing": "Billing",
  "screen.profile": "Profile",

  "onboarding.app": "Onboarding · your app",
  "onboarding.profile": "Onboarding · project profile",
  "onboarding.install": "Onboarding · install",

  /*
    Intentions, which are the only actions worth capturing: each is a thing a
    founder did that leaves no row behind.

    Three candidates were cut while writing this, and the reasons are the rule
    for adding a fourth. `prompt.copied` already calls `markCopied`, so
    `build_prompts.copied` records it permanently. `designer.saved` writes
    `boards.design`, and a design that differs from the default says the same
    thing. `install.doctor_run` would have measured a polling effect rather
    than a person, because the install panel runs the doctor on a timer.
  */
  "install.snippet_copied": "Install snippet copied",
  "install.agent_prompt_copied": "Agent install prompt copied",
  "billing.upgrade_clicked": "Upgrade clicked",
} as const;

export type EventName = keyof typeof EVENT_CATALOGUE;

export const EVENT_NAMES = Object.keys(EVENT_CATALOGUE) as EventName[];

const KNOWN: ReadonlySet<string> = new Set<string>(EVENT_NAMES);

/**
 * A set rather than `name in EVENT_CATALOGUE`.
 *
 * `in` walks the prototype chain, so it answers true for `constructor`,
 * `toString` and `__proto__` — and a client sending one of those would have
 * passed this check, been refused by the check constraint in 0032, and taken
 * the whole batch down with it, losing the real events alongside it.
 */
export function isEventName(name: unknown): name is EventName {
  return typeof name === "string" && KNOWN.has(name);
}

export function eventLabel(name: string): string {
  // Same reasoning as `isEventName`: an own-property lookup, so a row written
  // by an older deploy is labelled by its own name rather than by whatever
  // `Object.prototype` happens to hold.
  return KNOWN.has(name) ? (EVENT_CATALOGUE as Record<string, string>)[name] : name;
}

/** Screens, for the "which screens get opened" panel. */
export const SCREEN_NAMES = EVENT_NAMES.filter((n) => n.startsWith("screen."));

/**
 * The onboarding steps, in the order the product walks them.
 *
 * Ordered here rather than inferred from the names, because the funnel on the
 * console is only meaningful in the product's order and alphabetical happens
 * to be wrong: app, then profile, then install.
 */
export const ONBOARDING_STEPS: EventName[] = [
  "onboarding.app",
  "onboarding.profile",
  "onboarding.install",
];

/* -------------------------------------------------------------------------- */
/* Properties                                                                 */
/* -------------------------------------------------------------------------- */

export type PropValue = string | number | boolean;
export type Props = Record<string, PropValue>;

/** At most this many keys survive. More than this is a payload, not a property. */
export const MAX_PROPS = 10;
/** Longer strings are truncated rather than dropped: the prefix is the useful part. */
export const MAX_PROP_LENGTH = 120;
/** Events per request. A tab that wants to send more can send twice. */
export const MAX_BATCH = 25;

const KEY = /^[a-z][a-z0-9_]{0,39}$/;
// Deliberately loose: this is not validating addresses, it is refusing
// anything shaped like one.
const EMAILISH = /[^\s@]+@[^\s@]+\.[^\s@]+/;

/**
 * What of a property bag may be stored.
 *
 * Scrubs rather than rejects. A bad prop is a mistake in one call site, and
 * losing the whole event over it would lose the fact that the screen was
 * opened at all — which is the part that mattered.
 */
export function cleanProps(input: unknown): Props {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};

  const out: Props = {};
  for (const [key, value] of Object.entries(input as Record<string, unknown>)) {
    if (Object.keys(out).length >= MAX_PROPS) break;
    if (!KEY.test(key)) continue;

    if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number") {
      // A non-finite number is not JSON, and Postgres will not take it.
      if (Number.isFinite(value)) out[key] = value;
    } else if (typeof value === "string") {
      const trimmed = value.trim();
      if (!trimmed) continue;
      // The one hard rule: no addresses in here. The route knows who sent
      // this from the session, and this table has no policies on it.
      if (EMAILISH.test(trimmed)) continue;
      out[key] = trimmed.slice(0, MAX_PROP_LENGTH);
    }
    // Objects, arrays, null and undefined are dropped: `props` is flat so the
    // console can render any row it finds without knowing its shape.
  }
  return out;
}

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * A URL as a route: no query, no hash, ids collapsed.
 *
 * `/posts/42?from=home#top` becomes `/posts/:n`. Grouping is the obvious
 * reason; the better one is that a query string is where a token, an address
 * or a promo code ends up, and none of those belong in a table the console
 * reads in bulk.
 */
export function normalisePath(input: unknown): string | null {
  if (typeof input !== "string") return null;

  const withoutQuery = input.split(/[?#]/)[0].trim();
  if (!withoutQuery.startsWith("/")) return null;

  const parts = withoutQuery
    .split("/")
    .filter(Boolean)
    .map((segment) => {
      if (UUID.test(segment)) return ":id";
      if (/^\d+$/.test(segment)) return ":n";
      // A board's public id is not a uuid but is just as identifying.
      if (/^(brd|pub)_[a-z0-9]+$/i.test(segment)) return ":board";
      return segment.slice(0, 40);
    });

  return `/${parts.join("/")}`.slice(0, 200);
}

/* -------------------------------------------------------------------------- */
/* The wire shape                                                             */
/* -------------------------------------------------------------------------- */

/** One event as the browser sends it. Identity and time are not its business. */
export interface WireEvent {
  name: string;
  path?: string | null;
  session?: string | null;
  props?: unknown;
}

export interface CleanEvent {
  name: EventName;
  path: string | null;
  session: string | null;
  props: Props;
}

/**
 * The batch, filtered to what may be written.
 *
 * Unknown names are dropped silently. A browser running a cached bundle from
 * before a rename is the common case, and a 400 would turn that into a
 * console error on a screen the founder is trying to use.
 */
export function cleanBatch(input: unknown): CleanEvent[] {
  if (!Array.isArray(input)) return [];

  const out: CleanEvent[] = [];
  for (const raw of input.slice(0, MAX_BATCH)) {
    if (!raw || typeof raw !== "object") continue;
    const event = raw as WireEvent;
    if (!isEventName(event.name)) continue;

    const session = typeof event.session === "string" ? event.session.slice(0, 64) : null;
    out.push({
      name: event.name,
      path: normalisePath(event.path),
      session: session && /^[A-Za-z0-9_-]+$/.test(session) ? session : null,
      props: cleanProps(event.props),
    });
  }
  return out;
}
