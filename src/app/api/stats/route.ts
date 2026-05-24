import { NextResponse } from "next/server";
import { getStats } from "@/db/queries";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const hours = Number(new URL(req.url).searchParams.get("hours") ?? "24");
  try {
    const stats = await getStats(Number.isFinite(hours) ? hours : 24);
    return NextResponse.json(stats);
  } catch (err) {
    console.error("[stats] failed:", err);
    return NextResponse.json({ error: "stats_failed" }, { status: 500 });
  }
}
