import { NextResponse } from "next/server";

/**
 * The public API is called from the founder's own domain, so it answers CORS.
 * Per-board authorisation is the real gate; the allow-list check lives in
 * `originAllowed`, not here.
 */
export function cors(response: NextResponse): NextResponse {
  response.headers.set("Access-Control-Allow-Origin", "*");
  response.headers.set("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  response.headers.set("Access-Control-Allow-Headers", "content-type");
  response.headers.set("Cache-Control", "no-store");
  return response;
}

export function preflight(): NextResponse {
  return cors(new NextResponse(null, { status: 204 }));
}
