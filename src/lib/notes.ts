import { fetchBlockedIds } from './moderation';
import { fetchFollowingIds } from './social';
import { supabase, VOICE_NOTES_BUCKET } from './supabase';
import type {
  FeedNote,
  FeedPage,
  FeedScope,
  ProfileStats,
  ReactionEmoji,
  ReplyPage,
  UserNote,
  UserNotePage,
  UserReply,
  UserReplyPage,
  VoiceNoteRow,
  VoiceReply,
} from '../types';

// Read a local file uri into an ArrayBuffer for upload (RN-friendly).
async function uriToArrayBuffer(uri: string): Promise<ArrayBuffer> {
  const res = await fetch(uri);
  if (!res.ok) throw new Error('Could not read the recorded audio file.');
  return await res.arrayBuffer();
}

// Upload audio to Storage, then insert the voice_note row. The note is now
// public — every authenticated user sees it in the global feed (no per-user
// delivery fan-out). Throws on any failure — callers surface the message.
export async function uploadAndPost({
  userId,
  uri,
  durationSec,
}: {
  userId: string;
  uri: string | null;
  durationSec: number;
}): Promise<VoiceNoteRow> {
  if (!uri) throw new Error('No recording to post.');

  const fileName = `${userId}/${Date.now()}.m4a`;
  const bytes = await uriToArrayBuffer(uri);

  const { error: uploadError } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .upload(fileName, bytes, { contentType: 'audio/m4a', upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: pub } = supabase.storage.from(VOICE_NOTES_BUCKET).getPublicUrl(fileName);
  const audioUrl = pub.publicUrl;

  const { data: note, error: insertError } = await supabase
    .from('voice_notes')
    .insert({ user_id: userId, audio_url: audioUrl, duration: durationSec })
    .select()
    .single();
  if (insertError) throw new Error(`Could not save note: ${insertError.message}`);

  // Sign the newly uploaded audio URL so the client can play it immediately.
  const { data: signed } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .createSignedUrl(fileName, 3600);
  if (signed?.signedUrl) {
    (note as VoiceNoteRow).audio_url = signed.signedUrl;
  }

  return note as VoiceNoteRow;
}

// ─────────────────────────────────────────────────────────────
// Global feed
// ─────────────────────────────────────────────────────────────

const FEED_PAGE_SIZE = 10;

// A bare voice_notes row as selected for the feed. Reaction aggregates come
// denormalized off the row (migration 0006) — no per-reaction fan-out.
type FeedRow = Pick<
  VoiceNoteRow,
  'id' | 'audio_url' | 'duration' | 'created_at' | 'user_id' | 'reaction_total' | 'reaction_counts' | 'reply_count'
>;

// Columns to select for a feed row (aggregates included, reply count included).
const FEED_COLUMNS = 'id, audio_url, duration, created_at, user_id, reaction_total, reaction_counts, reply_count';

// Attach poster usernames + the viewer's own reaction to a batch of note rows.
// Reaction COUNTS are read straight off the denormalized aggregate columns, so
// the only reaction rows fetched are the viewer's own (one per note, bounded) —
// not every reaction on every note. `viewerId` marks the viewer's own reaction.
async function decorateNotes(rows: FeedRow[], viewerId: string): Promise<FeedNote[]> {
  if (!rows.length) return [];

  const noteIds = rows.map((n) => n.id);
  const authorIds = [...new Set(rows.map((n) => n.user_id))];

  // Batch-resolve usernames (users RLS is self-only → go through the view) and
  // the viewer's own reactions on these notes, in parallel.
  const [{ data: names, error: nErr }, { data: mine, error: rErr }] = await Promise.all([
    supabase.from('public_usernames').select('id, username').in('id', authorIds),
    supabase
      .from('reactions')
      .select('voice_note_id, emoji')
      .eq('reactor_user_id', viewerId)
      .in('voice_note_id', noteIds),
  ]);
  if (nErr) throw new Error(nErr.message);
  if (rErr) throw new Error(rErr.message);

  const nameById: Record<string, string> = Object.fromEntries(
    (names ?? []).map((n) => [n.id, n.username])
  );
  const mineByNote: Record<string, ReactionEmoji> = Object.fromEntries(
    (mine ?? []).map((r) => [r.voice_note_id, r.emoji as ReactionEmoji])
  );

  const notes = rows.map((n) => ({
    id: n.id,
    audio_url: n.audio_url,
    duration: n.duration,
    created_at: n.created_at,
    user_id: n.user_id,
    author: { id: n.user_id, username: nameById[n.user_id] ?? 'ANON' },
    reactionCounts: n.reaction_counts ?? {},
    total: n.reaction_total ?? 0,
    myReaction: mineByNote[n.id] ?? null,
    // reply_count comes denormalized from the DB row (migration 0016).
    replyCount: n.reply_count ?? 0,
  }));

  return await signAudioUrls(notes);
}

// Fetch one page of the feed, newest first. Keyset pagination: pass the last
// item's `created_at` as `before` to get the next page. `limit` capped at
// FEED_PAGE_SIZE. `scope`:
//   'everyone'  (default) — the global feed, every user's notes.
//   'following' — only notes from users the viewer follows (empty if none).
export async function fetchFeedPage({
  viewerId,
  before = null,
  limit = FEED_PAGE_SIZE,
  scope = 'everyone',
}: {
  viewerId: string;
  before?: string | null;
  limit?: number;
  scope?: FeedScope;
}): Promise<FeedPage> {
  const size = Math.min(limit, FEED_PAGE_SIZE);

  // Blocked authors are excluded from every scope. Following-scope also filters
  // to followed authors; combine (followed minus blocked) so a blocked-but-
  // followed user never leaks through.
  const [blockedIds, followingIds] = await Promise.all([
    fetchBlockedIds(viewerId),
    scope === 'following' ? fetchFollowingIds(viewerId) : Promise.resolve<string[] | null>(null),
  ]);

  let authorIds: string[] | null = null;
  if (scope === 'following') {
    const blockedSet = new Set(blockedIds);
    authorIds = (followingIds ?? []).filter((id) => !blockedSet.has(id));
    // Nobody followed (or all blocked) → nothing to show. Skip the query.
    if (authorIds.length === 0) return { notes: [], nextCursor: null, hasMore: false };
  }

  let query = supabase
    .from('voice_notes')
    .select(FEED_COLUMNS)
    // Exclude reply rows — they belong in the thread view, not the main feed.
    .is('parent_note_id', null)
    .order('created_at', { ascending: false })
    .limit(size);
  if (authorIds) query = query.in('user_id', authorIds);
  // 'everyone' scope: exclude blocked authors via a NOT-IN filter.
  if (!authorIds && blockedIds.length > 0) {
    query = query.not('user_id', 'in', `(${blockedIds.join(',')})`);
  }
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as FeedRow[];
  const notes = await decorateNotes(rows, viewerId);
  const nextCursor = rows.length === size ? rows[rows.length - 1].created_at : null;

  return { notes, nextCursor, hasMore: nextCursor !== null };
}

// Fetch a single feed note, fully decorated (author + viewer's reaction). Used
// by the realtime subscription to hydrate a note that arrived via an INSERT
// event (the raw payload lacks the author username). Returns null if the note
// no longer exists.
export async function fetchNoteById(noteId: string, viewerId: string): Promise<FeedNote | null> {
  const { data, error } = await supabase
    .from('voice_notes')
    .select(FEED_COLUMNS)
    .eq('id', noteId)
    .maybeSingle();
  if (error) throw new Error(error.message);
  if (!data) return null;
  const [note] = await decorateNotes([data as FeedRow], viewerId);
  return note ?? null;
}

// Toggle a reaction for a note. One reaction per user per note:
//   - no current reaction       → insert `emoji`
//   - same emoji tapped again   → remove it
//   - different emoji tapped    → switch to the new emoji
// Returns the resulting reaction emoji (or null if removed). Throws on error.
export async function toggleReaction({
  userId,
  voiceNoteId,
  emoji,
  current,
}: {
  userId: string;
  voiceNoteId: string;
  emoji: ReactionEmoji;
  current: ReactionEmoji | null;
}): Promise<ReactionEmoji | null> {
  if (current === emoji) {
    const { error } = await supabase
      .from('reactions')
      .delete()
      .eq('reactor_user_id', userId)
      .eq('voice_note_id', voiceNoteId);
    if (error) throw new Error(error.message);
    return null;
  }

  // Insert-or-switch. Unique(reactor, note) lets us upsert on that conflict.
  const { error } = await supabase
    .from('reactions')
    .upsert(
      { reactor_user_id: userId, voice_note_id: voiceNoteId, emoji },
      { onConflict: 'reactor_user_id,voice_note_id' }
    );
  if (error) throw new Error(error.message);
  return emoji;
}

// Derive the Storage object path from a public audio URL.
// `.../object/public/voice-notes/<uid>/<file>` → `<uid>/<file>`.
function storagePathFromUrl(audioUrl: string | null): string | null {
  if (!audioUrl) return null;
  const marker = `/${VOICE_NOTES_BUCKET}/`;
  const i = audioUrl.indexOf(marker);
  if (i !== -1) {
    return decodeURIComponent(audioUrl.slice(i + marker.length));
  }
  // Support relative storage paths directly.
  if (!audioUrl.startsWith('http')) {
    return audioUrl;
  }
  return null;
}

// Generate signed URLs in a batch for better performance.
async function signAudioUrls<T extends { audio_url: string | null }>(notes: T[]): Promise<T[]> {
  if (!notes.length) return notes;
  const paths = notes.map((n) => storagePathFromUrl(n.audio_url)).filter((p): p is string => !!p);
  if (!paths.length) return notes;

  try {
    const { data, error } = await supabase.storage
      .from(VOICE_NOTES_BUCKET)
      .createSignedUrls(paths, 3600);
    if (error) {
      console.warn('Failed to create signed URLs:', error.message);
      return notes;
    }

    const signedUrlByPath: Record<string, string> = {};
    for (const item of data ?? []) {
      if (item.signedUrl && item.path) {
        signedUrlByPath[item.path] = item.signedUrl;
      }
    }

    return notes.map((n) => {
      const path = storagePathFromUrl(n.audio_url);
      if (path && signedUrlByPath[path]) {
        return { ...n, audio_url: signedUrlByPath[path] };
      }
      return n;
    });
  } catch (err) {
    console.error('Error signing audio URLs:', err);
    return notes;
  }
}

// Hard-delete a note: removes the DB row (reactions cascade via FK) and the
// audio object from Storage. RLS ensures only the author can do this. Storage
// removal is best-effort — a leftover file should not fail the user-facing op.
export async function deleteNote({
  noteId,
  audioUrl,
}: {
  noteId: string;
  audioUrl: string | null;
}): Promise<void> {
  const { error } = await supabase.from('voice_notes').delete().eq('id', noteId);
  if (error) throw new Error(error.message);

  const path = storagePathFromUrl(audioUrl);
  if (path) {
    const { error: sErr } = await supabase.storage.from(VOICE_NOTES_BUCKET).remove([path]);
    if (sErr) console.warn('Note row deleted but audio file remains:', sErr.message);
  }
}

// ─────────────────────────────────────────────────────────────
// Per-user lists (My Notes / Profile)
// ─────────────────────────────────────────────────────────────

const USER_NOTES_PAGE_SIZE = 15;

// Columns for a user note (denormalized reaction aggregates + reply count).
const USER_NOTE_COLUMNS = 'id, audio_url, duration, created_at, reaction_total, reaction_counts, reply_count';

// One page of a user's notes, newest first. Keyset pagination: pass the last
// item's `created_at` as `before` for the next page. Reaction summaries come
// from the aggregate columns — no per-reaction fan-out per note.
export async function fetchUserNotesPage({
  userId,
  before = null,
  limit = USER_NOTES_PAGE_SIZE,
}: {
  userId: string;
  before?: string | null;
  limit?: number;
}): Promise<UserNotePage> {
  const size = Math.min(limit, USER_NOTES_PAGE_SIZE);

  let query = supabase
    .from('voice_notes')
    .select(USER_NOTE_COLUMNS)
    .eq('user_id', userId)
    // Exclude reply rows from the user's own notes list.
    .is('parent_note_id', null)
    .order('created_at', { ascending: false })
    .limit(size);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Pick<
    VoiceNoteRow,
    'id' | 'audio_url' | 'duration' | 'created_at' | 'reaction_total' | 'reaction_counts' | 'reply_count'
  >[];
  const notes: UserNote[] = rows.map((n) => ({
    id: n.id,
    audio_url: n.audio_url,
    duration: n.duration,
    created_at: n.created_at,
    reactionCounts: n.reaction_counts ?? {},
    reactionTotal: n.reaction_total ?? 0,
    replyCount: n.reply_count ?? 0,
  }));

  const signedNotes = await signAudioUrls(notes);
  const nextCursor = rows.length === size ? rows[rows.length - 1].created_at : null;
  return { notes: signedNotes, nextCursor, hasMore: nextCursor !== null };
}

const USER_REPLIES_PAGE_SIZE = 15;

// Fetch one page of the user's own voice replies (newest first), decorated with
// the parent note author's username so the UI can show "↩ reply to @X" context.
export async function fetchUserRepliesPage({
  userId,
  before = null,
  limit = USER_REPLIES_PAGE_SIZE,
}: {
  userId: string;
  before?: string | null;
  limit?: number;
}): Promise<UserReplyPage> {
  const size = Math.min(limit, USER_REPLIES_PAGE_SIZE);

  // Select reply rows with their parent's user_id so we can resolve the author.
  let query = supabase
    .from('voice_notes')
    .select('id, audio_url, duration, created_at, parent_note_id, voice_notes!parent_note_id(user_id)')
    .eq('user_id', userId)
    // Only reply rows (parent_note_id IS NOT NULL).
    .not('parent_note_id', 'is', null)
    .order('created_at', { ascending: false })
    .limit(size);
  if (before) query = query.lt('created_at', before);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as {
    id: string;
    audio_url: string;
    duration: number | null;
    created_at: string;
    parent_note_id: string;
    voice_notes: { user_id: string } | { user_id: string }[] | null;
  }[];

  if (!rows.length) return { replies: [], nextCursor: null, hasMore: false };

  // Collect parent authors and resolve usernames in one batch.
  const parentAuthorIds = [
    ...new Set(
      rows
        .map((r) => {
          const pn = r.voice_notes;
          if (!pn) return null;
          return Array.isArray(pn) ? pn[0]?.user_id : pn.user_id;
        })
        .filter((id): id is string => !!id)
    ),
  ];

  const nameById: Record<string, string> = {};
  if (parentAuthorIds.length) {
    const { data: names } = await supabase
      .from('public_usernames')
      .select('id, username')
      .in('id', parentAuthorIds);
    for (const n of names ?? []) nameById[n.id] = n.username;
  }

  const rawReplies: UserReply[] = rows.map((r) => {
    const pn = r.voice_notes;
    const parentUserId = pn
      ? Array.isArray(pn)
        ? pn[0]?.user_id
        : pn.user_id
      : null;
    return {
      id: r.id,
      audio_url: r.audio_url,
      duration: r.duration,
      created_at: r.created_at,
      parentNoteId: r.parent_note_id,
      parentAuthorUsername: (parentUserId && nameById[parentUserId]) ?? 'ANON',
    };
  });

  const replies = await signAudioUrls(rawReplies);
  const nextCursor = rows.length === size ? rows[rows.length - 1].created_at : null;
  return { replies, nextCursor, hasMore: nextCursor !== null };
}

// Aggregate profile stats via the server-side RPC (migration 0007): total notes
// + total reactions received, without pulling any note rows.
export async function fetchProfileStats(userId: string): Promise<ProfileStats> {
  const { data, error } = await supabase.rpc('user_note_stats', { target_user_id: userId });
  if (error) throw new Error(error.message);
  const row = Array.isArray(data) ? data[0] : data;
  return {
    totalNotes: row?.note_count ?? 0,
    totalReactions: row?.reaction_count ?? 0,
  };
}

// ─────────────────────────────────────────────────────────────
// Voice replies (migration 0016)
// ─────────────────────────────────────────────────────────────

const REPLY_PAGE_SIZE = 10;

// Columns selected for each reply row in a thread.
const REPLY_COLUMNS = 'id, audio_url, duration, created_at, user_id';

// Fetch one page of voice replies for a parent note, ordered oldest-first
// (natural conversation flow). Keyset-paginated forward via `after`
// (the created_at of the last reply fetched so far).
export async function fetchRepliesPage({
  parentNoteId,
  after = null,
  since = null,
  limit = REPLY_PAGE_SIZE,
}: {
  parentNoteId: string;
  after?: string | null;
  // Inclusive lower bound (>=). Used by realtime: an INSERT event carries the
  // new row's created_at, and we must fetch that exact row to hydrate it with a
  // signed URL + username. `after` (>) would exclude the row that fired the
  // event, so the reply never appears until the thread is reopened.
  since?: string | null;
  limit?: number;
}): Promise<ReplyPage> {
  const size = Math.min(limit, REPLY_PAGE_SIZE);

  let query = supabase
    .from('voice_notes')
    .select(REPLY_COLUMNS)
    .eq('parent_note_id', parentNoteId)
    // Oldest first: replies read top-to-bottom in conversation order.
    .order('created_at', { ascending: true })
    .limit(size);
  // Forward keyset: fetch replies newer than the last-seen cursor.
  if (after) query = query.gt('created_at', after);
  // Inclusive fetch (realtime hydration) — includes the boundary row itself.
  if (since) query = query.gte('created_at', since);

  const { data, error } = await query;
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as Pick<
    VoiceNoteRow,
    'id' | 'audio_url' | 'duration' | 'created_at' | 'user_id'
  >[];

  if (!rows.length) return { replies: [], nextCursor: null, hasMore: false };

  // Resolve author usernames in one batch via the security-definer view
  // (same pattern as decorateNotes in the feed).
  const authorIds = [...new Set(rows.map((r) => r.user_id))];
  const { data: names, error: nErr } = await supabase
    .from('public_usernames')
    .select('id, username')
    .in('id', authorIds);
  if (nErr) throw new Error(nErr.message);

  const nameById: Record<string, string> = Object.fromEntries(
    (names ?? []).map((n) => [n.id, n.username])
  );

  const rawReplies: VoiceReply[] = rows.map((r) => ({
    id: r.id,
    audio_url: r.audio_url,
    duration: r.duration,
    created_at: r.created_at,
    user_id: r.user_id,
    author: { id: r.user_id, username: nameById[r.user_id] ?? 'ANON' },
  }));

  // Sign audio URLs in a single batch for fast playback.
  const replies = await signAudioUrls(rawReplies);
  const nextCursor = rows.length === size ? rows[rows.length - 1].created_at : null;

  return { replies, nextCursor, hasMore: nextCursor !== null };
}

// Upload audio and insert a voice_reply row (parent_note_id set).
// The existing check_voice_note_insert trigger applies — same rate limits
// and duration cap as top-level notes.
export async function uploadAndReply({
  userId,
  uri,
  durationSec,
  parentNoteId,
}: {
  userId: string;
  uri: string | null;
  durationSec: number;
  parentNoteId: string;
}): Promise<VoiceNoteRow> {
  if (!uri) throw new Error('No recording to post.');

  const fileName = `${userId}/${Date.now()}.m4a`;
  const bytes = await uriToArrayBuffer(uri);

  const { error: uploadError } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .upload(fileName, bytes, { contentType: 'audio/m4a', upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: pub } = supabase.storage.from(VOICE_NOTES_BUCKET).getPublicUrl(fileName);
  const audioUrl = pub.publicUrl;

  const { data: note, error: insertError } = await supabase
    .from('voice_notes')
    .insert({
      user_id: userId,
      audio_url: audioUrl,
      duration: durationSec,
      parent_note_id: parentNoteId,
    })
    .select()
    .single();
  if (insertError) throw new Error(`Could not save reply: ${insertError.message}`);

  // Sign the URL so the client can play it immediately.
  const { data: signed } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .createSignedUrl(fileName, 3600);
  if (signed?.signedUrl) {
    (note as VoiceNoteRow).audio_url = signed.signedUrl;
  }

  return note as VoiceNoteRow;
}
