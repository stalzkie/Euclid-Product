"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { Card, SectionTitle } from "@/components/ui";
import { ToggleRow } from "@/components/controls";
import { setReduceMotion } from "./motion-actions";

/**
 * The in-app reduced-motion switch, which overrides the operating system
 * setting rather than reading it. Some founders leave the OS setting off
 * because it changes everything else on their machine.
 */
export function MotionPanel({ initial }: { initial: boolean }) {
  const router = useRouter();
  const [on, setOn] = useState(initial);
  const [, start] = useTransition();

  return (
    <Card className="flex flex-col gap-3 p-[18px]">
      <SectionTitle>Motion</SectionTitle>
      <ToggleRow
        label="Reduce motion"
        detail="Removes movement across Euclid and keeps only short fades. On automatically if your system already asks for it."
        checked={on}
        onChange={(next) => {
          setOn(next);
          start(async () => {
            await setReduceMotion(next);
            // The layouts read the cookie, so the whole tree needs re-rendering.
            router.refresh();
          });
        }}
      />
    </Card>
  );
}
