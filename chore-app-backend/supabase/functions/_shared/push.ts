// supabase/functions/_shared/push.ts
//
// Sends push notifications to mobile devices via Expo's Push API.
// Works for both iOS and Android apps built with Expo.

// Expo's HTTPS Push API accepts a batch of tokens without needing an Expo
// server secret. Receipts are deliberately not polled here; invalid tokens are
// pruned from immediate response errors and again on the next send.

// Expo's HTTPS Push API accepts a batch of tokens without needing an Expo
// server secret. Receipts are deliberately not polled here; invalid tokens are
// pruned from immediate response errors and again on the next send.
export async function sendExpoPush(
  supabase: any,
  userIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {}
): Promise<number> {
  if (!userIds?.length) return 0;
  const { data: rows, error } = await supabase
    .from("expo_push_tokens")
    .select("token")
    .in("user_id", userIds);
  if (error) throw error;
  const tokens = (rows || []).map((row: { token: string }) => row.token);
  if (!tokens.length) return 0;

  const response = await fetch("https://exp.host/--/api/v2/push/send", {
    method: "POST",
    headers: { "Content-Type": "application/json", Accept: "application/json" },
    body: JSON.stringify(tokens.map((to: string) => ({
      to,
      title,
      body,
      data,
      sound: "default",
      channelId: "chores",
      priority: "high",
    }))),
  });
  if (!response.ok) throw new Error(`Expo Push API returned ${response.status}`);
  const payload = await response.json();
  const results = Array.isArray(payload?.data) ? payload.data : [];
  const invalid = results
    .map((item: any, index: number) => item?.details?.error === "DeviceNotRegistered" ? tokens[index] : null)
    .filter(Boolean);
  if (invalid.length) await supabase.from("expo_push_tokens").delete().in("token", invalid);
  return results.filter((item: any) => item?.status === "ok").length;
}

export async function sendPush(
  supabase: any,
  userIds: string[],
  title: string,
  body: string,
  data: Record<string, unknown> = {}
) {
  return await sendExpoPush(supabase, userIds, title, body, data);
}
