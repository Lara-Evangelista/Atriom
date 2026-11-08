import { useEffect } from 'react';
import { router } from 'expo-router';
import { emitNotificationNavigation } from '@/lib/notificationEvents';

export default function StockRoute() {
  useEffect(() => {
    emitNotificationNavigation({ page: 'stock' });
    router.replace('/');
  }, []);
  return null;
}
