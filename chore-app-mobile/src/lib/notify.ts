import { supabase } from '@/lib/supabase';

export async function notifyHousehold(userIds: string[], groupId: string, title: string, body: string, data: Record<string, unknown> = {}) {
  const { error } = await supabase.functions.invoke('notify', { body: { userIds, groupId, title, body, data } });
  if (error) throw error;
}
