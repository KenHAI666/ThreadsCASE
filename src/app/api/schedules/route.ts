import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserId } from "@/lib/auth";
import { createSchedule, getUserState } from "@/lib/store";
import type { ScheduledPostStatus } from "@/lib/types";

export async function GET() {
  const state = getUserState(requireSessionUserId());
  return NextResponse.json({ schedules: state.schedules });
}

export async function POST(request: NextRequest) {
  const body = await request.json();
  const content = String(body.content || "").trim();
  const scheduledAt = String(body.scheduledAt || "").trim();
  const status = normalizeStatus(body.status);

  if (!content || !scheduledAt) {
    return NextResponse.json({ error: "content and scheduledAt are required" }, { status: 400 });
  }

  const schedule = createSchedule(requireSessionUserId(), {
    content,
    scheduledAt,
    status
  });

  return NextResponse.json({ schedule }, { status: 201 });
}

function normalizeStatus(value: unknown): ScheduledPostStatus {
  if (value === "draft" || value === "published" || value === "failed") return value;
  return "scheduled";
}
