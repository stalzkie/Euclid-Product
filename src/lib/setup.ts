/**
 * The setup checklist: what a founder still has to do, derived rather than
 * stored.
 *
 * A founder's first session ends at the install screen and the app stops
 * guiding them there. The steps that matter next — lock the allow-list, get a
 * first post, generate a Build Prompt — are discoverable only by wandering
 * into the right screen.
 *
 * Every step below is a question the database can already answer, so nothing
 * here is a new piece of state to keep in sync with reality. That is the whole
 * design: a checklist with its own `completed` column drifts the moment
 * someone does a step by a route nobody thought of, and then lies.
 *
 * Pure, so the ordering and the done-ness can be tested without a database.
 */

export interface SetupFacts {
  /** The project profile has something in it. */
  hasProfile: boolean;
  /** The widget has been served to a page that is not ours (0024). */
  installed: boolean;
  /** The board's allow-list is not empty, so it will not load anywhere. */
  domainsLocked: boolean;
  /** Anyone has posted. */
  hasPosts: boolean;
  /** A Build Prompt has been generated. */
  hasPrompt: boolean;
  /** Something has been published to the changelog. */
  hasShipped: boolean;
}

export interface SetupStep {
  id: string;
  title: string;
  /** What doing it gets them, in one line. Not instructions. */
  detail: string;
  href: string;
  done: boolean;
}

/**
 * The steps, in the order they unblock each other.
 *
 * Install before allow-list, because a founder who locks the list first and
 * then installs on a domain they forgot to add gets a widget that silently
 * refuses to load — which looks like a broken install, not a configuration
 * mistake. Feedback before Build Prompt because a prompt needs a request to
 * be about.
 *
 * `hasPosts` deliberately does not depend on `installed`. Someone can post
 * through the hosted board at /b/:id without the widget ever being embedded,
 * and telling that founder they have not received feedback would be wrong.
 */
export function setupSteps(facts: SetupFacts): SetupStep[] {
  return [
    {
      id: "profile",
      title: "Describe what you are building",
      detail: "Build Prompts use it, so they read like your codebase rather than a generic brief.",
      href: "/profile",
      done: facts.hasProfile,
    },
    {
      id: "install",
      title: "Install the widget",
      detail: "One script tag. The board goes live on your own site.",
      href: "/install",
      done: facts.installed,
    },
    {
      id: "domains",
      title: "Lock your allowed domains",
      detail: "Until you do, the widget will load on anyone's site.",
      href: "/install#domains",
      done: facts.domainsLocked,
    },
    {
      id: "feedback",
      title: "Get your first request",
      detail: "Post one yourself to see the loop end to end.",
      href: "/feedback",
      done: facts.hasPosts,
    },
    {
      id: "prompt",
      title: "Generate a Build Prompt",
      detail: "Turns what users asked for into a brief your coding agent can act on.",
      href: "/prompts/new",
      done: facts.hasPrompt,
    },
    {
      id: "ship",
      title: "Ship something and say so",
      detail: "Everyone who voted gets told. It is the half of feedback people remember.",
      href: "/changelog",
      done: facts.hasShipped,
    },
  ];
}

/** How far along, for the progress line. */
export function setupProgress(steps: SetupStep[]): { done: number; total: number } {
  return { done: steps.filter((s) => s.done).length, total: steps.length };
}

/**
 * Whether to show the thing at all.
 *
 * Hidden once every step is done, because a checklist with nothing left on it
 * is clutter that the founder then has to dismiss — finishing it should be
 * the dismissal. Hidden when explicitly dismissed, whether finished or not.
 */
export function showSetup(steps: SetupStep[], dismissedAt: string | null | undefined): boolean {
  if (dismissedAt) return false;
  return steps.some((s) => !s.done);
}
