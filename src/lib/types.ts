export type ConnectedAccount = {
  connected: boolean;
  username: string | null;
  threadsUserId: string | null;
  scopes: string[];
  lastSyncedAt: string | null;
};

export type DailyMetric = {
  date: string;
  views: number;
  posts: number;
  likes: number;
  replies: number;
  followers: number;
};

export type ScheduledPostStatus = "draft" | "scheduled" | "published" | "failed";

export type ScheduledPost = {
  id: string;
  content: string;
  scheduledAt: string;
  status: ScheduledPostStatus;
  publishedPostId?: string;
  errorMessage?: string;
};

export type PerformanceSummary = {
  totalViews: number;
  totalPosts: number;
  postingDays: number;
  postingStreak: number;
  totalLikes: number;
  totalReplies: number;
  followersNow: number;
  followerGrowth: number;
  viewsPerPost: number;
  engagementRate: number;
  followerGrowthRate: number;
  postingDensity: number;
};
