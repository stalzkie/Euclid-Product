"use client";

import { useRouter } from "next/navigation";
import { useTransition } from "react";
import { OnboardShell } from "@/components/onboarding";
import { InstallPanel } from "@/components/install-panel";
import { Button } from "@/components/ui";
import { Spinner } from "@/components/controls";
import type { EmbedMode, IdentityMode, StackItem } from "@/lib/types";
import { finishOnboarding } from "../actions";

export function InstallStep(props: {
  boardPublicId: string;
  boardName: string;
  origin: string;
  mode: EmbedMode;
  identityMode: IdentityMode;
  allowedDomains: string[];
  stack: StackItem[];
  installed: boolean;
}) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const finish = () =>
    start(async () => {
      await finishOnboarding();
      router.push("/");
    });

  return (
    <OnboardShell
      step={3}
      title="Put the board in your app"
      subtitle="One script, loaded async. If Euclid is ever down, your app never notices."
      back={{ href: "/onboarding/profile" }}
      skip={{ href: "/", label: "Skip for now" }}
      next={
        <Button variant="primary" disabled={pending} onClick={finish}>
          {pending ? <Spinner /> : null}
          Go to dashboard
        </Button>
      }
    >
      <InstallPanel
        boardPublicId={props.boardPublicId}
        boardName={props.boardName}
        origin={props.origin}
        initialMode={props.mode}
        identityMode={props.identityMode}
        stack={props.stack}
        allowedDomains={props.allowedDomains}
        installed={props.installed}
        compact
      />
    </OnboardShell>
  );
}
