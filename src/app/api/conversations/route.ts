import { NextResponse } from "next/server";
import { listConversations } from "@/db/queries";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const sessionId =
    new URL(req.url).searchParams.get("sessionId") ??
    req.headers.get("x-session-id");
  if (!sessionId) {
    return NextResponse.json({ conversations: [] });
  }
  const conversations = await listConversations(sessionId);
  return NextResponse.json({ conversations });
}
