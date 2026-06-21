import { NextRequest, NextResponse } from "next/server";
import { requireSessionUserId } from "@/lib/auth";
import { deleteSchedule } from "@/lib/store";

export async function DELETE(_request: NextRequest, { params }: { params: { id: string } }) {
  const schedules = deleteSchedule(requireSessionUserId(), params.id);
  return NextResponse.json({ schedules });
}
