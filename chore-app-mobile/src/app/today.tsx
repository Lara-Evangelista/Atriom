import { useEffect } from 'react';
import { router } from 'expo-router';
import { emitNotificationNavigation } from '@/lib/notificationEvents';

export default function TodayRoute() {
  useEffect(() => {
    emitNotificationNavigation({ page: 'today' });
    router.replace('/');
  }, []);
  return null;
}
