import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";
import { mergeDesign } from "@/lib/design-presets";
import { PLANS } from "@/lib/plans";
import { InstallView } from "./install-view";
import { redactWebhook, type IntegrationKind } from "@/lib/integrations";
import type { IntegrationSummary } from "./integrations-panel";

/** Install widget — the script tag, identity, domains and moderation. */
export default async function InstallPage() {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  // The config column holds webhook URLs and API tokens. It is read here and
  // reduced to a redacted label; the raw value never reaches the browser.
  const { data: rows } = await db
    .from("integrations")
    .select("kind,config,events,active,last_error,last_delivered_at")
    .eq("board_id", ctx.board.id);

  const integrations: IntegrationSummary[] = (rows ?? []).map((row) => {
    const config = (row.config ?? {}) as Record<string, string>;
    return {
      kind: row.kind as IntegrationKind,
      detail: config.webhook_url
        ? redactWebhook(config.webhook_url)
        : (config.repo ?? "Connected"),
      events: row.events ?? [],
      active: row.active,
      lastError: row.last_error,
      lastDeliveredAt: row.last_delivered_at,
    };
  });

  const { count: posts } = await db
    .from("posts")
    .select("id", { count: "exact", head: true })
    .eq("board_id", ctx.board.id);

  return (
    <Shell active="install" ctx={ctx} wide>
      <InstallView
        board={{
          id: ctx.board.id,
          publicId: ctx.board.public_id,
          name: ctx.board.name,
          slug: ctx.board.slug,
          color: ctx.board.color,
          identityMode: ctx.board.identity_mode,
          allowedDomains: ctx.board.allowed_domains,
          anonVoteLimit: ctx.board.anon_vote_limit,
          requireApproval: ctx.board.require_approval,
          categories: ctx.board.categories,
          mode: mergeDesign(ctx.board.design).mode,
        }}
        origin={await appOrigin()}
        stack={ctx.profile?.stack ?? []}
        installed={(posts ?? 0) > 0}
        jwtAllowed={plan.jwtIdentity}
        customDomainAllowed={plan.customDomain}
        integrations={integrations}
        integrationsAllowed={plan.integrations}
        planName={plan.name}
      />
    </Shell>
  );
}
