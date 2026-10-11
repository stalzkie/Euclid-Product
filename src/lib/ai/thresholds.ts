/**
 * Similarity thresholds for duplicate detection and clustering.
 *
 * These are not guesses. They were measured against the configured embeddings
 * model with `scripts/calibrate.mjs`, over pairs a founder would call
 * duplicates and pairs they would not:
 *
 *   duplicates      0.40 – 0.68   ("Export to CSV" / "Download as Markdown")
 *   not duplicates  0.10 – 0.25   ("Export to CSV" / "Dark mode")
 *
 * Cosine similarity is model-specific, so these numbers only hold for
 * text-embedding-3-small at 1536 dimensions. Re-run the calibration script
 * after changing EMBEDDINGS_MODEL and move these to match — thresholds set too
 * high do not fail loudly, they just silently stop finding anything.
 */

/**
 * Submit-time nudge, shown to the person typing a new post. Tuned to catch
 * most repeats: a false positive costs the submitter a glance, while a miss
 * costs the founder a duplicate to merge later.
 */
export const SIMILAR_NUDGE = 0.32;

/**
 * The founder's merge queue. Higher, because every suggestion here asks for a
 * decision, and a queue full of weak matches is a queue nobody reads.
 */
export const DUPLICATE_SUGGESTION = 0.42;

/**
 * Theme membership: a post's mean similarity to a cluster's existing members.
 *
 * Measured on a real board with scripts/tune-clustering.mjs. At 0.38 "Offline
 * mode on iOS" joined data export because both talk about syncing; at 0.46 the
 * themes fragment into pairs. 0.42 separates Mobile from Export while keeping
 * backups, Notion sync and Markdown download together.
 */
export const CLUSTER_MEMBER = 0.42;

/** Above this, the UI calls a pair "almost certainly the same request". */
export const NEAR_CERTAIN = 0.6;
