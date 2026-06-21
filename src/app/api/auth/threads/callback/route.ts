import { NextRequest, NextResponse } from "next/server";
import { setDemoSession } from "@/lib/auth";
import { connectAccount, getDemoUserId } from "@/lib/store";
import { exchangeThreadsCode, hasMetaOAuthConfig } from "@/lib/threads";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const state = request.nextUrl.searchParams.get("state");
  const expectedState = request.cookies.get("threads_oauth_state")?.value;

  if (hasMetaOAuthConfig() && (!code || !state || state !== expectedState)) {
    return NextResponse.redirect(new URL("/?auth=failed", getAppUrl()));
  }

  const account = await exchangeThreadsCode(code ?? "demo-code");
  setDemoSession();
  connectAccount(getDemoUserId(), account);

  const response = NextResponse.redirect(new URL("/", getAppUrl()));
  response.cookies.delete("threads_oauth_state");
  return response;
}

function getAppUrl() {
  return process.env.NEXT_PUBLIC_APP_URL || "http://localhost:3000";
}
