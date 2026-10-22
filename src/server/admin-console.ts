import { cache } from "react";
import { authUsers, estate, type AdminUser, type Estate, type Slice } from "@/server/admin-data";
import { buildIndex, deriveEvents, type AdminEvent, type Index } from "@/server/admin-model";

/**
 * What every page of the console starts with: the tables, the logins, the
 * look-ups, and the timeline derived from all three.
 *
 * Memoised per request, so a page that renders the funnel, the trends and the
 * feed derives the event stream once rather than three times — and the layout
 * asking for the health banner does not pay for it again either.
 */
export interface ConsoleData {
  data: Estate;
  users: Slice<AdminUser>;
  index: Index;
  events: AdminEvent[];
}

export const consoleData = cache(async function consoleData(): Promise<ConsoleData> {
  const [data, users] = await Promise.all([estate(), authUsers()]);
  const index = buildIndex(data, users.rows);
  return { data, users, index, events: deriveEvents(data, index) };
});
