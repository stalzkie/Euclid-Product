"use server";

import { cookies } from "next/headers";
import {
  REDUCE_MOTION_COOKIE,
  REDUCE_MOTION_MAX_AGE,
} from "@/lib/motion/preference";

/**
 * Store the "Reduce motion" preference.
 *
 * A cookie rather than a row on the workspace: it is about this browser, not
 * the account, and the layouts have to know it before they render.
 */
export async function setReduceMotion(on: boolean): Promise<void> {
  const store = await cookies();

  if (on) {
    store.set(REDUCE_MOTION_COOKIE, "1", {
      maxAge: REDUCE_MOTION_MAX_AGE,
      sameSite: "lax",
      path: "/",
    });
  } else {
    store.delete(REDUCE_MOTION_COOKIE);
  }
}
