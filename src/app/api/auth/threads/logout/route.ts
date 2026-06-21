import { NextResponse } from "next/server";
import { clearSession, requireSessionUserId } from "@/lib/auth";
import { disconnectAccount } from "@/lib/store";

export async function POST() {
  disconnectAccount(requireSessionUserId());
  clearSession();
  return NextResponse.json({ ok: true });
}
