/**
 * Motion's feature bundle, loaded through `LazyMotion` in `MotionProvider`.
 *
 * `domMax` rather than `domAnimation` because the shared controls animate
 * layout — the segmented thumb, the tab underline, the sidebar's active
 * background, the roadmap's moving cards and the onboarding progress pill all
 * share a `layoutId`, and those controls appear on nearly every screen.
 * Splitting the two feature sets by page would mean a control that animates on
 * one screen and silently does not on another.
 *
 * Measured, so nobody has to guess: domMax is 40.7 KB gzipped and
 * domAnimation 26.4 KB, and dropping to the smaller one costs every
 * shared-layout indicator above. It stays out of the shared initial bundle
 * (`rootMainFiles`), but the bundler does preload it alongside the routes that
 * use it, so the import below defers evaluation rather than download.
 */
export { domMax as default } from "motion/react";
