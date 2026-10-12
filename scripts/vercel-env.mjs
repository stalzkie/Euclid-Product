import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";

/**
 * Pushes the variables in `.env.local` to a linked Vercel project.
 *
 * Doing this by hand is eleven paste operations into a web form, which is
 * eleven chances to paste the wrong key into the wrong field. Values are never
 * printed here — only names, and whether each one landed.
 *
 *   node scripts/vercel-env.mjs                 # production
 *   node scripts/vercel-env.mjs preview         # preview too
 *   node scripts/vercel-env.mjs production --dry
 */

const target = process.argv[2] === "preview" ? "preview" : "production";
const dry = process.argv.includes("--dry");

/**
 * `.env.local` points `NEXT_PUBLIC_APP_URL` at localhost, which is right for
 * this machine and wrong for every deployment: it is baked into the client
 * bundle, and it is what the install snippets tell founders to load the widget
 * from. `--app-url https://app.example.com` overrides it on the way out.
 */
const appUrlFlag = process.argv.indexOf("--app-url");
const appUrl = appUrlFlag > -1 ? process.argv[appUrlFlag + 1] : null;
if (appUrlFlag > -1 && !appUrl?.startsWith("https://")) {
  console.error("--app-url needs an https:// URL.");
  process.exit(1);
}

/**
 * Variables that must never be pushed: they describe this machine.
 * `VERCEL_OIDC_TOKEN` is written into `.env.local` by `vercel link` itself,
 * is short-lived, and is issued per environment — pushing it would pin a dead
 * token into the project.
 */
const SKIP = new Set([
  "TEST_APP_URL",
  "TEST_SUPABASE_URL",
  "TEST_SERVICE_ROLE_KEY",
  "VERCEL_OIDC_TOKEN",
]);

/** Still a placeholder in `.env.example`, so not worth pushing. */
const isPlaceholder = (value) =>
  !value ||
  value.startsWith("your-") ||
  value === "https://your-project.supabase.co" ||
  value.includes("yourdomain.com");

function parseEnv(path) {
  const out = [];
  for (const line of readFileSync(path, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq < 1) continue;
    const name = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    // Strip one layer of quotes, the way a shell would.
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out.push([name, value]);
  }
  return out;
}

const vars = parseEnv(".env.local");
if (!vars.length) {
  console.error("No variables found in .env.local.");
  process.exit(1);
}

const vercel = (args, input) =>
  spawnSync("npx", ["vercel", ...args], {
    input,
    encoding: "utf8",
    shell: process.platform === "win32",
  });

// A dry run only reads a local file, so it does not need an account.
if (!dry) {
  const who = vercel(["whoami"]);
  if (who.status !== 0) {
    console.error("Not logged in. Run `npx vercel login` first, then `npx vercel link`.");
    process.exit(1);
  }
  console.log(`Account: ${who.stdout.trim().split("\n").pop()}`);
}
console.log(`Target:  ${target}${dry ? "  (dry run, nothing will be written)" : ""}\n`);

let pushed = 0;
let skipped = 0;

for (const [name, original] of vars) {
  const value = name === "NEXT_PUBLIC_APP_URL" && appUrl ? appUrl : original;

  if (name === "NEXT_PUBLIC_APP_URL" && appUrl) {
    console.log(`  note  ${name} -> ${appUrl}`);
  }

  if (SKIP.has(name)) {
    console.log(`  skip  ${name}  (local only)`);
    skipped += 1;
    continue;
  }
  if (isPlaceholder(value)) {
    console.log(`  skip  ${name}  (empty or still a placeholder)`);
    skipped += 1;
    continue;
  }
  if (dry) {
    console.log(`   would push  ${name}  (${value.length} chars)`);
    pushed += 1;
    continue;
  }

  // `NEXT_PUBLIC_*` values are compiled into the browser bundle, so they are
  // not secrets and must not be stored as ones — the CLI otherwise stops on a
  // value that looks like a credential, which the Supabase anon key does.
  // Everything else is a secret and is stored as one.
  const kind = name.startsWith("NEXT_PUBLIC_") ? "--no-sensitive" : "--sensitive";

  // `--force` overwrites in place: removing first would leave the environment
  // half-populated if the add then failed.
  const res = vercel(["env", "add", name, target, kind, "--force"], `${value}\n`);

  if (res.status === 0) {
    console.log(`     ok  ${name}`);
    pushed += 1;
  } else {
    const why = (res.stderr || res.stdout || "").trim().split("\n").slice(-2).join(" ");
    console.log(`  FAIL  ${name}  ${why}`);
  }
}

console.log(`\n${pushed} pushed, ${skipped} skipped.`);
console.log(
  "NEXT_PUBLIC_* values are baked in at build time, so deploy again after changing one.",
);
