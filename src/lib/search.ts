import { supabase } from './supabase';
import type { SearchUser } from '../types';

// ─────────────────────────────────────────────────────────────
// User search (see migration 0015_user_search.sql)
// ─────────────────────────────────────────────────────────────

const SEARCH_LIMIT = 20;

// Search users by username prefix. The heavy lifting — case-insensitive prefix
// match, block filtering (either direction), excluding the caller, and the
// server-side page cap — all happens in the `search_users` RPC. Here we only
// decorate each result with whether the *viewer* follows them, via a single
// batch query (no N+1).
//
// Returns [] for an empty/whitespace query without hitting the network.
export async function searchUsers(query: string, viewerId: string): Promise<SearchUser[]> {
  const q = query.trim();
  if (!q) return [];

  const { data, error } = await supabase.rpc('search_users', { q, lim: SEARCH_LIMIT });
  if (error) throw new Error(error.message);

  const rows = (data ?? []) as { id: string; username: string }[];
  if (rows.length === 0) return [];

  // Batch-resolve which of these users the viewer already follows.
  const ids = rows.map((r) => r.id);
  const { data: edges, error: eErr } = await supabase
    .from('follows')
    .select('followee_id')
    .eq('follower_id', viewerId)
    .in('followee_id', ids);
  if (eErr) throw new Error(eErr.message);

  const followed = new Set((edges ?? []).map((e) => e.followee_id));

  return rows.map((r) => ({
    id: r.id,
    username: r.username,
    isFollowing: followed.has(r.id),
  }));
}
