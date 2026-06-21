"use client";

import { FormEvent, useEffect, useMemo, useState } from "react";
import type { ConnectedAccount, DailyMetric, PerformanceSummary, ScheduledPost } from "@/lib/types";

type DashboardState = {
  account: ConnectedAccount;
  metrics: DailyMetric[];
  summary: PerformanceSummary;
  schedules: ScheduledPost[];
};

const emptySummary: PerformanceSummary = {
  totalViews: 0,
  totalPosts: 0,
  postingDays: 0,
  postingStreak: 0,
  totalLikes: 0,
  totalReplies: 0,
  followersNow: 0,
  followerGrowth: 0,
  viewsPerPost: 0,
  engagementRate: 0,
  followerGrowthRate: 0,
  postingDensity: 0
};

export default function Dashboard() {
  const [state, setState] = useState<DashboardState | null>(null);
  const [loading, setLoading] = useState(true);
  const [syncing, setSyncing] = useState(false);
  const [content, setContent] = useState("");
  const [date, setDate] = useState(today());
  const [time, setTime] = useState("09:00");
  const [status, setStatus] = useState("scheduled");

  useEffect(() => {
    refresh();
  }, []);

  const summary = state?.summary ?? emptySummary;
  const account = state?.account;
  const metrics = state?.metrics ?? [];
  const schedules = state?.schedules ?? [];
  const calendarDays = useMemo(() => buildCalendarDays(schedules), [schedules]);

  async function refresh() {
    setLoading(true);
    const response = await fetch("/api/me", { cache: "no-store" });
    setState(await response.json());
    setLoading(false);
  }

  async function syncMetrics() {
    setSyncing(true);
    const response = await fetch("/api/metrics/sync", { method: "POST" });
    const payload = await response.json();
    setState((current) => ({
      account: payload.account,
      metrics: payload.metrics,
      summary: payload.summary,
      schedules: current?.schedules ?? []
    }));
    setSyncing(false);
  }

  async function logout() {
    await fetch("/api/auth/threads/logout", { method: "POST" });
    await refresh();
  }

  async function createSchedule(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const response = await fetch("/api/schedules", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        content,
        scheduledAt: `${date}T${time}:00+08:00`,
        status
      })
    });

    if (response.ok) {
      setContent("");
      await refresh();
    }
  }

  async function deleteSchedule(id: string) {
    await fetch(`/api/schedules/${id}`, { method: "DELETE" });
    await refresh();
  }

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand">
          <div className="brand-mark">T</div>
          <div>
            <strong>Threads Ops</strong>
            <span>Personal MVP</span>
          </div>
        </div>
        <nav className="nav-list">
          <a className="nav-item active" href="#personal">個人區</a>
          <a className="nav-item" href="#schedule">排程區</a>
        </nav>
      </aside>

      <main className="main">
        <header className="topbar">
          <div>
            <h1>Threads 個人成效與排程</h1>
            <p className="lead">登入授權後抓取個人資料，計算成效，管理排程貼文。</p>
          </div>
        </header>

        <section className={`auth-panel ${account?.connected ? "connected" : ""}`} id="personal">
          <div>
            <span className={`status-dot ${account?.connected ? "connected" : ""}`} />
            <strong>{account?.connected ? `已連結 ${account.username}` : "尚未連結 Threads 帳號"}</strong>
            <p>{account?.lastSyncedAt ? `最後同步：${new Date(account.lastSyncedAt).toLocaleString("zh-TW")}` : "登入後可自動抓取個人資料。"}</p>
          </div>
          <div className="auth-actions">
            <a className="primary-button link-button" href="/api/auth/threads/login" aria-disabled={account?.connected}>登入並授權</a>
            <button className="secondary-button" onClick={syncMetrics} disabled={!account?.connected || syncing}>
              {syncing ? "抓取中..." : "自動抓取資料"}
            </button>
            <button className="secondary-button" onClick={logout} disabled={!account?.connected}>登出</button>
          </div>
        </section>

        {loading ? (
          <section className="panel">讀取中...</section>
        ) : (
          <>
            <section className="summary-grid">
              <Metric title="總流量" value={summary.totalViews} note={`${metrics.length} 筆資料`} />
              <Metric title="發文天數" value={summary.postingDays} note={`連續 ${summary.postingStreak} 天`} />
              <Metric title="總按讚" value={summary.totalLikes} note={`回覆 ${format(summary.totalReplies)}`} />
              <Metric title="粉絲數" value={summary.followersNow} note={`${summary.followerGrowth >= 0 ? "+" : ""}${format(summary.followerGrowth)}`} />
            </section>

            <section className="workspace">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h2>每日資料</h2>
                    <p>來源可以是真 Threads API，也可以先由 sync mock 回填。</p>
                  </div>
                </div>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>日期</th>
                        <th>流量</th>
                        <th>發文</th>
                        <th>按讚</th>
                        <th>回覆</th>
                        <th>粉絲</th>
                      </tr>
                    </thead>
                    <tbody>
                      {metrics.map((metric) => (
                        <tr key={metric.date}>
                          <td>{metric.date}</td>
                          <td>{format(metric.views)}</td>
                          <td>{format(metric.posts)}</td>
                          <td>{format(metric.likes)}</td>
                          <td>{format(metric.replies)}</td>
                          <td>{format(metric.followers)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>

              <aside className="panel">
                <h2>成效計算</h2>
                <div className="performance-list">
                  <Performance title="單篇平均流量" value={format(summary.viewsPerPost)} />
                  <Performance title="互動率" value={`${summary.engagementRate}%`} />
                  <Performance title="粉絲成長率" value={`${summary.followerGrowthRate}%`} />
                  <Performance title="發文密度" value={`${summary.postingDensity}%`} />
                </div>
              </aside>
            </section>

            <section className="workspace" id="schedule">
              <div className="panel">
                <div className="panel-header">
                  <div>
                    <h2>排程日曆</h2>
                    <p>目前先建立資料，正式發文交給後端 cron worker。</p>
                  </div>
                </div>
                <div className="calendar-grid">
                  {["日", "一", "二", "三", "四", "五", "六"].map((day) => (
                    <div className="calendar-head" key={day}>{day}</div>
                  ))}
                  {calendarDays.map((day) => (
                    <div className={`calendar-cell ${day.inMonth ? "" : "muted-cell"}`} key={day.key}>
                      <span>{day.label}</span>
                      {day.posts.map((post) => (
                        <small className={post.status} key={post.id}>{formatTime(post.scheduledAt)} {statusLabel(post.status)}</small>
                      ))}
                    </div>
                  ))}
                </div>
              </div>

              <aside className="panel">
                <h2>新增排程</h2>
                <form className="stack-form" onSubmit={createSchedule}>
                  <label>
                    <span>日期</span>
                    <input type="date" value={date} onChange={(event) => setDate(event.target.value)} required />
                  </label>
                  <label>
                    <span>時間</span>
                    <input type="time" value={time} onChange={(event) => setTime(event.target.value)} required />
                  </label>
                  <label>
                    <span>狀態</span>
                    <select value={status} onChange={(event) => setStatus(event.target.value)}>
                      <option value="draft">草稿</option>
                      <option value="scheduled">已排程</option>
                    </select>
                  </label>
                  <label>
                    <span>貼文內容</span>
                    <textarea value={content} onChange={(event) => setContent(event.target.value)} rows={5} required />
                  </label>
                  <button className="primary-button" type="submit">加入排程</button>
                </form>

                <div className="schedule-list">
                  {schedules.map((post) => (
                    <article className="schedule-item" key={post.id}>
                      <strong>{new Date(post.scheduledAt).toLocaleString("zh-TW")} · {statusLabel(post.status)}</strong>
                      <p>{post.content}</p>
                      <button className="small-button" onClick={() => deleteSchedule(post.id)}>刪除</button>
                    </article>
                  ))}
                </div>
              </aside>
            </section>
          </>
        )}
      </main>
    </div>
  );
}

function Metric({ title, value, note }: { title: string; value: number; note: string }) {
  return (
    <article className="metric">
      <span>{title}</span>
      <strong>{format(value)}</strong>
      <small>{note}</small>
    </article>
  );
}

function Performance({ title, value }: { title: string; value: string }) {
  return (
    <div>
      <span>{title}</span>
      <strong>{value}</strong>
    </div>
  );
}

function buildCalendarDays(schedules: ScheduledPost[]) {
  const cursor = new Date();
  const year = cursor.getFullYear();
  const month = cursor.getMonth();
  const first = new Date(year, month, 1);
  const last = new Date(year, month + 1, 0);
  const startOffset = first.getDay();
  const totalCells = Math.ceil((startOffset + last.getDate()) / 7) * 7;

  return Array.from({ length: totalCells }, (_, index) => {
    const dayNumber = index - startOffset + 1;
    const inMonth = dayNumber >= 1 && dayNumber <= last.getDate();
    const date = inMonth ? `${year}-${String(month + 1).padStart(2, "0")}-${String(dayNumber).padStart(2, "0")}` : "";
    return {
      key: `${index}-${date}`,
      inMonth,
      label: inMonth ? String(dayNumber) : "",
      posts: schedules.filter((post) => post.scheduledAt.slice(0, 10) === date)
    };
  });
}

function today() {
  return new Date().toISOString().slice(0, 10);
}

function format(value: number) {
  return value.toLocaleString("zh-TW");
}

function formatTime(value: string) {
  return new Date(value).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" });
}

function statusLabel(status: string) {
  return { draft: "草稿", scheduled: "排程", published: "已發佈", failed: "失敗" }[status] ?? status;
}
