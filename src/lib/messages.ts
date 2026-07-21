import { signAudioUrls, uriToArrayBuffer } from './audioStorage';
import { canonicalPair } from './format';
import { supabase, VOICE_NOTES_BUCKET } from './supabase';
import type { Conversation, DirectMessage, MessagePage } from '../types';

// ─────────────────────────────────────────────────────────────
// Direct voice messages (1:1 audio DM — see migration 0019)
//
// Storage/signing lives in ./audioStorage (shared with notes.ts): clips live in
// the same `voice-notes` bucket under the sender's uid folder, and playback
// URLs are signed in a batch.
// ─────────────────────────────────────────────────────────────

const MESSAGE_PAGE_SIZE = 20;

// ─────────────────────────────────────────────────────────────
// Inbox: all conversations involving the viewer, newest activity first.
// ─────────────────────────────────────────────────────────────

// Bare conversation row as selected here.
type ConversationRow = {
  id: string;
  user_a: string;
  user_b: string;
  last_message_at: string;
};

export async function fetchConversations(viewerId: string): Promise<Conversation[]> {
  // RLS already limits rows to the viewer's conversations; the or() filter is
  // redundant but keeps the query intent explicit.
  const { data, error } = await supabase
    .from('conversations')
    .select('id, user_a, user_b, last_message_at')
    .or(`user_a.eq.${viewerId},user_b.eq.${viewerId}`)
    .order('last_message_at', { ascending: false });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as ConversationRow[];
  if (!rows.length) return [];

  // Resolve the OTHER participant's username in one batch (users RLS is
  // self-only → go through the public_usernames view, same as the feed).
  const otherIds = rows.map((r) => (r.user_a === viewerId ? r.user_b : r.user_a));
  const { data: names, error: nErr } = await supabase
    .from('public_usernames')
    .select('id, username')
    .in('id', [...new Set(otherIds)]);
  if (nErr) throw new Error(nErr.message);
  const nameById: Record<string, string> = Object.fromEntries(
    (names ?? []).map((n) => [n.id, n.username])
  );

  // Unread counts per conversation: messages not sent by the viewer with a null
  // read_at. One query for ALL the viewer's unread rows (avoids an N+1 of one
  // head-count per conversation), tallied per conversation_id client-side.
  const unreadById: Record<string, number> = {};
  const { data: unreadRows, error: uErr } = await supabase
    .from('messages')
    .select('conversation_id')
    .in('conversation_id', rows.map((r) => r.id))
    .is('read_at', null)
    .neq('sender_id', viewerId);
  if (uErr) throw new Error(uErr.message);
  for (const u of unreadRows ?? []) {
    unreadById[u.conversation_id] = (unreadById[u.conversation_id] ?? 0) + 1;
  }

  return rows.map((r) => {
    const otherId = r.user_a === viewerId ? r.user_b : r.user_a;
    return {
      id: r.id,
      other: { id: otherId, username: nameById[otherId] ?? 'ANON' },
      lastMessageAt: r.last_message_at,
      unreadCount: unreadById[r.id] ?? 0,
    };
  });
}

// Resolve the OTHER participant of a conversation for the chat header. RLS
// guarantees the viewer is a participant, so exactly one of user_a/user_b is
// the viewer and the other is returned.
export async function fetchConversationMeta(
  conversationId: string,
  viewerId: string
): Promise<{ id: string; username: string }> {
  const { data, error } = await supabase
    .from('conversations')
    .select('user_a, user_b')
    .eq('id', conversationId)
    .single();
  if (error) throw new Error(error.message);

  const otherId = data.user_a === viewerId ? data.user_b : data.user_a;
  const { data: nameRow, error: nErr } = await supabase
    .from('public_usernames')
    .select('username')
    .eq('id', otherId)
    .maybeSingle();
  if (nErr) throw new Error(nErr.message);

  return { id: otherId, username: nameRow?.username ?? 'ANON' };
}

// ─────────────────────────────────────────────────────────────
// Resolve (or lazily create) the conversation between the viewer and another
// user. Mutual-follow is enforced by RLS on insert; a non-mutual pair throws.
// ─────────────────────────────────────────────────────────────

export async function getOrCreateConversation(
  viewerId: string,
  otherId: string
): Promise<string> {
  const { user_a, user_b } = canonicalPair(viewerId, otherId);

  // Try to find the existing row first.
  const { data: existing, error: selErr } = await supabase
    .from('conversations')
    .select('id')
    .eq('user_a', user_a)
    .eq('user_b', user_b)
    .maybeSingle();
  if (selErr) throw new Error(selErr.message);
  if (existing) return existing.id;

  // None yet — create it. RLS rejects the insert unless the pair mutually
  // follows, surfacing as a policy error we translate for the UI.
  const { data: created, error: insErr } = await supabase
    .from('conversations')
    .insert({ user_a, user_b })
    .select('id')
    .single();
  if (insErr) {
    // A concurrent insert from the other side may have won the unique(user_a,
    // user_b) race — re-select before giving up.
    const { data: raced } = await supabase
      .from('conversations')
      .select('id')
      .eq('user_a', user_a)
      .eq('user_b', user_b)
      .maybeSingle();
    if (raced) return raced.id;
    throw new Error('You can only message people you both follow.');
  }
  return created.id;
}

// ─────────────────────────────────────────────────────────────
// Fetch one page of a conversation's messages.
//
// Two modes:
//   • Paginate history (default): newest-first window, then reversed to chat
//     order (oldest→newest). Pass the oldest loaded created_at as `before` to
//     fetch the previous (older) page as the user scrolls up.
//   • Realtime hydration: pass `since` (inclusive, >=) to fetch a just-arrived
//     message by its created_at. Exclusive bounds would skip the very row that
//     fired the realtime event (same bug fixed in the thread reply handler).
// ─────────────────────────────────────────────────────────────

type MessageRow = {
  id: string;
  conversation_id: string;
  sender_id: string;
  audio_url: string;
  duration: number | null;
  created_at: string;
  read_at: string | null;
};

export async function fetchMessagesPage({
  conversationId,
  viewerId,
  before = null,
  since = null,
  limit = MESSAGE_PAGE_SIZE,
}: {
  conversationId: string;
  viewerId: string;
  before?: string | null;
  since?: string | null;
  limit?: number;
}): Promise<MessagePage> {
  const size = Math.min(limit, MESSAGE_PAGE_SIZE);

  if (since) {
    // Realtime hydration: inclusive forward fetch, natural chat order.
    let q = supabase
      .from('messages')
      .select('id, conversation_id, sender_id, audio_url, duration, created_at, read_at')
      .eq('conversation_id', conversationId)
      .gte('created_at', since)
      .order('created_at', { ascending: true })
      .limit(size);
    const { data, error } = await q;
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as MessageRow[];
    const messages = await decorateMessages(rows, viewerId);
    return { messages, nextCursor: null, hasMore: false };
  }

  // History window: fetch newest-first so `before` peels older pages, then
  // reverse into chat order for display.
  let q = supabase
    .from('messages')
    .select('id, conversation_id, sender_id, audio_url, duration, created_at, read_at')
    .eq('conversation_id', conversationId)
    .order('created_at', { ascending: false })
    .limit(size);
  if (before) q = q.lt('created_at', before);

  const { data, error } = await q;
  if (error) throw new Error(error.message);
  const rows = (data ?? []) as MessageRow[];

  // nextCursor is the OLDEST row we fetched (last in this desc list).
  const nextCursor = rows.length === size ? rows[rows.length - 1].created_at : null;
  const messages = await decorateMessages(rows.reverse(), viewerId);
  return { messages, nextCursor, hasMore: nextCursor !== null };
}

// Decorate raw message rows: sign audio + derive mine/read flags for the viewer.
async function decorateMessages(
  rows: MessageRow[],
  viewerId: string
): Promise<DirectMessage[]> {
  if (!rows.length) return [];
  const signed = await signAudioUrls(rows);
  return signed.map((r) => ({
    id: r.id,
    conversationId: r.conversation_id,
    senderId: r.sender_id,
    audio_url: r.audio_url,
    duration: r.duration,
    createdAt: r.created_at,
    mine: r.sender_id === viewerId,
    read: r.read_at !== null,
  }));
}

// ─────────────────────────────────────────────────────────────
// Send a voice message: upload the clip, insert the row. Mutual-follow +
// participant checks are enforced by RLS. Returns the decorated message so the
// sender's UI can append it optimistically without a round-trip.
// ─────────────────────────────────────────────────────────────

export async function uploadAndSendMessage({
  conversationId,
  senderId,
  uri,
  durationSec,
}: {
  conversationId: string;
  senderId: string;
  uri: string | null;
  durationSec: number;
}): Promise<DirectMessage> {
  if (!uri) throw new Error('No recording to send.');

  const fileName = `${senderId}/${Date.now()}.m4a`;
  const bytes = await uriToArrayBuffer(uri);

  const { error: uploadError } = await supabase.storage
    .from(VOICE_NOTES_BUCKET)
    .upload(fileName, bytes, { contentType: 'audio/m4a', upsert: false });
  if (uploadError) throw new Error(`Upload failed: ${uploadError.message}`);

  const { data: pub } = supabase.storage.from(VOICE_NOTES_BUCKET).getPublicUrl(fileName);
  if (!pub.publicUrl) throw new Error('Could not resolve the uploaded audio URL.');

  const { data: row, error: insertError } = await supabase
    .from('messages')
    .insert({
      conversation_id: conversationId,
      sender_id: senderId,
      audio_url: pub.publicUrl,
      duration: durationSec,
    })
    .select('id, conversation_id, sender_id, audio_url, duration, created_at, read_at')
    .single();
  if (insertError) throw new Error(`Could not send message: ${insertError.message}`);

  const [decorated] = await decorateMessages([row as MessageRow], senderId);
  return decorated;
}

// ─────────────────────────────────────────────────────────────
// Mark every incoming (not-mine) unread message in a conversation as read.
// Called when the viewer opens/looks at a chat. Idempotent.
// ─────────────────────────────────────────────────────────────

export async function markConversationRead(
  conversationId: string,
  viewerId: string
): Promise<void> {
  const { error } = await supabase
    .from('messages')
    .update({ read_at: new Date().toISOString() })
    .eq('conversation_id', conversationId)
    .neq('sender_id', viewerId)
    .is('read_at', null);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────
// Delete a conversation (and, via ON DELETE CASCADE, all its messages).
// RLS restricts this to a participant. Deletes the thread for BOTH sides —
// there is no per-user soft hide in the MVP.
// ─────────────────────────────────────────────────────────────

export async function deleteConversation(conversationId: string): Promise<void> {
  const { error } = await supabase
    .from('conversations')
    .delete()
    .eq('id', conversationId);
  if (error) throw new Error(error.message);
}

// ─────────────────────────────────────────────────────────────
// Total unread incoming messages across all the viewer's conversations —
// drives the header DM badge. Head-count query, no rows fetched.
// ─────────────────────────────────────────────────────────────

export async function fetchUnreadMessageCount(viewerId: string): Promise<number> {
  // Which conversations is the viewer in?
  const { data: convos, error: cErr } = await supabase
    .from('conversations')
    .select('id')
    .or(`user_a.eq.${viewerId},user_b.eq.${viewerId}`);
  if (cErr) throw new Error(cErr.message);
  const ids = (convos ?? []).map((c) => c.id);
  if (!ids.length) return 0;

  const { count, error } = await supabase
    .from('messages')
    .select('*', { count: 'exact', head: true })
    .in('conversation_id', ids)
    .is('read_at', null)
    .neq('sender_id', viewerId);
  if (error) throw new Error(error.message);
  return count ?? 0;
}
