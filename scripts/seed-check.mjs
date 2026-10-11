import { loadEnv } from "./env.mjs";
loadEnv();
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const h = { apikey: key, authorization: `Bearer ${key}` };
const q = async (p) => {
  const r = await fetch(`${url}/rest/v1/${p}`, { headers: h });
  return r.ok ? r.json() : [{ error: (await r.text()).slice(0, 200) }];
};

console.log("post                                  headcount  weighted  status");
for (const p of await q("posts?select=number,title,vote_count,weighted_score,status&order=vote_count.desc&limit=8")) {
  if (p.error) { console.log(p.error); break; }
  console.log(
    `#${String(p.number).padEnd(4)} ${p.title.slice(0, 32).padEnd(34)} ${String(p.vote_count).padStart(6)}  ${String(p.weighted_score).padStart(8)}  ${p.status}`,
  );
}

const plans = await fetch(`${url}/rest/v1/rpc/board_votes_by_plan`, {
  method: "POST", headers: { ...h, "content-type": "application/json" },
  body: JSON.stringify({ p_board: "22222222-0000-0000-0000-000000000001" }),
}).then(r => r.json());
console.log("\nvotes by plan:", plans.map(p => `${p.plan} ${p.votes}`).join(", "));

const share = await fetch(`${url}/rest/v1/rpc/post_paying_share`, {
  method: "POST", headers: { ...h, "content-type": "application/json" },
  body: JSON.stringify({ p_post: "55555555-0000-0000-0000-000000000142" }),
}).then(r => r.json());
console.log("#142 paying share:", share + "%");

const series = await fetch(`${url}/rest/v1/rpc/board_daily_series`, {
  method: "POST", headers: { ...h, "content-type": "application/json" },
  body: JSON.stringify({ p_board: "22222222-0000-0000-0000-000000000001", p_days: 30 }),
}).then(r => r.json());
const half = Math.floor(series.length / 2);
const sum = (a) => a.reduce((x, d) => x + Number(d.votes), 0);
console.log(`30-day series: ${sum(series)} votes | first half ${sum(series.slice(0, half))} -> second half ${sum(series.slice(half))}`);
console.log("total votes:", (await q("votes?select=id")).length, "| voters:", (await q("end_users?select=id")).length);
