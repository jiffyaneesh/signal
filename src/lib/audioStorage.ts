// Shared audio-storage helpers for the voice-notes bucket.
//
// Voice notes and direct messages both upload m4a clips to the same
// `voice-notes` bucket and sign playback URLs the same way. These three helpers
// used to be copy-pasted into notes.ts and messages.ts; they live here so the
// two data modules stay in sync (fixing one no longer means remembering the
// other).

import { supabase, VOICE_NOTES_BUCKET } from './supabase';

// Read a local file uri into an ArrayBuffer for upload (RN-friendly).
export async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('Could not read the recorded audio file.');
  return await res.arrayBuffer();
}

// Derive the Storage object path from a public audio URL.
// `.../object/public/voice-notes/<uid>/<file>` → `<uid>/<file>`.
// A relative path is passed straight through; anything else returns null.
export function storagePathFromUrl(audioUrl: string | null): string | null {
  if (!audioUrl) return null;
  const marker = `/${VOICE_NOTES_BUCKET}/`;
  const i = audioUrl.indexOf(marker);
  if (i !== -1) return decodeURIComponent(audioUrl.slice(i + marker.length));
  if (!audioUrl.startsWith('http')) return audioUrl;
  return null;
}

// Batch-sign a list of rows' audio_url for immediate playback. Best-effort:
// on failure the rows are returned with their original URLs.
export async function signAudioUrls<T extends { audio_url: string | null }>(
  rows: T[]
): Promise<T[]> {
  if (!rows.length) return rows;
  const paths = rows.map((r) => storagePathFromUrl(r.audio_url)).filter((p): p is string => !!p);
  if (!paths.length) return rows;

  try {
    const { data, error } = await supabase.storage
      .from(VOICE_NOTES_BUCKET)
      .createSignedUrls(paths, 3600);
    if (error) {
      console.warn('Failed to create signed URLs:', error.message);
      return rows;
    }

    const signedUrlByPath: Record<string, string> = {};
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) signedUrlByPath[item.path] = item.signedUrl;
    }

    return rows.map((r) => {
      const path = storagePathFromUrl(r.audio_url);
      return path && signedUrlByPath[path] ? { ...r, audio_url: signedUrlByPath[path] } : r;
    });
  } catch (err) {
    console.error('Error signing audio URLs:', err);
    return rows;
  }
}
