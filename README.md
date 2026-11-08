# Atriom 🧹✨

An intelligent household chore management, habit tracking, and shared living coordination platform.

Atriom features a modern cross-platform mobile app (React Native / Expo), a full-featured web client (React / Vite / Tailwind), and a secure serverless backend powered by Supabase (PostgreSQL with Row-Level Security, stored procedures, and Deno Edge Functions).

---

## 🌟 Key Features

- **Continuous Rolling Chore Schedules**: Scheduled and rotational chores (e.g., cleaning pets every 3 days, taking out the trash weekly) are always maintained a full month (30 days) in advance. Completing or skipping any occurrence automatically extends the schedule so tasks never stop or lapse.
- **Smart Rotations & Turn-Taking**: Distribute chores fairly across household members with pause/vacation support.
- **Cross-Platform Mobile App**: Built with Expo and React Native for Android and iOS, complete with home-screen widgets (`Today's Chores`, `Out of Stock`) and push notifications.
- **Push Notifications**: Expo native push notifications for Android & iOS (waking up devices with high priority) and Web Push (VAPID) for browser clients.
- **Gamified Rewards & Cosmetics**: Earn coins on chore completion, customize themes, fonts, and avatars, and view weekly, monthly, and yearly leaderboards.
- **Habit Tracking**: Track daily and weekly personal habits with streak counters calculated in each user's local timezone.
- **Pantry & Shopping Lists**: Track resource consumption on chore runs and manage real-time shopping lists.

---

## 📁 Repository Structure

```
Atriom/
├── chore-app-backend/     # Supabase database schema, SQL migrations, and Edge Functions
│   ├── supabase/
│   │   ├── migrations/    # Ordered SQL migrations (001 - 035)
│   │   └── functions/     # Deno Edge Functions (notify, daily-check, calendar-feed, etc.)
│   └── README.md
├── chore-app-frontend/    # Web & Desktop application (React, Vite, Tailwind CSS, Tauri)
│   ├── src/
│   └── .env.example
├── chore-app-mobile/      # Native mobile app (Expo SDK, React Native, TypeScript)
│   ├── src/
│   ├── app.json
│   └── .env.example
├── .env.example           # Monorepo environment variable template
└── .gitignore             # Protects all secret tokens, credentials, and environment files
```

---

## 🔒 Security & Environment Variables

All secret keys, credentials, and `.env` files are strictly ignored by `.gitignore` to prevent leaking private credentials or hitting free-tier database limits.

**Never commit `.env` or service account JSON files to git.**

### Setting Up Your Own Environment

To run this project, you need your own Supabase project (the free tier works perfectly).

#### 1. Set Up Supabase

1. Create a free project at [supabase.com](https://supabase.com).
2. Go to your **Project Settings** → **API** to copy:
   - **Project URL** (`https://<project-ref>.supabase.co`)
   - **anon / public key** (`anon` publishable key)
   - **service_role key** (secret key — keep private!)
3. In the Supabase SQL Editor, run the migrations from `chore-app-backend/supabase/migrations/` in sequential order (`001_initial_schema.sql` through `035_auto_rolling_chore_schedule.sql`).

#### 2. Configure the Web Frontend

1. Navigate to `chore-app-frontend/`:
   ```bash
   cd chore-app-frontend
   ```
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Fill in your Supabase project details:
   ```env
   VITE_SUPABASE_URL=https://your-project.supabase.co
   VITE_SUPABASE_ANON_KEY=your-publishable-anon-key
   VITE_CALENDAR_FEED_URL=https://your-project.supabase.co/functions/v1/calendar-feed
   VITE_VAPID_PUBLIC_KEY=your-webpush-public-key
   ```
4. Install dependencies and start the local development server:
   ```bash
   npm install
   npm run dev
   ```

#### 3. Configure the Mobile App

1. Navigate to `chore-app-mobile/`:
   ```bash
   cd chore-app-mobile
   ```
2. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```
3. Fill in your configuration:
   ```env
   EXPO_PUBLIC_SUPABASE_URL=https://your-project.supabase.co
   EXPO_PUBLIC_SUPABASE_ANON_KEY=your-publishable-anon-key
   EXPO_PUBLIC_EAS_PROJECT_ID=your-expo-eas-project-id
   ```
   *(Note: To obtain an `EXPO_PUBLIC_EAS_PROJECT_ID`, run `npx eas init` or create a project on [expo.dev](https://expo.dev)).*
4. Install dependencies and start Expo:
   ```bash
   npm install
   npx expo start
   ```

---

## 🔔 Setting Up Notifications

Atriom supports both native mobile push notifications and browser web push.

### Native Mobile Push (Expo)
- When a user logs in on a physical mobile device, the app automatically registers their Expo push token with the `expo_push_tokens` table in Supabase.
- Android uses the notification channel `chores` configured with `MAX` importance to show heads-up notifications.
- When an assignee completes their turn in a rotational chore, the edge function notifies the other members in the rotation or household.

### Web Push (Browser)
1. Generate a VAPID keypair:
   ```bash
   npx web-push generate-vapid-keys
   ```
2. Add `VITE_VAPID_PUBLIC_KEY` to `chore-app-frontend/.env`.
3. Set the keys on your Supabase project:
   ```bash
   supabase secrets set VAPID_PUBLIC_KEY=<your-public-key>
   supabase secrets set VAPID_PRIVATE_KEY=<your-private-key>
   supabase secrets set VAPID_SUBJECT=mailto:your-email@example.com
   ```

### Deploying Edge Functions
Deploy the functions to your Supabase project:
```bash
supabase functions deploy notify
supabase functions deploy notify-completion
supabase functions deploy notify-nudge
supabase functions deploy daily-check
supabase functions deploy calendar-feed --no-verify-jwt
```

---

## 🔄 How the 30-Day Rolling Schedule Works

- Every recurring chore is pre-populated **30 days into the future**.
- **On Completion / Skip**: Whenever a turn is marked complete (via `complete_chore_event`) or skipped (`skip_chore_event`), the database immediately extends that chore's schedule by 30 days ahead from today. This guarantees you always see an upcoming month of occurrences.
- **On App Launch**: When opening the mobile or web app, `ensure_all_events` verifies that all active household chores have occurrences populated through the next 30 days, keeping schedules completely uninterrupted even on Supabase free tier where external crons may not be running.

---

## 📄 License

MIT License. See individual subdirectories for third-party dependencies and assets.
