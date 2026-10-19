import { Shell } from "@/components/shell";
import { requireFounder } from "@/server/context";
import { supabaseServer } from "@/lib/supabase/server";
import { appOrigin } from "@/lib/origin";
import { mergeDesign } from "@/lib/design-presets";
import { PLANS } from "@/lib/plans";
import { InstallView } from "./install-view";
import { redactWebhook, type IntegrationKind } from "@/lib/integrations";
import { verificationRecord } from "@/lib/domains";
import { listApiKeys } from "./key-actions";
import type { IntegrationSummary } from "./integrations-panel";

/** Where founders point a CNAME: this deployment's own hostname. */
function cnameTarget(): string {
  const configured = process.env.NEXT_PUBLIC_APP_URL;
  if (!configured) return "your-deployment-host";
  try {
    return new URL(configured).hostname;
  } catch {
    return "your-deployment-host";
  }
}

/** Install widget — the script tag, identity, domains and moderation. */
export default async function InstallPage() {
  const ctx = await requireFounder();
  const db = await supabaseServer();
  const plan = PLANS[ctx.workspace.plan];

  // Three independent reads, issued together: on a remote database each one
  // waited for in turn is a visible pause before the screen appears.
  //
  // The integrations config column holds webhook URLs and API tokens. It is
  // read here and reduced to a redacted label; the raw value never reaches
  // the browser.
  const [{ data: rows }, apiKeys] = await Promise.all([
    db
      .from("integrations")
      .select("kind,config,events,active,last_error,last_delivered_at")
      .eq("board_id", ctx.board.id),
    listApiKeys(ctx.board.id),
  ]);

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
        // Whether the widget has actually been served, not whether anyone
        // has posted. A founder who installs it and waits for their users to
        // say something is installed, and used to be shown as not.
        installed={ctx.board.installed_at !== null}
        jwtAllowed={plan.jwtIdentity}
        customDomainAllowed={plan.customDomain}
        integrations={integrations}
        integrationsAllowed={plan.integrations}
        domain={{
          domain: ctx.board.custom_domain ?? null,
          verified: Boolean(ctx.board.custom_domain_verified_at),
          record: ctx.board.custom_domain_token
            ? verificationRecord(ctx.board.custom_domain_token)
            : null,
          target: cnameTarget(),
        }}
        apiKeys={apiKeys}
        planName={plan.name}
      />
    </Shell>
  );
}
