# Euclid — motion design prompt for Claude Code

Paste everything below the line into Claude Code, or save this file as `design/MOTION.md` in the repo and tell Claude Code: "Implement design/MOTION.md." It assumes the Euclid handoff (CLAUDE.md, design/tokens.css, design/SCREENS.md) is already in the repo. This spec replaces section 6 ("Motion") of design/DESIGN_SYSTEM.md.

---

You are adding motion design to Euclid, the feedback board SaaS in this repo. The goal is motion that feels calm, precise and expensive, like Linear, Vercel or Stripe. It is not playful. Every animation must explain a change the user caused or a change in the data. If an animation doesn't do one of those, leave it out.

Start in plan mode. Read CLAUDE.md, design/DESIGN_SYSTEM.md, design/tokens.css and design/SCREENS.md, then this whole spec. Propose a plan for Phase 1 below and wait for my approval before writing code.

## 1. Principles

1. **Motion has a cause.** Things move because the user acted (clicked, voted, toggled) or because data changed (a stream arrived, a count went up). Nothing animates just for decoration, and nothing loops forever, except the three cases listed in section 6.
2. **Quick and quiet.** Most transitions finish in 150 to 250ms. Movement distances are small (4 to 8px, never more than 16px). Scale changes stay between 0.96 and 1. Nothing bounces or overshoots.
3. **Content is never held back.** Data the user is waiting for appears immediately. No entrance delays on loaded content, no staggered reveal longer than 240ms in total, no animation the user has to wait for before they can click.
4. **Exits are faster than entrances.** An exit takes about 70% of its entrance duration and uses an accelerating ease.
5. **Every animation can be interrupted.** A new action cancels or retargets the running animation from its current position. Nothing queues.
6. **Only `transform` and `opacity` move**, plus `clip-path` and `stroke-dashoffset` where this spec names them. Height changes go through the `Collapse` primitive (section 4). Never animate `top`, `left`, `width`, `margin` or `box-shadow` per frame.
7. **Reduced motion is a first-class mode**, not an afterthought (section 7).

## 2. Motion tokens

Add these to `design/tokens.css` under `:root`, and add the matching keys to the `@theme inline` block so Tailwind can use them (`duration-[var(--eu-dur-fast)]`, `ease-eu-out`, and so on).

```css
:root {
  /* Durations */
  --eu-dur-press: 100ms;     /* press feedback, instant color flips */
  --eu-dur-fast: 150ms;      /* hover, switch, segmented thumb, tooltip */
  --eu-dur-base: 200ms;      /* popover, dropdown, toast, tab indicator */
  --eu-dur-moderate: 250ms;  /* dialog, collapse, widget open, step change */
  --eu-dur-slow: 320ms;      /* drawer, sidebar collapse, device-width change */
  --eu-dur-data: 600ms;      /* chart draw, count-up (first view only) */

  /* Easings */
  --eu-ease-standard: cubic-bezier(0.2, 0, 0, 1);    /* things that move on screen */
  --eu-ease-out: cubic-bezier(0.16, 1, 0.3, 1);      /* entrances: fast start, long settle */
  --eu-ease-in: cubic-bezier(0.4, 0, 1, 1);          /* exits */
  --eu-ease-linear: linear;                          /* progress, shimmer */

  /* Distances */
  --eu-rise-sm: 4px;
  --eu-rise-md: 8px;
  --eu-slide-step: 16px;
}

@theme inline {
  --ease-eu-standard: var(--eu-ease-standard);
  --ease-eu-out: var(--eu-ease-out);
  --ease-eu-in: var(--eu-ease-in);
}
```

Mirror the same values in `lib/motion/tokens.ts` for JavaScript:

```ts
export const dur = { press: 0.1, fast: 0.15, base: 0.2, moderate: 0.25, slow: 0.32, data: 0.6 } as const;
export const ease = {
  standard: [0.2, 0, 0, 1],
  out: [0.16, 1, 0.3, 1],
  in: [0.4, 0, 1, 1],
} as const;
// Springs: critically damped, no bounce. Use for layout moves and number rolls.
export const spring = {
  snappy: { type: "spring", stiffness: 520, damping: 40, mass: 1 },   // indicators, thumbs
  smooth: { type: "spring", stiffness: 300, damping: 34, mass: 1 },   // cards moving between columns
} as const;
export const stagger = { step: 0.03, max: 8 } as const; // 30ms per item, only the first 8 items stagger
```

## 3. Library and setup

- Use **Motion for React** (the `motion` package, imported from `motion/react`). Use `LazyMotion` with `domAnimation` and the `m` component, so only the features we use ship. Add `domMax` only on the pages that need layout animations (sidebar, roadmap, segmented controls), loaded through `LazyMotion`'s async `features`.
- Add `components/motion/motion-provider.tsx`: `LazyMotion` plus `MotionConfig reducedMotion="user"` plus default `transition={{ duration: dur.base, ease: ease.standard }}`. Wrap the app layout and the onboarding layout with it.
- Plain CSS transitions (with the token variables) are preferred for hover, focus, color and switch changes. Use Motion only for presence (mount and unmount), layout moves, springs, sequences and number animations.
- **The widget (`widget/`, Preact) must not import Motion.** Use CSS transitions and the Web Animations API only, so the bundle stays under 40 KB gzipped. Its keyframes live inside the Shadow DOM and must never leak into the host page.
- Charts: Recharts' built-in animation is off (`isAnimationActive={false}`). Use the custom draw-in described in section 5.10.

## 4. Primitives to build (`components/motion/`)

Each primitive is typed, respects reduced motion, and appears on the `/dev/motion` page (Phase 1).

| Primitive | What it does | Spec |
| --- | --- | --- |
| `FadeRise` | Presence wrapper: opacity 0 → 1 and y 4px → 0 | enter `dur.base` `ease.out`; exit opacity only, `dur.fast` `ease.in` |
| `Collapse` | Animates height `0 ↔ auto` plus opacity for content that appears or disappears in the flow | `dur.moderate` `ease.standard`; content fades 50ms after height starts; `overflow: hidden` only while animating |
| `Stagger` | Staggers the children of a list on first mount only | 30ms per item, the first 8 items only, the rest appear with item 8; never re-staggers on re-render or filtering |
| `AnimatedNumber` | Rolling digits: changed digits slide out up and in from below (down when the value decreases) | `spring.snappy`; tabular-nums; width stays fixed so neighbours never shift; reads the final value to screen readers right away (`aria-live="polite"` on the parent where it matters) |
| `CountUp` | Counts from 0 to the value on first view only | `dur.data` `ease.out`; only when the element first enters the viewport, once per session per metric (sessionStorage, wrapped in try/catch) |
| `DiffHighlight` | Gives changed lines a brief tint that fades out | background `--eu-pink-50` → transparent over 900ms `ease.out`; used in Build Prompt only |
| `IconSwap` | Crossfades two icons in the same slot | outgoing scale 1 → 0.8 plus fade, incoming 0.8 → 1, `dur.fast` |
| `Shimmer` | A thin moving highlight for "AI is working" | a 1px pink-200 → pink-500 → pink-200 gradient line sweeping left to right, 1.4s linear loop, only while a request is pending |

## 5. Motion by component and screen

### 5.1 Base controls (CSS transitions)

- **Buttons:** background and border color `--eu-dur-fast`. Press: `scale(0.98)` for `--eu-dur-press`. No hover lift, no hover shadow on buttons. Disabled buttons have no transitions.
- **Inputs:** border color and focus ring fade in `--eu-dur-fast`. The focus ring appears instantly for keyboard focus (`:focus-visible`), because users must see it right away.
- **Switch:** the knob moves with `transform: translateX(16px)` and the track color changes, both `--eu-dur-fast` `--eu-ease-standard`.
- **Segmented control and underline tabs:** the selected thumb or indicator is a single element that slides to the new item with a shared `layoutId` and `spring.snappy`. The labels' color crossfades `--eu-dur-fast`.
- **Chips and status pills:** background and text color crossfade `--eu-dur-base`. A status change never moves the layout.
- **List rows and cards on hover:** the border goes to `--eu-border-strong` and the row background to `--eu-subtle`, `--eu-dur-fast`. No translate, no scale. Theme cards (screen 08) also get a `--eu-shadow-raised` that fades in through an opacity-animated pseudo-element, never a transitioned `box-shadow`.
- **Tooltip:** fade plus 4px rise, 150ms, after a 400ms hover delay. When moving between adjacent tooltips there is no delay (skip-delay window 300ms).

### 5.2 Overlays

- **Popover and dropdown:** opacity 0 → 1, scale 0.98 → 1, y −4px → 0, `dur.base` `ease.out`, with `transform-origin` set to the trigger side (Radix provides `--radix-popover-content-transform-origin`). Exit is opacity only, `dur.fast`.
- **Dialog:** the overlay fades to 40% ink over `dur.base`. The panel fades in and scales 0.98 → 1, `dur.moderate` `ease.out`. Exit takes 160ms. Focus moves to the dialog on the first frame, not after the animation ends.
- **Drawer** (merge queue, mobile sidebar): slides in from the right over its full width, `dur.slow` `ease.out`, and exits in `dur.moderate` `ease.in`. The overlay fades to 40% ink.
- **Command palette (⌘K):** the overlay fades `dur.fast`, the panel fades and scales 0.98 → 1 over `dur.base`. Results update instantly. Only the highlighted-row background moves between rows (`layoutId`, `spring.snappy`).
- **Toasts:** enter from the bottom right with y 8px → 0 plus fade, `dur.base` `ease.out`. Exit: fade plus x 0 → 8px, `dur.fast`. When one toast leaves, the stack reflows with a layout animation. Hovering pauses the auto-dismiss timer.

### 5.3 App shell and navigation

- **Route changes:** the main content area fades in with a 4px rise (`FadeRise`, `dur.base`) using a `template.tsx` in `app/(app)/`. The sidebar never animates on route change. There is no exit animation for the old page, because it must not slow navigation down.
- **Sidebar active item:** the `--eu-active` background is one element that slides to the new item with a shared `layoutId` and `spring.snappy`.
- **Sidebar collapse to the 56px rail:** labels fade out over 100ms first, then the width animates over `dur.slow` `ease.standard`. Expanding reverses this: width first, then labels fade in. Animate the width with a transform-based layout animation on the sidebar container, not a CSS `width` transition.
- **Credits meter:** when usage changes, the fill animates with `transform: scaleX()` (origin left) over `dur.moderate`. When it reaches 100%, its color crossfades from blue to amber.
- **Notification dot:** scales from 0 to 1 with `spring.snappy` when a new notification arrives. It does not pulse.

### 5.4 Vote button (signature, used everywhere)

The vote must feel instant and satisfying, with a tiny bit of craft.

1. On pointer down: `scale(0.96)` over `dur.press`.
2. On click (optimistic, before the request returns): the chevron icon moves y 0 → −3px → 0 over 220ms `ease.out`; the border, fill and text crossfade to the voted blue over `dur.fast`; the count goes up with `AnimatedNumber` (digits roll up).
3. Un-vote reverses it: digits roll down, the colors fade back, and the chevron does not move.
4. If the request fails, the button rolls back to its previous state with the same animation, and an error toast appears.
5. In the widget, the same sequence runs with CSS and WAAPI, using the board's accent color.

### 5.5 Home (screen 05)

- KPI numbers use `CountUp` on the first view per session; afterwards they appear instantly.
- "Top requests" and "Recent activity" use `Stagger` on first mount only.
- A new activity item arriving while the page is open slides in at the top (`Collapse` plus `FadeRise`). The "Euclid recommends" card does not animate when it loads.
- The "Euclid recommends" card shows `Shimmer` along its top edge while the digest is being generated.

### 5.6 Feedback inbox and post detail (screens 06, 07)

- **Filtering, sorting or changing pages:** the table body crossfades `dur.fast` (opacity 0.4 → 1). Rows do not stagger and do not re-order with animation, because large lists must feel instant.
- **Bulk actions:** when the first row is selected, the bulk-action bar replaces the toolbar with a crossfade plus a 4px rise, `dur.base`.
- **Merging duplicates:** the merged row collapses (`Collapse`, `dur.moderate`) while the target post's count rolls up by the merged votes (`AnimatedNumber`). A success toast follows. In post detail, the "Merge" button changes to "Merged" with `IconSwap` and a color crossfade.
- **Status change:** the pill crossfades color and text. If the change hides the row from the current filter, wait 600ms, then collapse the row.
- **Reply tabs:** switching to "Internal note" crossfades the composer background to amber `dur.base`.
- **Optimistic comment:** a posted comment appears with `FadeRise` at 60% opacity, and goes to full opacity once the server confirms.

### 5.7 Build Prompt (screen 09, the signature screen)

This screen should feel like the product's engine. Animate the prompt so the founder can see it being assembled.

- **Generating** (first open, or after Refine): the file header shows `Shimmer` and the label "Generating…". Sections stream in one at a time in the fixed order, each with `FadeRise` (4px). Do not type text out character by character; reveal whole lines as they arrive.
- **Toggling an include switch:** the section it controls expands or collapses with `Collapse` (`dur.moderate`), and lines that appear get `DiffHighlight`. The "N lines · about N tokens" counter uses `AnimatedNumber`.
- **Switching the target tool:** only the intro line and the file name change. They crossfade over `dur.base` and the intro line gets `DiffHighlight`. The rest of the document stays still.
- **Confirming an assumption:** the amber row's "Confirm" link changes to green "Confirmed" (`IconSwap` plus a color crossfade). After 400ms the matching line in the prompt's "Assumptions to verify" section collapses. When the last one is confirmed, the whole section collapses.
- **Copy prompt:** `IconSwap` from copy to check, and the label crossfades to "Copied". After 2 seconds it reverts.
- **Refine:** while the request runs, the send button shows a 14px spinner and the prompt body dims to 60% opacity. When the response arrives, the body returns to full opacity and changed lines get `DiffHighlight`.
- **Version change** (History): the body crossfades over `dur.base`. Nothing slides.

### 5.8 Ask Euclid (screen 10)

- **User message:** appears instantly at the bottom with `FadeRise`. The thread scrolls smoothly to it (`scroll-behavior: smooth`, or instant under reduced motion).
- **Assistant steps:** the "Read N sources in N steps" pill shows a spinner while tools run, then the spinner changes to a check with `IconSwap`. When the pill is expanded, each tool step appears with `FadeRise` as it runs.
- **Streaming answer:** append text chunks as they arrive, each chunk fading from opacity 0.35 to 1 over 150ms. No typewriter effect and no blinking cursor. Keep the scroll pinned to the bottom unless the user has scrolled up.
- **Citation chips and tables:** fade in only after their paragraph has finished streaming, so the layout doesn't jump while the user reads.
- **"Asking for your input" card:** enters with `FadeRise` (8px) after the answer finishes. Its radio selection moves with a shared-layout highlight.

### 5.9 Themes (screen 08)

- Cards use `Stagger` on first mount only.
- When the sort changes, the cards move to their new positions with a layout animation (`spring.smooth`). The sort chips' selected fill crossfades `dur.fast`.
- "Re-cluster" shows `Shimmer` across the header while running. When it finishes, cards whose theme changed get a one-time 900ms pink-50 border flash; the rest stay still.

### 5.10 Insights and charts (screen 11)

- **First view of the chart:** the votes line draws from left to right using `stroke-dashoffset` over `dur.data` `ease.out`. The area fades in over the same time. Post bars grow up from the baseline (`scaleY` with origin bottom) with a 20ms stagger. This only happens the first time the chart enters the viewport.
- **Changing the date range:** no redraw. The line and bars morph to the new values over `dur.moderate` `ease.standard` (interpolate path points and bar heights). Axis labels crossfade.
- **Tooltip:** follows the pointer with no transition on its position. It fades in over 100ms on first hover and stays open while moving between points.
- **KPIs:** `CountUp` on first view, `AnimatedNumber` on range change.
- **Meters and the stacked status bar:** segments grow with `scaleX` over `dur.moderate` on first view, and morph on range change.
- **Sparklines** (inbox, home, themes): never animate. There are too many of them.

### 5.11 Board designer (screen 12)

- The preview widget responds to every control with CSS transitions on its custom properties: accent color, background and border colors `dur.base`; corner radius `dur.base`; theme (light and dark) crossfade `dur.moderate`.
- **Desktop and Mobile toggle:** the preview frame's width animates over `dur.slow` `ease.standard` (a layout animation on the frame), and the content reflows inside it.
- **Inline and Floating toggle:** crossfade between the two preview layouts over `dur.moderate`.
- **"Unsaved changes" indicator:** fades in. After publishing, the "Publish changes" label changes to "Published" with `IconSwap`, and the indicator fades out.

### 5.12 Changelog (screen 13)

- **Edit and Email preview:** crossfade `dur.base`. No sliding.
- **"Draft from linked posts":** the editor shows `Shimmer` on its toolbar edge. The drafted text streams in by paragraph with `FadeRise`.
- **Publish:** the button shows a spinner, then a check (`IconSwap`). The green success banner enters with `Collapse`. The linked post chip's status changes to Shipped with a color crossfade.

### 5.13 Onboarding (screens 01 to 04)

Onboarding is the only place with a little extra atmosphere, and it stays subtle.

- **Aurora background:** the three radial gradients drift very slowly (each translates up to 3% over 40 to 60 seconds, alternating, `ease-in-out`). Animate a pseudo-element's `transform`, never `background-position`. This loop stops under reduced motion and when the tab is hidden.
- **Sign-up floating cards:** they enter once with a 60ms stagger (fade plus 8px rise), then float ±3px on y over 6 seconds, each with a different phase. They are hidden below 900px wide.
- **Step changes:** the form pane's content slides horizontally (`--eu-slide-step`, 16px) and crossfades over `dur.moderate`. Going forward, it enters from the right; going back, from the left. The card itself never moves or resizes abruptly (animate the height with `Collapse` if it changes).
- **Progress dots:** the active dot grows from 5px to 20px wide with a shared layout animation (`spring.snappy`).
- **Step 02 illustration:** when a tool chip is toggled, the floating chip labels crossfade and the "Prompts ready for N tools" count uses `AnimatedNumber`.
- **Step 03 stack tokens:** removing a token collapses it horizontally (opacity plus scale 0.9, then the remaining tokens reflow with a layout animation). Its line in the dark preview collapses with `Collapse`.
- **Step 04 waiting state:** the blue dot pulses (a ring scales 1 → 2.2 and fades out, 1.6s loop). On the first ping, the ring stops, the dot turns green, a check draws in (`stroke-dashoffset`, 300ms), and the status text crossfades to "Connected".

### 5.14 Embedded widget (screen 15, CSS and WAAPI only)

- **Launcher:** on hover, background darkens over `--eu-dur-fast`. Press is `scale(0.97)`.
- **Opening:** the panel appears from the launcher's corner (`transform-origin: bottom right`): opacity 0 → 1, y 8px → 0, scale 0.98 → 1, 250ms `ease-out`. Closing takes 160ms `ease-in`. While animating, the panel has `pointer-events: none` for the first 100ms only.
- **"Already suggested?" box:** when it appears (after the 300ms search debounce), its height animates with WAAPI over 200ms, then results fade in. When the results change, they crossfade. They never jump.
- **Posting an idea:** the button shows a spinner, then "Posted" with a check. The new idea appears at the top of the list with a fade plus 4px rise.
- **Changelog dot:** a static pink dot. It does not pulse.
- **Reduced motion:** the panel opens and closes with a 120ms fade only.
- **The host page is untouchable:** no animation may run outside the Shadow DOM, no `scroll-behavior` on the host, and no `will-change` left on idle elements.

### 5.15 Public board (screen 16)

- Tabs: the underline indicator slides (CSS transition on `transform`).
- Roadmap columns stagger their cards on first view only.
- When a post's status changes (live update or after a refresh), its card moves to the new column with a shared layout animation (`spring.smooth`).

### 5.16 Loading and empty states

- **Skeletons:** blocks in `--eu-muted` pulse their opacity between 1 and 0.6 over 1.2s `ease-in-out`. No moving gradient. Skeletons only appear if loading takes longer than 300ms, to avoid a flash on fast loads. Content replaces them with a 150ms crossfade.
- **Spinners:** 14px, 1.5px stroke, 0.8s linear rotation, `currentColor`.
- **Empty states:** a single `FadeRise`. Illustrations don't move.

## 6. Allowed loops (all others are banned)

Only these may repeat: `Shimmer` while an AI request is pending; the install step's waiting pulse; the aurora drift and floating sign-up cards on onboarding. Spinners and skeleton pulses count as loading indicators and are allowed. Everything else plays once.

## 7. Reduced motion

When `prefers-reduced-motion: reduce` is set (Motion's `reducedMotion="user"` handles most of this; add a global CSS rule for the rest):

- No transforms: no rises, slides, scales, layout moves or springs. Elements appear in their final position.
- Opacity fades stay but are capped at 120ms.
- No count-ups, rolling digits, chart draw-ins, `DiffHighlight` fades, aurora drift, floating cards, shimmer or pulse rings. Show final values and static states (the shimmer becomes a static "Generating…" label with a spinner).
- Smooth scrolling becomes instant.
- Add a "Reduce motion" switch in Settings › Profile that forces this mode regardless of the OS setting (store it in a cookie so server rendering matches).

## 8. Performance and quality

- Holds 60fps on a mid-range laptop with 4× CPU throttling in Chrome DevTools. Check the vote button, the Build Prompt toggles, the sidebar collapse and the chart draw.
- No layout shift (CLS) from animations. Reserve space before content fades in.
- `will-change` only during an animation, removed afterwards.
- Pause offscreen and hidden-tab loops (`IntersectionObserver` and `visibilitychange`).
- Motion adds no more than 25 KB gzipped to the app's shared bundle. The widget adds none.
- Animations never block input, focus or navigation. Focus moves at the start of a transition, not after it.
- Server-rendered content must not flash: elements that animate on mount start in their final state during SSR and only animate on client-side changes, except where this spec asks for a first-view animation.

## 9. Delivery plan

Stop for my review after each phase and show me a screen recording or a running URL.

1. **Foundations:** motion tokens in `tokens.css` and `lib/motion/tokens.ts`, `MotionProvider`, the eight primitives, the global reduced-motion rules, and a `/dev/motion` page that demos each primitive with a "Replay" button and a reduced-motion toggle.
2. **Controls and shell:** section 5.1 to 5.3, plus the vote button (5.4).
3. **Signature screens:** Build Prompt (5.7), Ask Euclid (5.8), then charts (5.10).
4. **Everything else:** sections 5.5, 5.6, 5.9 and 5.11 to 5.16.
5. **Widget:** section 5.14 in Preact with CSS and WAAPI, and confirm the bundle size.
6. **Audit:** go through every screen with reduced motion on and off, run the performance checks in section 8, and give me a short report of anything you couldn't meet.

## 10. Acceptance checklist

- [ ] Every duration and easing comes from the motion tokens. No literal `ms` values or cubic-beziers in components.
- [ ] Only `transform`, `opacity`, `clip-path` and `stroke-dashoffset` animate, plus heights through `Collapse`.
- [ ] Nothing bounces, overshoots, or moves more than 16px.
- [ ] No content the user is waiting for is delayed by an animation.
- [ ] Every animation can be interrupted mid-way without a jump.
- [ ] Only the loops in section 6 repeat.
- [ ] Reduced motion (OS setting and the in-app switch) removes all movement, as listed in section 7.
- [ ] The vote button, Build Prompt and the widget match sections 5.4, 5.7 and 5.14 exactly.
- [ ] The performance targets in section 8 are met, and the widget is still under 40 KB gzipped.
- [ ] Playwright tests: one run with `reducedMotion: "reduce"` for screenshot tests, and unit tests for `AnimatedNumber` (up, down, and digit-count changes such as 99 → 100).
