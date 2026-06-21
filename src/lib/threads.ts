import type { DailyMetric } from "./types";

const THREADS_AUTH_URL = "https://threads.net/oauth/authorize";
const DEFAULT_SCOPES = ["threads_basic", "threads_manage_insights", "threads_content_publish"];

export function hasMetaOAuthConfig() {
  return Boolean(process.env.META_CLIENT_ID && process.env.META_CLIENT_SECRET && process.env.META_REDIRECT_URI);
}

export function buildThreadsAuthorizationUrl(state: string) {
  if (!process.env.META_CLIENT_ID || !process.env.META_REDIRECT_URI) {
    throw new Error("Missing META_CLIENT_ID or META_REDIRECT_URI");
  }

  const url = new URL(THREADS_AUTH_URL);
  url.searchParams.set("client_id", process.env.META_CLIENT_ID);
  url.searchParams.set("redirect_uri", process.env.META_REDIRECT_URI);
  url.searchParams.set("scope", DEFAULT_SCOPES.join(","));
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
}

export async function exchangeThreadsCode(code: string) {
  if (!hasMetaOAuthConfig()) {
    return createDemoAccount();
  }

  // Production replacement point:
  // 1. POST code to graph.threads.net/oauth/access_token.
  // 2. Exchange the short-lived token for a long-lived token.
  // 3. Encrypt and persist the token in connected_accounts.
  return {
    ...createDemoAccount(),
    threadsUserId: `pending-real-token-${code.slice(0, 8)}`
  };
}

export async function fetchThreadsMetrics(): Promise<DailyMetric[]> {
  const rows: DailyMetric[] = [];
  for (let offset = 6; offset >= 0; offset -= 1) {
    const date = new Date();
    date.setDate(date.getDate() - offset);
    const iso = date.toISOString().slice(0, 10);
    const seed = Number(iso.replaceAll("-", "").slice(-3));
    rows.push({
      date: iso,
      views: 1800 + (seed % 1600),
      posts: offset % 3 === 1 ? 1 : 2,
      likes: 120 + ((seed % 90) * 3),
      replies: 18 + (seed % 45),
      followers: 4120 + (6 - offset) * 31 + (seed % 18)
    });
  }
  return rows;
}

function createDemoAccount() {
  return {
    username: "@k_uncle_demo",
    threadsUserId: "threads_demo_user",
    scopes: DEFAULT_SCOPES,
    lastSyncedAt: null
  };
}
