/**
 * The motion primitives. Every animation in the app is one of these, a CSS
 * transition driven by the tokens in `globals.css`, or — in the widget, which
 * must not ship Motion — hand-written CSS and WAAPI.
 */
export { FadeRise, type FadeRiseTag } from "./fade-rise";
export { Collapse, CollapseOut } from "./collapse";
export { Stagger } from "./stagger";
export { AnimatedNumber } from "./animated-number";
export { CountUp } from "./count-up";
export { DiffHighlight } from "./diff-highlight";
export { IconSwap } from "./icon-swap";
export { Shimmer } from "./shimmer";
export { MotionProvider } from "./motion-provider";
export { useReduceMotion } from "./reduce-motion";
export { Toaster, useToast } from "./toaster";
