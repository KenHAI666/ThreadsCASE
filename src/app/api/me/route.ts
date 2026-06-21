import { NextResponse } from "next/server";
import { requireSessionUserId } from "@/lib/auth";
import { calculatePerformance } from "@/lib/metrics";
import { getUserState } from "@/lib/store";

export async function GET() {
  const state = getUserState(requireSessionUserId());
  return NextResponse.json({
    account: state.account,
    metrics: state.metrics,
    summary: calculatePerformance(state.metrics),
    schedules: state.schedules
  });
}
