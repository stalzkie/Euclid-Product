import type { Metadata } from "next";
import { getPublicBoard } from "@/server/public-board";
import { PublicBoard } from "./board";

export async function generateMetadata({
  params,
}: {
  params: Promise<{ publicId: string }>;
}): Promise<Metadata> {
  const { publicId } = await params;
  const board = await getPublicBoard(publicId);
  if (!board) return { title: "Board not found" };

  return {
    title: `${board.design.heading} · ${board.appName ?? board.name}`,
    description: board.design.subheading,
    openGraph: {
      title: board.design.heading,
      description: board.design.subheading,
    },
  };
}

/** 16 · Public board — ideas, roadmap and changelog on a shareable URL. */
export default async function PublicBoardPage({
  params,
  searchParams,
}: {
  params: Promise<{ publicId: string }>;
  searchParams: Promise<{ tab?: string; verified?: string }>;
}) {
  const { publicId } = await params;
  const query = await searchParams;
  return <PublicBoard publicId={publicId} tab={query.tab} verified={query.verified} />;
}
