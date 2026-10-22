import { MAX_BATCH, type EventName, type Props, type WireEvent } from "./events";

/**
 * Sending captured events from the browser.
 *
 * Three properties this has to have, in order of how badly getting them wrong
 * would hurt:
 *
 * 1. **It cannot break the screen.** Every path here swallows its errors. An
 *    expired session, a blocked request, a 503 — none of them may surface to
 *    somebody trying to read their feedback board. Analytics that can break a
 *    dashboard is worse than no analytics.
 * 2. **It cannot be the reason a page feels slow.** Events are queued and
 *    flushed on a timer, one request per batch, and the flush is `sendBeacon`
 *    where it exists — which hands the bytes to the browser and returns
 *    without waiting for anything.
 * 3. **It cannot lose the last event.** The interesting event is often the
 *    last one before someone leaves, so the queue is also flushed on
 *    `pagehide` and when the tab is hidden. That is the case `fetch` alone
 *    gets wrong, because a navigation cancels it.
 */

const ENDPOINT = "/api/analytics";
const FLUSH_MS = 1500;
const SESSION_KEY = "euclid_analytics_session";

let queue: WireEvent[] = [];
let timer: ReturnType<typeof setTimeout> | null = null;
let listening = false;

/**
 * A per-tab id, in `sessionStorage` rather than a cookie.
 *
 * It exists to order one visit's screens and to count sessions. Deliberately
 * not persistent and not a cookie: it should be impossible to use this to
 * join two visits, because then it would be identity, and identity here
 * already comes from the session on the server.
 */
function sessionId(): string | null {
  try {
    const existing = window.sessionStorage.getItem(SESSION_KEY);
    if (existing) return existing;
    const minted = crypto.randomUUID().replace(/-/g, "").slice(0, 24);
    window.sessionStorage.setItem(SESSION_KEY, minted);
    return minted;
  } catch {
    // Private mode, or storage blocked. Events still send, unsessioned.
    return null;
  }
}

function send(batch: WireEvent[]): void {
  if (batch.length === 0) return;
  const body = JSON.stringify({ events: batch });

  try {
    if (typeof navigator !== "undefined" && typeof navigator.sendBeacon === "function") {
      // A Blob with a type, because a bare string is sent as text/plain and
      // the route reads JSON.
      const ok = navigator.sendBeacon(ENDPOINT, new Blob([body], { type: "application/json" }));
      if (ok) return;
      // sendBeacon refuses when its queue is full. Fall through rather than
      // dropping the batch.
    }

    void fetch(ENDPOINT, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      // Survives the navigation that is often the reason this is flushing.
      keepalive: true,
    }).catch(() => {});
  } catch {
    // Nothing here is worth a thrown error on somebody's dashboard.
  }
}

function flush(): void {
  if (timer) {
    clearTimeout(timer);
    timer = null;
  }
  const batch = queue;
  queue = [];
  send(batch);
}

function listen(): void {
  if (listening || typeof window === "undefined") return;
  listening = true;

  // `pagehide` rather than `unload`: it fires for the back/forward cache too,
  // which `unload` does not, and `unload` disables that cache when bound.
  window.addEventListener("pagehide", flush);
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "hidden") flush();
  });
}

/**
 * Record one event.
 *
 * Fire and forget by design: it returns nothing and awaits nothing, so a call
 * site never has to decide what to do when analytics fails. The name is typed
 * against the catalogue, so a typo is a build error rather than a row the
 * console cannot label.
 */
export function track(name: EventName, props?: Props): void {
  if (typeof window === "undefined") return;

  listen();
  queue.push({
    name,
    path: window.location.pathname,
    session: sessionId(),
    props,
  });

  // A full batch goes now rather than waiting out the timer.
  if (queue.length >= MAX_BATCH) {
    flush();
    return;
  }
  if (!timer) timer = setTimeout(flush, FLUSH_MS);
}
