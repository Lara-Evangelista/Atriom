# Atriom — backend (Supabase)

## Setup

1. Create a Supabase project.
2. Run `supabase/schema.sql` in the SQL editor.
3. Run `supabase/migrations/002_webpush_and_crud.sql` in the SQL editor
   (adds full chore CRUD + Web Push, replacing the old Expo push_tokens table).
4. Deploy the edge functions:
   ```
   supabase functions deploy notify
   supabase functions deploy daily-check
   supabase functions deploy calendar-feed --no-verify-jwt
   ```
`calendar-feed` needs `--no-verify-jwt` because calendar apps subscribing
to the .ics URL can't send a Supabase auth header — the token in the
query string is the credential instead (see the file's comments).

## Native Expo Push

The mobile app registers its Expo device token with `expo_push_tokens` while
the web/PWA continues to use Web Push. Apply
`supabase/migrations/003_expo_push.sql`, then redeploy the two senders:

```sh
supabase functions deploy notify
supabase functions deploy daily-check
```

Set `EXPO_PUBLIC_EAS_PROJECT_ID` in `chore-app-mobile/.env` to the EAS project
UUID for the mobile app. Test on a physical Android or iOS device; simulators
do not receive remote push notifications.

## Web Push (notifications)

Notifications go out over the standard Web Push protocol — the same one
Chrome/Edge/Firefox use for any website's notifications. No Expo, no
native app, no app-store review needed; a browser tab (including an
"Add to Home Screen" installed PWA on Android) can receive them.

1. Generate a VAPID keypair once, on your own machine:
   ```
   npx web-push generate-vapid-keys
   ```
   This prints a `publicKey` and `privateKey`. Keep the private key secret
   — it's what proves the push messages came from your server.

2. Set them as secrets on the Supabase project (these are read by
   `supabase/functions/_shared/push.ts`):
   ```
   supabase secrets set VAPID_PUBLIC_KEY=<publicKey>
   supabase secrets set VAPID_PRIVATE_KEY=<privateKey>
   supabase secrets set VAPID_SUBJECT=mailto:you@example.com
   ```
   `VAPID_SUBJECT` just tells push services who to contact about your app
   if something's wrong with it — any `mailto:` or `https://` URL works.

3. Put the **public** key (only) in the frontend's `.env` as
   `VITE_VAPID_PUBLIC_KEY` — see `frontend/.env.example`. The private key
   never goes anywhere near the frontend.

That's the whole setup. The frontend's "Enable notifications" button
(Settings tab) handles the browser permission prompt and calls
`save_push_subscription` to register the device; `notify` and
`daily-check` do the sending.

## Personal Habits + Stock/Resource Tags

Run `supabase/migrations/022_habits_and_tags.sql`. Habits are personal
(tied to `auth.users`, not a group) and notifications are fully manual —
each habit has its own set of day/hour reminder slots, with no automatic
"falling behind" nudge. Deploy and schedule the sender:

```sh
supabase functions deploy cron-habit-reminder
```

```sql
select cron.schedule(
  'habit-reminder-check',
  '*/10 * * * *', -- every 10 minutes; reminders fire in each user's own local time
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/cron-habit-reminder',
    headers := jsonb_build_object('Authorization', 'Bearer <service_role_key>')
  );
  $$
);
```

It's safe to run this often — `get_due_habit_reminders()` only returns a
slot once per local day (see `habit_reminder_log`), and a weekly habit's
reminders stop firing for the rest of the week once its target is met.

## Scheduling daily-check (pg_cron)

`daily-check` needs to run once a day (or more often, if you want faster
"cycle finished" alerts) even when nobody has the app open. In the SQL
editor, using the `pg_cron` extension (enable it under
Database → Extensions first):

```sql
select cron.schedule(
  'chore-daily-check',
  '0 8 * * *', -- 8am UTC daily; adjust to your household's timezone
  $$
  select net.http_post(
    url := 'https://<your-project-ref>.supabase.co/functions/v1/daily-check',
    headers := jsonb_build_object('Authorization', 'Bearer <service_role_key>')
  );
  $$
);
```

Replace `<your-project-ref>` and `<service_role_key>` (Project Settings →
API → service_role key — keep this one secret, it bypasses RLS). If you
want faster "cycle finished" pushes than once a day, add a second
`cron.schedule` call at a tighter interval (e.g. `*/15 * * * *`); it's
safe to run more often since it only acts on things that haven't been
notified yet.
