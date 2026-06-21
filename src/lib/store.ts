import type { ConnectedAccount, DailyMetric, ScheduledPost } from "./types";

const DEMO_USER_ID = "demo-user";

type UserState = {
  account: ConnectedAccount;
  metrics: DailyMetric[];
  schedules: ScheduledPost[];
};

const stateByUser = new Map<string, UserState>();

export function getDemoUserId() {
  return DEMO_USER_ID;
}

export function getUserState(userId = DEMO_USER_ID) {
  if (!stateByUser.has(userId)) {
    stateByUser.set(userId, createSeedState());
  }
  return stateByUser.get(userId)!;
}

export function connectAccount(userId: string, account: Omit<ConnectedAccount, "connected">) {
  const state = getUserState(userId);
  state.account = { ...account, connected: true };
  return state.account;
}

export function disconnectAccount(userId: string) {
  const state = getUserState(userId);
  state.account = createDisconnectedAccount();
  return state.account;
}

export function upsertMetrics(userId: string, metrics: DailyMetric[]) {
  const state = getUserState(userId);
  metrics.forEach((metric) => {
    const index = state.metrics.findIndex((item) => item.date === metric.date);
    if (index >= 0) state.metrics[index] = metric;
    else state.metrics.push(metric);
  });
  state.metrics.sort((a, b) => a.date.localeCompare(b.date));
  state.account.lastSyncedAt = new Date().toISOString();
  return state.metrics;
}

export function createSchedule(userId: string, input: Pick<ScheduledPost, "content" | "scheduledAt" | "status">) {
  const state = getUserState(userId);
  const schedule: ScheduledPost = {
    id: crypto.randomUUID(),
    content: input.content,
    scheduledAt: input.scheduledAt,
    status: input.status
  };
  state.schedules.push(schedule);
  state.schedules.sort((a, b) => a.scheduledAt.localeCompare(b.scheduledAt));
  return schedule;
}

export function deleteSchedule(userId: string, scheduleId: string) {
  const state = getUserState(userId);
  state.schedules = state.schedules.filter((item) => item.id !== scheduleId);
  return state.schedules;
}

function createSeedState(): UserState {
  return {
    account: createDisconnectedAccount(),
    metrics: [
      { date: "2026-06-15", views: 1680, posts: 2, likes: 126, replies: 21, followers: 3894 },
      { date: "2026-06-16", views: 980, posts: 0, likes: 41, replies: 7, followers: 3902 },
      { date: "2026-06-17", views: 2310, posts: 2, likes: 188, replies: 36, followers: 3948 },
      { date: "2026-06-18", views: 3040, posts: 1, likes: 231, replies: 44, followers: 4026 },
      { date: "2026-06-19", views: 1870, posts: 1, likes: 114, replies: 18, followers: 4051 },
      { date: "2026-06-20", views: 2560, posts: 2, likes: 205, replies: 39, followers: 4108 },
      { date: "2026-06-21", views: 2940, posts: 2, likes: 248, replies: 51, followers: 4172 }
    ],
    schedules: [
      {
        id: crypto.randomUUID(),
        content: "測試排程貼文：早上發布一篇觀察。",
        scheduledAt: "2026-06-21T09:30:00+08:00",
        status: "scheduled"
      },
      {
        id: crypto.randomUUID(),
        content: "測試草稿：整理本週 Threads 海巡觀察。",
        scheduledAt: "2026-06-23T21:00:00+08:00",
        status: "draft"
      }
    ]
  };
}

function createDisconnectedAccount(): ConnectedAccount {
  return {
    connected: false,
    username: null,
    threadsUserId: null,
    scopes: [],
    lastSyncedAt: null
  };
}
