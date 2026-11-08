import { supabase } from "../supabaseClient";

export async function notifyHousehold(userIds, groupId, title, body, data = {}) {
  const { error } = await supabase.functions.invoke("notify", { body: { userIds, groupId, title, body, data } });
  if (error) throw error;
}
