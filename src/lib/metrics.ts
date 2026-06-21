import type { DailyMetric, PerformanceSummary } from "./types";

export function calculatePerformance(metrics: DailyMetric[]): PerformanceSummary {
  const sorted = [...metrics].sort((a, b) => a.date.localeCompare(b.date));
  const totalViews = sum(sorted, "views");
  const totalPosts = sum(sorted, "posts");
  const totalLikes = sum(sorted, "likes");
  const totalReplies = sum(sorted, "replies");
  const postingDays = sorted.filter((metric) => metric.posts > 0).length;
  const first = sorted[0];
  const latest = sorted.at(-1);
  const followersNow = latest?.followers ?? 0;
  const followerGrowth = first && latest ? latest.followers - first.followers : 0;

  return {
    totalViews,
    totalPosts,
    postingDays,
    postingStreak: calculatePostingStreak(sorted),
    totalLikes,
    totalReplies,
    followersNow,
    followerGrowth,
    viewsPerPost: totalPosts ? Math.round(totalViews / totalPosts) : 0,
    engagementRate: totalViews ? roundRate(((totalLikes + totalReplies) / totalViews) * 100) : 0,
    followerGrowthRate: first?.followers ? roundRate((followerGrowth / first.followers) * 100) : 0,
    postingDensity: sorted.length ? roundRate((postingDays / sorted.length) * 100) : 0
  };
}

function calculatePostingStreak(metrics: DailyMetric[]) {
  let streak = 0;
  for (let index = metrics.length - 1; index >= 0; index -= 1) {
    if (metrics[index].posts <= 0) break;
    streak += 1;
  }
  return streak;
}

function sum(rows: DailyMetric[], key: keyof Pick<DailyMetric, "views" | "posts" | "likes" | "replies" | "followers">) {
  return rows.reduce((total, row) => total + Number(row[key] || 0), 0);
}

function roundRate(value: number) {
  return Number(value.toFixed(2));
}
