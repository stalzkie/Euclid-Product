import { z } from "zod";

/**
 * A UUID as Postgres defines it, not as RFC 4122 defines it.
 *
 * Zod's built-in `.uuid()` enforces the RFC's version and variant nibbles.
 * Postgres accepts any 8-4-4-4-12 hex string, so a perfectly valid row id —
 * a readable fixture id, or an id minted by another system — would be
 * rejected by the API while the database is happy to store it. Validation
 * that is stricter than the storage layer rejects real data.
 */
export const uuid = () =>
  z
    .string()
    .regex(
      /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/,
      "Expected a UUID",
    );
