import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { MotionLab } from "./motion-lab";

export const metadata: Metadata = { title: "Motion · Euclid" };

/**
 * The motion workbench. Every primitive, with a Replay button and a
 * reduced-motion toggle, so a change to the tokens can be judged in one place
 * instead of by hunting for a screen that happens to use it.
 *
 * Development only — it is a tool, not a page.
 */
export default function MotionDevPage() {
  if (process.env.NODE_ENV === "production") notFound();
  return <MotionLab />;
}
