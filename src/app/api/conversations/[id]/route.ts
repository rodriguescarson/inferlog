import { NextResponse } from "next/server";
import {
  deleteConversation,
  getConversationMessages,
  setConversationStatus,
} from "@/db/queries";

export const runtime = "nodejs";

function session(req: Request) {
  return (
    new URL(req.url).searchParams.get("sessionId") ??
    req.headers.get("x-session-id") ??
    ""
  );
}

// Resume: load a conversation's full transcript.
export async function GET(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const data = await getConversationMessages(id, session(req));
  if (!data) return NextResponse.json({ error: "not_found" }, { status: 404 });
  return NextResponse.json(data);
}

// Cancel (archive/cancel) a conversation without deleting its history.
export async function PATCH(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const body = (await req.json().catch(() => ({}))) as { status?: string };
  const status = body.status === "archived" ? "archived" : "cancelled";
  await setConversationStatus(id, status);
  return NextResponse.json({ ok: true, status });
}

// Hard delete.
export async function DELETE(
  req: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  await deleteConversation(id, session(req));
  return NextResponse.json({ ok: true });
}
