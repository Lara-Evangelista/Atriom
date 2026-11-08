import { Redirect } from 'expo-router';

// The "Today's Chores" home-screen widget deep-links here via
// `chores://today` (see src/widgets/TodayChoresWidget.tsx). Expo Router
// resolves deep links against the file-based route tree *before* the
// custom Linking listener in `_layout.tsx` gets to run its own routing —
// with no `today` route on disk, that resolution was landing on
// +not-found ("Unmatched Route") instead of the app.
//
// This file just needs to exist so Router has something to match. The
// actual "go to the Today tab" behavior still comes from
// `_layout.tsx`'s `Linking` listener, which parses the same URL and
// switches ChoreMobileApp's internal tab state via the notification
// navigation event bus -- that part was already correct.
export default function TodayRoute() {
  return <Redirect href="/" />;
}
