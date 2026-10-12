/**
 * Whether the app has finished its first client render.
 *
 * Server-rendered content must not flash, so a mount animation has to know
 * whether it is being hydrated into existing markup or genuinely appearing.
 * During hydration this is false, and every presence wrapper renders its final
 * state — the markup the server sent. After that it is true, so a route
 * change, a new toast or an arriving comment animates in properly.
 *
 * Module scope rather than context: it is read during render, before any
 * effect in the same commit has run, which is exactly the timing we want.
 */
let hydrated = false;

export function markHydrated(): void {
  hydrated = true;
}

export function hasHydrated(): boolean {
  return hydrated;
}
