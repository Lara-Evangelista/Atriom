import { supabase } from "../supabaseClient";

// Path convention required by the storage RLS policies in schema.sql:
// {group_id}/{chore_event_id}-{timestamp}.jpg
export async function uploadChorePhoto(groupId, eventOrRunId, file) {
  const ext = (file.name.split(".").pop() || "jpg").toLowerCase();
  const path = `${groupId}/${eventOrRunId}-${Date.now()}.${ext}`;
  const { error } = await supabase.storage.from("chore-photos").upload(path, file, {
    upsert: false,
    contentType: file.type || "image/jpeg",
  });
  if (error) throw error;
  return path;
}

const urlCache = new Map();

export async function getSignedPhotoUrl(path) {
  if (!path) return null;
  const cached = urlCache.get(path);
  if (cached && cached.expires > Date.now()) return cached.url;
  const { data, error } = await supabase.storage.from("chore-photos").createSignedUrl(path, 3600);
  if (error) throw error;
  urlCache.set(path, { url: data.signedUrl, expires: Date.now() + 55 * 60 * 1000 });
  return data.signedUrl;
}
