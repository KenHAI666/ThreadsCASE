create table users (
  id uuid primary key default gen_random_uuid(),
  email text,
  created_at timestamptz not null default now()
);

create table connected_accounts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null default 'threads',
  threads_user_id text not null,
  username text not null,
  access_token_encrypted text,
  token_expires_at timestamptz,
  scopes text[] not null default '{}',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  unique (user_id, provider)
);

create table daily_metrics (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  metric_date date not null,
  views integer not null default 0,
  posts_count integer not null default 0,
  likes integer not null default 0,
  replies integer not null default 0,
  followers_count integer not null default 0,
  created_at timestamptz not null default now(),
  unique (user_id, metric_date)
);

create table scheduled_posts (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  content text not null,
  scheduled_at timestamptz not null,
  status text not null default 'draft',
  published_post_id text,
  error_message text,
  created_at timestamptz not null default now()
);
