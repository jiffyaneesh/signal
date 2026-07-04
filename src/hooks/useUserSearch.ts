import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import { searchUsers } from '../lib/search';
import { follow, unfollow } from '../lib/social';
import type { SearchUser } from '../types';

// Debounce window: wait this long after the last keystroke before hitting the
// network. Keeps a fast typist from firing a request per character.
const DEBOUNCE_MS = 300;

// Status of the current query, so the screen can render the right thing:
//   'idle'    — box empty, show the intro/prompt
//   'loading' — a search is in flight (or debounce is pending) → skeletons
//   'empty'   — search completed, no matches
//   'results' — matches present
//   'error'   — the request failed
export type SearchStatus = 'idle' | 'loading' | 'empty' | 'results' | 'error';

// Drives the user-search screen. Owns the query string, debounces it, runs the
// search, and discards stale responses (a slow request for "ab" must never
// overwrite the results for "abc"). Follow toggling is optimistic, mirroring
// useFollowList.
export function useUserSearch() {
  const { user } = useAuth();
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<SearchUser[]>([]);
  const [status, setStatus] = useState<SearchStatus>('idle');
  const [error, setError] = useState<string | null>(null);
  const [pendingIds, setPendingIds] = useState<Set<string>>(new Set());

  // Monotonic id: only the most-recently-issued request may commit its result.
  const requestSeq = useRef(0);

  useEffect(() => {
    const q = query.trim();

    // Empty box → reset to idle immediately, cancel any pending request.
    if (!q) {
      requestSeq.current += 1; // invalidate anything in flight
      setResults([]);
      setStatus('idle');
      setError(null);
      return;
    }

    if (!user) return;

    // Enter loading as soon as the user types (covers the debounce gap too, so
    // the UI never flashes "no results" while we wait).
    setStatus('loading');
    setError(null);

    const seq = ++requestSeq.current;
    const handle = setTimeout(async () => {
      try {
        const found = await searchUsers(q, user.id);
        if (seq !== requestSeq.current) return; // stale — a newer query superseded us
        setResults(found);
        setStatus(found.length ? 'results' : 'empty');
      } catch (e: unknown) {
        if (seq !== requestSeq.current) return;
        setError(e instanceof Error ? e.message : String(e));
        setStatus('error');
      }
    }, DEBOUNCE_MS);

    return () => clearTimeout(handle);
  }, [query, user]);

  // Optimistic follow toggle for a result row. Flip immediately, roll back on
  // failure. pendingIds guards double-taps.
  const toggleFollow = useCallback(
    async (target: SearchUser) => {
      if (!user || pendingIds.has(target.id)) return;
      const next = !target.isFollowing;
      setPendingIds((s) => new Set(s).add(target.id));
      setResults((list) => list.map((u) => (u.id === target.id ? { ...u, isFollowing: next } : u)));
      try {
        if (next) await follow(user.id, target.id);
        else await unfollow(user.id, target.id);
      } catch (e: unknown) {
        setResults((list) => list.map((u) => (u.id === target.id ? { ...u, isFollowing: !next } : u)));
        setError(e instanceof Error ? e.message : String(e));
      } finally {
        setPendingIds((s) => {
          const n = new Set(s);
          n.delete(target.id);
          return n;
        });
      }
    },
    [user, pendingIds]
  );

  return { query, setQuery, results, status, error, pendingIds, toggleFollow };
}
