import { Stack } from 'expo-router';
import { StatusBar } from 'expo-status-bar';
import * as Notifications from 'expo-notifications';
import * as Linking from 'expo-linking';
import * as SplashScreen from 'expo-splash-screen';
import { useFonts } from 'expo-font';
import { useEffect } from 'react';
import { Platform } from 'react-native';
import { SafeAreaProvider } from 'react-native-safe-area-context';
import { GestureHandlerRootView } from 'react-native-gesture-handler';

import { ChoreAppProvider } from '@/providers/ChoreAppProvider';
import { ThemeProvider } from '@/providers/ThemeProvider';
import { CosmeticsProvider } from '@/providers/CosmeticsProvider';
import { emitNotificationNavigation } from '@/lib/notificationEvents';
import { setupNotificationChannel } from '@/lib/push';
import '@/lib/i18n';

// One regular + one bold weight per themed cosmetic (see the `fontRegular`/
// `fontBold` names in ThemeProvider.tsx) — everything the equipped theme
// might need has to be loaded up front here, since which theme is active
// isn't known until CosmeticsProvider loads the group's saved cosmetics.
import { Quicksand_400Regular, Quicksand_700Bold } from '@expo-google-fonts/quicksand';
import { JetBrainsMono_400Regular, JetBrainsMono_700Bold } from '@expo-google-fonts/jetbrains-mono';
import { EBGaramond_400Regular, EBGaramond_700Bold } from '@expo-google-fonts/eb-garamond';
import { Arimo_400Regular, Arimo_700Bold } from '@expo-google-fonts/arimo';
import { CormorantGaramond_400Regular, CormorantGaramond_700Bold } from '@expo-google-fonts/cormorant-garamond';
import { ComicNeue_400Regular, ComicNeue_700Bold } from '@expo-google-fonts/comic-neue';
import { CourierPrime_400Regular, CourierPrime_700Bold } from '@expo-google-fonts/courier-prime';
import { Comfortaa_400Regular, Comfortaa_700Bold } from '@expo-google-fonts/comfortaa';
import { Baloo2_400Regular, Baloo2_700Bold } from '@expo-google-fonts/baloo-2';

SplashScreen.preventAutoHideAsync().catch(() => {});

if (Platform.OS !== 'web') {
  setupNotificationChannel().catch(() => {});
  Notifications.setNotificationHandler({
    handleNotification: async () => ({
      shouldShowAlert: true,
      shouldShowBanner: true,
      shouldShowList: true,
      shouldPlaySound: true,
      shouldSetBadge: false,
    }),
  });
}

// Deep-link navigation is now handled by the route files (today.tsx / stock.tsx)
// which emit and immediately redirect to index. This function is kept for any
// non-widget callers that may pass a URL directly.
function handleDeepLink(url: string | null) {
  if (!url) return;
  const { hostname, path } = Linking.parse(url);
  const page = hostname || path?.split('/')[0];
  if (page) emitNotificationNavigation({ page });
}

export default function RootLayout() {
  const [fontsLoaded, fontError] = useFonts({
    Quicksand_400Regular,
    Quicksand_700Bold,
    JetBrainsMono_400Regular,
    JetBrainsMono_700Bold,
    EBGaramond_400Regular,
    EBGaramond_700Bold,
    Arimo_400Regular,
    Arimo_700Bold,
    CormorantGaramond_400Regular,
    CormorantGaramond_700Bold,
    ComicNeue_400Regular,
    ComicNeue_700Bold,
    CourierPrime_400Regular,
    CourierPrime_700Bold,
    Comfortaa_400Regular,
    Comfortaa_700Bold,
    Baloo2_400Regular,
    Baloo2_700Bold,
  });

  useEffect(() => {
    if (fontsLoaded || fontError) {
      SplashScreen.hideAsync().catch(() => {});
    }
  }, [fontsLoaded, fontError]);

  useEffect(() => {
    if (Platform.OS === 'web') return;
    const subscription = Notifications.addNotificationResponseReceivedListener((response) => {
      emitNotificationNavigation(response.notification.request.content.data as Record<string, unknown>);
    });
    Notifications.getLastNotificationResponseAsync().then((response) => {
      if (response) emitNotificationNavigation(response.notification.request.content.data as Record<string, unknown>);
    });
    return () => subscription.remove();
  }, []);

  // Widget deep links (chores://today, chores://stock) are handled by the
  // route files today.tsx / stock.tsx — no Linking listener needed here.

  // Keep the native splash screen up until the themed fonts are ready, same
  // as any other "wait for an async resource before first paint" gate — a
  // few hundred KB of bundled TTFs resolve near-instantly, so in practice
  // this is not a noticeable delay.
  if (!fontsLoaded && !fontError) return null;

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <SafeAreaProvider>
        <ChoreAppProvider>
          <CosmeticsProvider>
            <ThemeProvider>
              <StatusBar style="dark" />
              <Stack screenOptions={{ headerShown: false }} />
            </ThemeProvider>
          </CosmeticsProvider>
        </ChoreAppProvider>
      </SafeAreaProvider>
    </GestureHandlerRootView>
  );
}
