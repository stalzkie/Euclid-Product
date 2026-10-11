import { loadEnv } from "./env.mjs";
loadEnv();

/**
 * Repairs mis-decoded text already sitting in the database.
 *
 * Anything that reached Postgres through a Windows console or clipboard on an
 * OEM codepage carries mojibake: the UTF-8 bytes of "·" arrive as "┬╖". New
 * writes go through repairText(), but rows written before that are still
 * broken, so this walks the text columns and fixes them in place.
 *
 *   node scripts/repair-text.mjs          # report only
 *   node scripts/repair-text.mjs --write  # apply
 */

// Kept in step with src/lib/ai/text.ts. Escapes, not literals, so this file
// cannot itself be corrupted into uselessness.
const MOJIBAKE = [
  ["┬╖", "·"],
  ["ÔÇô", "–"],
  ["ÔÇö", "—"],
  ["ÔÇ¿", "’"],
  ["ÔÇ£", "“"],
  ["ÔÇ¥", "”"],
  ["â€“", "–"],
  ["â€”", "—"],
  ["â€™", "’"],
  ["Ã©", "é"],
  ["Â·", "·"],
  ["Â ", " "],
];

const repair = (s) => {
  let out = s;
  for (const [broken, fixed] of MOJIBAKE) {
    if (out.includes(broken)) out = out.split(broken).join(fixed);
  }
  return out;
};

const stillBroken = (s) => /[À-ÿ─-▟]{2,3}/.test(s);

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}`, "content-type": "application/json" };
const write = process.argv.includes("--write");

// Table → text columns worth checking, keyed by id.
const TABLES = [
  ["posts", ["title", "body", "founder_notes"]],
  ["comments", ["body", "author_name"]],
  ["themes", ["name", "summary"]],
  ["changelog_entries", ["title", "body"]],
  ["recommendations", ["headline"]],
  ["activity", ["text", "meta"]],
  ["build_prompts", ["title", "body", "context_block", "founder_notes"]],
  ["chat_messages", ["content"]],
  ["boards", ["name", "description"]],
];

let scanned = 0;
let fixed = 0;
let unfixable = 0;

for (const [table, cols] of TABLES) {
  const rows = await fetch(`${url}/rest/v1/${table}?select=id,${cols.join(",")}`, {
    headers: h,
  }).then((r) => r.json());
  if (!Array.isArray(rows)) continue;

  for (const row of rows) {
    scanned += 1;
    const patch = {};
    for (const col of cols) {
      const value = row[col];
      if (typeof value !== "string" || !value) continue;
      const repaired = repair(value);
      if (repaired !== value) {
        patch[col] = repaired;
        if (stillBroken(repaired)) {
          unfixable += 1;
          console.log(`  ? ${table}.${col} still looks broken after repair`);
        }
      } else if (stillBroken(value)) {
        unfixable += 1;
        console.log(
          `  ? ${table}.${col} unknown sequence: ${JSON.stringify(
            value.match(/.{0,20}[À-ÿ─-▟]{2,3}.{0,20}/)?.[0] ?? "",
          )}`,
        );
      }
    }

    if (Object.keys(patch).length) {
      fixed += 1;
      console.log(
        `  ${write ? "fixed" : "would fix"} ${table} ${row.id} (${Object.keys(patch).join(", ")})`,
      );
      if (write) {
        const res = await fetch(`${url}/rest/v1/${table}?id=eq.${row.id}`, {
          method: "PATCH",
          headers: h,
          body: JSON.stringify(patch),
        });
        if (!res.ok) console.log(`    FAILED ${res.status} ${(await res.text()).slice(0, 120)}`);
      }
    }
  }
}

// The project profile is keyed by workspace, not id.
const profiles = await fetch(
  `${url}/rest/v1/project_profiles?select=workspace_id,conventions,rules_file`,
  { headers: h },
).then((r) => r.json());

for (const p of profiles ?? []) {
  scanned += 1;
  const patch = {};
  for (const col of ["conventions", "rules_file"]) {
    if (typeof p[col] !== "string" || !p[col]) continue;
    const repaired = repair(p[col]);
    if (repaired !== p[col]) patch[col] = repaired;
  }
  if (Object.keys(patch).length) {
    fixed += 1;
    console.log(
      `  ${write ? "fixed" : "would fix"} project_profiles ${p.workspace_id} (${Object.keys(patch).join(", ")})`,
    );
    if (write) {
      await fetch(`${url}/rest/v1/project_profiles?workspace_id=eq.${p.workspace_id}`, {
        method: "PATCH",
        headers: h,
        body: JSON.stringify(patch),
      });
    }
  }
}

console.log(
  `\nscanned ${scanned} rows · ${fixed} ${write ? "repaired" : "need repair"}` +
    (unfixable ? ` · ${unfixable} unrecognised` : ""),
);
if (!write && fixed) console.log("re-run with --write to apply.");
