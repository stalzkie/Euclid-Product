import { HashCallback } from "./hash-callback";

/**
 * Finishes an implicit-flow sign-in, where the token arrives in the URL
 * fragment. `/auth/callback` redirects here when there is no code in the
 * query; the fragment rides along, because browsers carry it across a
 * redirect that does not specify one.
 *
 * It has to be a page rather than a route handler for the mirror of the
 * reason the callback has to be a route handler: only the browser can read a
 * fragment, so this one needs to render.
 */
export default async function AuthHashPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  return <HashCallback next={next ?? null} />;
}
