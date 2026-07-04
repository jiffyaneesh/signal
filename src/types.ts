// Shared application types. DB row shapes mirror the SQL in supabase/migrations;
// the "decorated" shapes are what the data layer returns to the UI.

import { REACTION_EMOJIS } from './theme';

// ─────────────────────────────────────────────────────────────
// Database rows (public schema)
// ─────────────────────────────────────────────────────────────

export interface UserRow {
  id: string;
  username: string;
  created_at: string;
}

export interface VoiceNoteRow {
  id: string;
  user_id: string;
  audio_url: string;
  duration: number | null;
  created_at: string;
  // Denormalized reaction aggregates, maintained by a DB trigger (see
  // migration 0006). The feed reads these directly instead of counting rows.
  reaction_total: number;
  reaction_counts: ReactionCounts;
}

// One of the six allowed reaction emojis.
export type ReactionEmoji = (typeof REACTION_EMOJIS)[number];

export interface ReactionRow {
  emoji: ReactionEmoji;
}

// ─────────────────────────────────────────────────────────────
// Decorated shapes returned by the data layer
// ─────────────────────────────────────────────────────────────

// Per-note reaction aggregate: count per emoji.
export type ReactionCounts = Partial<Record<ReactionEmoji, number>>;

// A feed note: a voice note plus author + reaction aggregate for the viewer.
export interface FeedNote {
  id: string;
  audio_url: string;
  duration: number | null;
  created_at: string;
  user_id: string;
  author: { id: string; username: string };
  reactionCounts: ReactionCounts;
  total: number;
  myReaction: ReactionEmoji | null;
}

// A user's own note (My Notes / Profile lists). Reaction summary comes from the
// denormalized aggregates (migration 0006) — no per-reaction rows fetched.
export interface UserNote {
  id: string;
  audio_url: string;
  duration: number | null;
  created_at: string;
  reactionCounts: ReactionCounts;
  reactionTotal: number;
}

export interface FeedPage {
  notes: FeedNote[];
  nextCursor: string | null;
  hasMore: boolean;
}

// A page of a user's own notes, keyset-paginated by created_at.
export interface UserNotePage {
  notes: UserNote[];
  nextCursor: string | null;
  hasMore: boolean;
}

export interface ProfileStats {
  totalNotes: number;
  totalReactions: number;
}

// Public profile bundle (UserProfileScreen). Stats are counts only; the note
// list is fetched + paginated separately.
export interface PublicProfile {
  username: string;
  totalNotes: number;
  totalReactions: number;
  followerCount: number;
  followingCount: number;
  isFollowing: boolean;
  isSelf: boolean;
  isBlocked: boolean; // does the viewer block this user?
}

// Feed source scope.
export type FeedScope = 'everyone' | 'following';

// ─────────────────────────────────────────────────────────────
// Follow lists (followers / following screens)
// ─────────────────────────────────────────────────────────────

// Which direction of the follow graph a list screen shows.
//   'followers' — users who follow the subject.
//   'following' — users the subject follows.
export type FollowDirection = 'followers' | 'following';

// One row in a follow list: the other user + whether the *viewer* follows them.
// `isSelf` marks the viewer's own row (no follow control there).
export interface FollowUser {
  id: string;
  username: string;
  isFollowing: boolean;
  isSelf: boolean;
  edgeCreatedAt: string; // follows.created_at — the keyset cursor
}

// A page of a follow list. `nextCursor` is the last edge's created_at.
export interface FollowPage {
  users: FollowUser[];
  nextCursor: string | null;
  hasMore: boolean;
}

// ─────────────────────────────────────────────────────────────
// User search (see migration 0015_user_search.sql)
// ─────────────────────────────────────────────────────────────

// One result row in the user-search screen: the matched user plus whether the
// *viewer* follows them (drives the inline follow control). No self row — the
// search RPC excludes the caller server-side.
export interface SearchUser {
  id: string;
  username: string;
  isFollowing: boolean;
}

// ─────────────────────────────────────────────────────────────
// Notifications (activity feed — see migration 0013_notifications.sql)
// ─────────────────────────────────────────────────────────────

// What happened:
//   'reaction' — `actor` reacted `emoji` to your note (`voiceNoteId`).
//   'follow'   — `actor` followed you.
//   'note'     — `actor` (someone you follow) posted a note (`voiceNoteId`).
export type NotificationType = 'reaction' | 'follow' | 'note';

// One decorated notification for the Activity screen. `actor` is resolved
// through public_usernames (users RLS is self-only).
export interface AppNotification {
  id: string;
  type: NotificationType;
  actor: { id: string; username: string };
  voiceNoteId: string | null;
  emoji: ReactionEmoji | null;
  read: boolean;
  createdAt: string; // notifications.created_at — the keyset cursor
}

// A page of notifications, keyset-paginated by created_at.
export interface NotificationPage {
  items: AppNotification[];
  nextCursor: string | null;
  hasMore: boolean;
}
