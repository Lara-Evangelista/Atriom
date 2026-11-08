# Atriom — frontend

Vite + React + Supabase. Covers every RPC in `schema.sql`, not just the
original Today/Calendar/Leaderboard/You slice.

## Setup

1. `npm install`
2. `cp .env.example .env` and fill in your Supabase URL + publishable key
   (and, optionally, your deployed `calendar-feed` function URL).
3. `npm run dev`

## Tabs

- **Today** — your rotating turns, one-time tasks assigned to you, tasks
  that hit their counter limit and are up for grabs, timers currently
  running (with a live countdown and a manual "finish now"), and
  quick-action buttons to bump a counter or start a timer for any chore
  type that has one. A compact activity feed sits at the bottom.
- **Create** — one screen, four chore kinds: rotating/assigned
  (`create_chore_type_scheduled`), one-time (`create_onetime_task`),
  counter-triggered, and timer/cycle. Any kind can optionally consume
  tracked resources on completion. Below the form, "Your chores" lists
  every chore you have (of any kind) and one-time tasks still pending,
  each editable and deletable:
  - Rename or change the icon on anything (`update_chore_details`).
  - Rotating/assigned: change the interval, add/remove people from the
    roster (`update_chore_schedule`) — saving drops not-yet-done future
    turns and regenerates them from the new roster/interval; turns
    already marked done are untouched.
  - One-time task: change who it's assigned to or its due date
    (`update_onetime_task`).
  - Counter-triggered: change the threshold (`update_counter_threshold`).
  - Any kind: change which resources it consumes and how much
    (`update_chore_resources`) — e.g. bumped detergent-pods-per-load.
  - Delete anything (`archive_chore_type` / `delete_onetime_task`) —
    with a confirm step. This is a soft delete: not-yet-done future
    occurrences are removed, but completed history and leaderboard
    points are kept. Use this when circumstances change — pets rehomed,
    a chore no longer applies, etc.
- **Trades** — propose a swap between one of your upcoming turns and
  someone else's turn on the same rotation (`request_trade`), and
  accept/decline swaps proposed to you (`respond_trade`). Tapping the
  swap icon on a Today task jumps here with that turn pre-filled.
- **Stock** — flag something as out (`flag_out_of_stock`), mark it
  restocked (`resolve_stock_item`), and manage tracked `resources` —
  add one, or adjust its quantity by hand (`set_resource_qty`). A
  resource hitting zero (by hand, or automatically from a chore that
  consumes it) files itself here.
- **Calendar** — the month-grid widget from before, now wired to
  `get_calendar_month` and with a detail panel underneath so tapping a
  day's task lets you mark it done right there.
- **Board** — `get_leaderboard` over this week / month / year.
  Tapping a name jumps to their history in **You**.
- **You** — `get_member_history` for yourself or (via the leaderboard)
  anyone else in the household, plus your display name and the
  roster.
- **Settings** — invite code, your private calendar-subscribe link
  (`get_or_create_calendar_token` / `rotate_calendar_token`),
  switching between households if you're in more than one, leaving,
  and signing out.

## Push notifications (Web Push, no native app needed)

Settings → Notifications → "Turn on" prompts for browser notification
permission and registers the device (`save_push_subscription`). This
is standard Web Push — the same thing every notification-sending
website uses — so it works from any browser, including on Android
Chrome, without an app store. See the backend README's "Web Push"
section for the one-time VAPID key setup this depends on
(`VITE_VAPID_PUBLIC_KEY` in `.env`). Notification permission and the
subscription are per browser/device, so turn it on separately on your
phone and on desktop if you want both.

## Installing as an app (Android / desktop, no rewrite)

This is a web app, not React Native — but it's set up as an installable
Progressive Web App (`public/manifest.json` + `public/sw.js`), which
gets most of what "a real app" usually means without a rewrite:

- **Android**: open the deployed site in Chrome → menu → "Add to Home
  screen" (or Chrome will offer an install banner itself). You get a
  home-screen icon, a full-screen window with no browser chrome, and
  working push notifications — all from this same codebase.
- **iOS**: Add to Home Screen works too, but Apple's WebKit doesn't
  support Web Push from home-screen apps on all iOS versions — treat
  iOS push as best-effort.
- **Desktop (Tauri)**: see `src-tauri/` — wraps this same built web app
  as a native-feeling desktop binary (Windows/Mac/Linux). Nothing in
  `src/` changes for this; Tauri just loads the production build.

If you later want actual Play Store / App Store distribution, the
smaller step from here is wrapping this web app with **Capacitor**
(same idea as Tauri, but for iOS/Android app stores) rather than a full
React Native rewrite — ask if you want that scaffolded.

## Theme

Minimalist ↔ Cutesy is a `data-theme` attribute on `<html>` swapping
CSS variables in `src/index.css` — remembered in `localStorage`, no
reload needed. A third theme is one more `[data-theme="..."]` block.
