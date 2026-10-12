# Motion audit

Phase 6 of `design/MOTION.md`. What landed, what deviates, and what I could not
verify.

Verified on the current `main` working tree: `npm run verify` passes (412 unit
tests, 19 files), `npm run build` succeeds, and every reduced-motion rule
compiles into the production stylesheet.

## Where the motion lives

| Concern | File |
| --- | --- |
| Tokens, loops, reduced motion, control transitions | `src/app/globals.css` |
| JS mirror of the tokens | `src/lib/motion/tokens.ts` |
| Digit-roll arithmetic (tested) | `src/lib/motion/digits.ts` |
| Changed-line detection for diffs (tested) | `src/lib/motion/lines.ts` |
| The eight primitives, provider, toast stack | `src/components/motion/` |
| Widget motion — CSS and WAAPI, no Motion import | `src/components/widget-motion.tsx` |
| Widget launcher and panel | `public/widget.js` |
| Workbench for every primitive | `/dev/motion` (development only) |

The reduced-motion switch is in Settings › Project profile and writes the
`eu-reduce-motion` cookie, read by `src/app/(dashboard)/layout.tsx` and
`src/app/onboarding/layout.tsx`.

## Acceptance checklist

- [x] **Every duration and easing comes from the tokens.** Audited by grep: no
      literal `ms` values or cubic-beziers outside `globals.css`,
      `tokens.ts` and `widget-motion.tsx`, which are the definitions.
      Values the spec gave as literals — the 50ms content lag, the 20ms bar
      stagger, the 220ms vote hop, the 900ms highlight — became tokens
      (`dur.contentLag`, `barStagger`, `dur.hop`, `--eu-dur-highlight`).
- [x] **Only `transform`, `opacity`, `clip-path` and `stroke-dashoffset`
      animate, plus heights through `Collapse`.** Every `@keyframes` in the
      codebase animates transform or opacity and nothing else. The only CSS
      `transition-property` lists are colour, opacity and transform. The old
      `transition-[width]` on `Meter` and `transition-[left]` on the switch
      knob — both of which the spec rules out — are gone; the meter scales from
      its left edge and the knob translates.
- [x] **Nothing bounces, overshoots or moves more than 16px.** Both springs are
      critically damped (`damping` 40 and 34). The largest distance token is
      `--eu-slide-step: 16px`.
- [x] **No content the user is waiting for is delayed.** Streaming-answer
      chunks start at 0.35 opacity rather than 0, so text is readable before
      its fade finishes; the longest cascade is 8 × 30ms = 240ms.
- [x] **Every animation can be interrupted.** Motion retargets from the current
      position by design. The vote hop and the widget's are keyed on a counter,
      so a second click restarts the keyframes from wherever they are instead
      of being ignored as already-finished.
- [x] **Only the section 6 loops repeat** — shimmer, the install waiting pulse,
      the aurora drift and the sign-up cards' float, plus spinners and skeleton
      pulses. `Shimmer` pauses itself offscreen and on `visibilitychange`.
      Nothing else in the codebase has `infinite`.
- [x] **Reduced motion removes all movement, from either trigger.** The
      distance and scale tokens go to zero, durations cap at 120ms, loops stop,
      smooth scrolling becomes instant, and count-ups, chart draw-ins and diff
      tints do not run. Both blocks are in the compiled stylesheet.
- [x] **The vote button and the widget match sections 5.4 and 5.14.** All three
      vote surfaces (dashboard, public board, widget) run press → hop →
      crossfade → digit roll, un-vote rolls down without a hop, and a failed
      write rolls back and raises an error toast.
- [x] **The widget is well under 40 KB.** `public/widget.js` is 3.2 KB gzipped,
      and the embed route references no Motion chunk at all.
- [ ] **Build Prompt does not match section 5.7 in full** — see below.
- [ ] **The 25 KB bundle budget is met for the shared bundle but not per-route**
      — see below.
- [ ] **Playwright screenshot tests are not included** — see below.

## Deviations

### Build Prompt does not stream its sections (5.7)

`generateBuildPrompt` is a server action that returns the finished document in
one piece, so there is nothing to reveal progressively. The file header shows
the shimmer and a "Generating…" label while the request is in flight, the body
dims to 60%, and the new version crossfades in whole with genuinely new lines
tinted. Everything else in 5.7 is implemented as specified.

Making this faithful means converting the action to a streaming route and
rendering sections as they arrive. That is backend work, not motion work.

Two smaller knock-ons: toggling an include switch or the target tool does not
change the document until you regenerate, which is how the screen already
worked, so there is no section to expand or intro line to re-tint at the moment
of the toggle. The file name does crossfade when the target changes.

### The insights chart crossfades on a range change instead of morphing (5.10)

The range buttons navigate (`router.push`), which remounts the chart with new
server data — there are no old values in the client to interpolate from. The
line and bars draw in on first view as specified, the KPIs count up and then
roll, and a range change crossfades the axis labels and the chart.

Making this faithful means holding the range in client state and fetching
series data without a navigation.

### Playwright tests are not included

The repo has no Playwright and no jsdom or testing-library; vitest runs
`environment: "node"` over `tests/unit/**/*.test.ts`. Rather than add browser
test infrastructure as a side effect of a motion pass, the logic that actually
needed testing was extracted and tested directly:

- `tests/unit/motion-digits.test.ts` — 10 tests covering up, down, unchanged
  digits, 99 → 100 and 100 → 99, `minWidth` padding, grouping separators and
  negatives.
- `tests/unit/motion-lines.test.ts` — 7 tests covering the changed-line
  detection behind `DiffHighlight`.

A `reducedMotion: "reduce"` screenshot run still wants Playwright.

### Bundle cost

| Measurement | Gzipped |
| --- | --- |
| Shared initial bundle (`rootMainFiles`) | 128.4 KB — Motion is **not** in it |
| Motion's feature chunk (`domMax`) | 40.7 KB |
| The same with `domAnimation` instead | 26.4 KB |
| Widget loader | 3.2 KB |
| Embed route | 10.9 KB, no Motion |

Motion adds **nothing** to the shared bundle, which is how the spec words the
25 KB limit. But the feature chunk is preloaded alongside the routes that use
it rather than fetched lazily, so in practice an animated route carries 40.7 KB
that it did not before — above the figure the spec had in mind.

`domAnimation` would cut that to 26.4 KB. It drops layout animations, and with
them every shared-layout indicator the spec asks for: the segmented thumb
(5.1), the tab underline (5.1), the sidebar's sliding active row (5.3), the
command-palette-style highlight, the toast stack's reflow (5.2), the themes
grid's moving cards (5.9), the onboarding progress pill (5.13) and the roadmap
cards changing column (5.15). I kept the features and the cost; swapping
`src/components/motion/features.ts` to `domAnimation` reverses that decision in
one line.

## Not applicable on the current product

These are specified but have nothing to attach to yet. No code was invented for
them.

- **Dialog, drawer, command palette, tooltip (5.1, 5.2).** No such components
  exist. The one real overlay surface, the merge queue, got the drawer
  treatment, and the dropdowns on the inbox and post detail got the specced
  popover motion. The rest are demonstrated on `/dev/motion`.
- **A new activity item arriving on Home (5.5).** Home is server-rendered with
  no live updates, so nothing arrives while the page is open.
- **Shimmer on the "Euclid recommends" card (5.5).** The digest is generated by
  a background job, not by anything the founder does on Home, so there is no
  pending state to show.
- **Skeletons (5.16).** Every screen is server-rendered and has no loading
  state. `.eu-skeleton` is defined, demoed and ready for the first one.
- **The new idea appearing in the widget list (5.14).** This one was made to
  apply: the widget now holds locally posted ideas and shows them at the top of
  its list with a fade and a 4px rise, rather than waiting for the parent to
  refetch.

## Small features added, because the specced motion needed something to move

- **Sidebar collapse.** The collapse button existed and did nothing. It now
  collapses to the 56px rail, labels fading before the width goes and after it
  returns, persisted in `localStorage`.
- **Optimistic comments on post detail.** A reply now appears immediately at
  60% opacity and firms up when the server confirms, which is what 5.6
  describes; before, the page simply refreshed.

## Not verified

**The 60fps-at-4×-CPU-throttle target in section 8.** I verified the structural
properties that target depends on — only compositable properties animate, no
per-frame layout, `will-change` appears nowhere so Motion manages it per
animation, loops pause offscreen and in background tabs — but I did not run a
throttled profile. The four surfaces the spec names (the vote button, Build
Prompt toggles, the sidebar collapse, the chart draw) are all behind
authentication, so profiling them needs a signed-in session in a real browser.
`/dev/motion` can be profiled without one.

**Layout shift from the collapse animation.** Motion's layout projection drives
the sidebar width with transforms, which can distort children mid-flight. The
labels have already faded by then and only centred icons remain, so it should
not be visible — but that is reasoning, not a measurement.
