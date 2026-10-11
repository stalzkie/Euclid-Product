import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getPublicBoard } from "@/server/public-board";
import { boardForDomain } from "@/server/domains";
import { PublicBoard } from "@/app/b/[publicId]/board";

/**
 * A board reached at the founder's own domain.
 *
 * Nothing routes here directly: middleware rewrites requests whose Host is
 * not this deployment's. The hostname is resolved to a board that has proved
 * it owns the domain, and anything unclaimed is a 404 rather than somebody
 * else's board.
 */

export async function generateMetadata({
  params,
}: {
  params: Promise<{ host: string }>;
}): Promise<Metadata> {
  const { host } = await params;
  const publicId = await boardForDomain(decodeURIComponent(host));
  if (!publicId) return { title: "Not found" };

  const board = await getPublicBoard(publicId);
  if (!board) return { title: "Not found" };

  return {
    title: `${board.design.heading} · ${board.appName ?? board.name}`,
    description: board.design.subheading,
  };
}

export default async function HostedBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ host: string }>;
  searchParams: Promise<{ tab?: string; verified?: string }>;
}) {
  const { host } = await params;
  const query = await searchParams;

  const publicId = await boardForDomain(decodeURIComponent(host));
  if (!publicId) notFound();

  return <PublicBoard publicId={publicId} tab={query.tab} verified={query.verified} />;
}
