# Threads Ops

Threads personal analytics and scheduling MVP.

## Scope

- Login and connect a Threads account.
- Sync personal Threads metrics.
- Calculate dashboard performance.
- Manage scheduled posts.
- Keep competitor tracking out of the first build.

## Local Setup

```bash
npm install
cp .env.example .env.local
npm run dev
```

Open `http://localhost:3000`.

Without Meta credentials, `/api/auth/threads/login` creates a demo session so the UI can be tested. After a Meta app is ready, set:

```bash
META_CLIENT_ID=
META_CLIENT_SECRET=
META_REDIRECT_URI=
```

## Production Pieces Still Needed

- Replace the in-memory store in `src/lib/store.ts` with Supabase/Postgres.
- Encrypt access tokens before writing them to the database.
- Finish the real Threads token exchange in `src/lib/threads.ts`.
- Add a cron worker to publish scheduled posts.
