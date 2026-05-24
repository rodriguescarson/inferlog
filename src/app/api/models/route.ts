import { NextResponse } from "next/server";
import { listModels, DEFAULT_MODEL_KEY } from "@/lib/providers";

export const runtime = "nodejs";

export function GET() {
  return NextResponse.json({ models: listModels(), default: DEFAULT_MODEL_KEY });
}
