"use client";

import { useState, useTransition } from "react";
import { AiCard, AiLabel, Button, cx } from "@/components/ui";
import { Spinner } from "@/components/controls";
import { darkenToContrast, parseColor, toHex, type DesignMatch } from "@/lib/design-match";
import type { BoardDesign } from "@/lib/types";
import { matchAppDesign } from "./actions";

/**
 * Reads the founder's own site and offers its colours as a starting point.
 *
 * Nothing applies on its own: the proposal, and the reasoning behind each part
 * of it, is shown first. A palette read off a page is a guess, and a guess
 * that silently rewrote the board would be worse than no feature at all.
 */
export function MatchSite({
  appUrl,
  onApply,
}: {
  appUrl: string | null;
  onApply: (patch: Partial<BoardDesign>) => void;
}) {
  const [match, setMatch] = useState<DesignMatch | null>(null);
  const [from, setFrom] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [applied, setApplied] = useState<string | null>(null);
  const [pending, start] = useTransition();

  const read = () =>
    start(async () => {
      setError(null);
      setApplied(null);
      const res = await matchAppDesign();
      if (res.ok) {
        setMatch(res.match);
        setFrom(res.url);
      } else {
        setMatch(null);
        setError(res.error);
      }
    });

  const apply = (accent: string) => {
    if (!match) return;
    onApply({
      preset: "matched",
      accent,
      theme: match.theme,
      radius: match.radius,
    });
    setApplied(accent);
  };

  // A candidate the founder picks instead gets the same readability treatment
  // the proposed accent got, so swapping colour cannot produce a button nobody
  // can read.
  const safeAccent = (hex: string) => {
    const rgb = parseColor(hex);
    return rgb ? toHex(darkenToContrast(rgb)) : hex;
  };

  return (
    <AiCard className="flex flex-col gap-3">
      <AiLabel>Match my site</AiLabel>

      {!match && (
        <p className="text-[13px] text-ink-2">
          {appUrl
            ? `Read the colours off ${hostOf(appUrl)} and start from those.`
            : "Add your app's URL on the project profile and this can read its colours."}
        </p>
      )}

      {error && <p className="text-[13px] text-bad">{error}</p>}

      {match && (
        <>
          <div className="flex flex-wrap items-center gap-2">
            <Swatch label="Accent" hex={match.accent} />
            <Swatch label="Background" hex={match.background} />
            <span className="rounded-chip border border-line bg-canvas px-[7px] py-[2px] text-[12px] text-ink-2">
              {match.theme} · {match.radius} corners
            </span>
          </div>

          <ul className="flex flex-col gap-[6px] text-[12.5px] text-ink-2">
            {match.notes.map((note) => (
              <li key={note} className="flex gap-2">
                <span aria-hidden="true" className="text-ink-3">
                  ·
                </span>
                <span>{note}</span>
              </li>
            ))}
          </ul>

          {match.candidates.length > 1 && (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[12.5px] text-ink-2">Or use:</span>
              {match.candidates.slice(1).map((c) => (
                <button
                  key={c.hex}
                  type="button"
                  aria-label={`Use ${c.hex} as the accent`}
                  onClick={() => apply(safeAccent(c.hex))}
                  className={cx(
                    "h-7 w-7 rounded-control border-2",
                    applied === safeAccent(c.hex) ? "border-state-bright" : "border-transparent",
                  )}
                >
                  <span
                    className="block h-full w-full rounded-chip"
                    style={{ background: c.hex }}
                  />
                </button>
              ))}
            </div>
          )}

          {from && (
            <p className="text-[12px] text-ink-3">
              Read from {from}
              {match.adjusted ? " · accent darkened for contrast" : ""}
            </p>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-2">
        <Button onClick={read} disabled={pending || !appUrl}>
          {pending ? <Spinner /> : null}
          {match ? "Read it again" : "Read my site"}
        </Button>
        {match && (
          <Button variant="primary" onClick={() => apply(match.accent)}>
            {applied === match.accent ? "Applied" : "Use these"}
          </Button>
        )}
      </div>

      {applied && (
        <p className="text-[12.5px] text-ink-2">
          Applied to the preview. Publish when it looks right.
        </p>
      )}
    </AiCard>
  );
}

function Swatch({ label, hex }: { label: string; hex: string }) {
  return (
    <span className="flex items-center gap-2 rounded-chip border border-line bg-canvas px-[7px] py-[3px] text-[12px]">
      <span className="h-[14px] w-[14px] rounded-[4px] border border-line" style={{ background: hex }} />
      <span className="text-ink-2">{label}</span>
      <code className="font-mono text-ink">{hex}</code>
    </span>
  );
}

function hostOf(url: string): string {
  try {
    return new URL(/^[a-z]+:\/\//i.test(url) ? url : `https://${url}`).hostname;
  } catch {
    return url;
  }
}
