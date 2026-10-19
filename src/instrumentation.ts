/**
 * Next's error hook, wired to `error_events`.
 *
 * `onRequestError` fires for every uncaught server error — route handlers,
 * server components, server actions — which is the whole point: the failures
 * worth knowing about are the ones nobody wrote a catch for. A try/catch in
 * each route would only ever record the errors somebody already anticipated.
 *
 * Deliberately not `register()`: nothing here needs to run at boot.
 */
export async function onRequestError(
  error: unknown,
  request: { path?: string; method?: string },
): Promise<void> {
  // Imported lazily so neither runtime pays for the Supabase client until
  // something actually fails. `recordError` itself is Edge-safe — see the
  // note on `hash` in that file for why the fingerprint is not SHA-256.
  const { recordError } = await import("@/server/errors");
  const route = request.path ? `${request.method ?? "GET"} ${request.path}` : null;
  await recordError(error, route);
}
