import { NextResponse } from "next/server";
import { connectAccount, getDemoUserId } from "@/lib/store";
import { buildThreadsAuthorizationUrl, hasMetaOAuthConfig } from "@/lib/threads";
import { setDemoSession } from "@/lib/auth";

export async function GET() {
  if (!hasMetaOAuthConfig()) {
    setDemoSession();
    connectAccount(getDemoUserId(), {
      username: "@k_uncle_demo",
      threadsUserId: "threads_demo_user",
      scopes: ["threads_basic", "threads_manage_insights", "threads_content_publish"],
      lastSyncedAt: null
    });
    return NextResponse.redirect(new URL("/", getAppUrl()));
  }

  const state = crypto.randomUUID();
  const response = NextResponse.redirect(buildThreadsAuthorizationUrl(state));
  response.cookies.set("threads_oauth_state", state, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 10
  });
  return response;
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
