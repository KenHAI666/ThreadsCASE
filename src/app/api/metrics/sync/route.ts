import { NextResponse } from "next/server";
import { requireSessionUserId } from "@/lib/auth";
import { calculatePerformance } from "@/lib/metrics";
import { getUserState, upsertMetrics } from "@/lib/store";
import { fetchThreadsMetrics } from "@/lib/threads";

export async function POST() {
  const userId = requireSessionUserId();
  const metrics = await fetchThreadsMetrics();
  upsertMetrics(userId, metrics);
  const state = getUserState(userId);

  return NextResponse.json({
    account: state.account,
    metrics: state.metrics,
    summary: calculatePerformance(state.metrics)
  });
}
