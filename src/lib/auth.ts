import { cookies } from "next/headers";
import { getDemoUserId } from "./store";

const SESSION_COOKIE = "threads_ops_session";

export function getSessionUserId() {
  return cookies().get(SESSION_COOKIE)?.value ?? null;
}

export function requireSessionUserId() {
  return getSessionUserId() ?? getDemoUserId();
}

export function setDemoSession() {
  cookies().set(SESSION_COOKIE, getDemoUserId(), {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 30
  });
}

export function clearSession() {
  cookies().delete(SESSION_COOKIE);
}
