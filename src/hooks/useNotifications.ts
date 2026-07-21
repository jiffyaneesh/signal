import { useCallback, useEffect, useRef, useState } from 'react';

import { useAuth } from '../context/AuthContext';
import {
  fetchNotificationById,
  fetchNotificationsPage,
  fetchUnreadCount,
  markAllRead,
} from '../lib/notifications';
import { supabase } from '../lib/supabase';
import type { AppNotification } from '../types';

// Module-level: monotonic across mounts so a remount can't reuse a realtime
// topic whose channel is still being torn down (removeChannel is async). Same
// fix as useFeed.ts — a per-instance useRef resets to 0 and collides.
let channelSeq = 0;

// Drives the Activity screen: the viewer's notifications, newest first, paged
// 20 at a time with infinite scroll, plus a live unread count. Mirrors the
// useFeed / useFollowList pattern. New notifications arrive via a realtime
// subscription and prepend live.
export function useNotifications() {
  const { user } = useAuth();
  const [items, setItems] = useState<AppNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [hasMore, setHasMore] = useState(true);

  const cursorRef = useRef<string | null>(null);
  const inFlight = useRef(false);
  const itemsRef = useRef<AppNotification[]>([]);
  itemsRef.current = items;

  const load = useCallback(
    async ({ isRefresh = false } = {}) => {
      if (!user) return;
      if (isRefresh) setRefreshing(true);
      else setLoading(true);
      setError(null);
      try {
        // Degrade independently: the list is the primary payload, the unread
        // count is a nice-to-have badge. allSettled so a failed count query
        // doesn't blank the whole screen (and vice versa).
        const [pageRes, unreadRes] = await Promise.allSettled([
          fetchNotificationsPage({ viewerId: user.id }),
          fetchUnreadCount(user.id),
        ]);
        if (pageRes.status === 'fulfilled') {
          setItems(pageRes.value.items);
          cursorRef.current = pageRes.value.nextCursor;
          setHasMore(pageRes.value.hasMore);
        } else {
          throw pageRes.reason;
        }
        if (unreadRes.status === 'fulfilled') setUnreadCount(unreadRes.value);
      } catch (e: unknown) {
        setError(e instanceof Error ? e.message : String(e));
        if (!isRefresh) setItems([]);
      } finally {
        if (isRefresh) setRefreshing(false);
        else setLoading(false);
      }
    },
    [user]
  );

  const loadMore = useCallback(async () => {
    if (!user || inFlight.current || !hasMore || loading) return;
    inFlight.current = true;
    setLoadingMore(true);
    try {
      const { items: page, nextCursor, hasMore: more } = await fetchNotificationsPage({
        viewerId: user.id,
        before: cursorRef.current,
      });
      setItems((prev) => {
        const seen = new Set(prev.map((n) => n.id));
        return [...prev, ...page.filter((n) => !seen.has(n.id))];
      });
      cursorRef.current = nextCursor;
      setHasMore(more);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      inFlight.current = false;
      setLoadingMore(false);
    }
  }, [user, hasMore, loading]);

  useEffect(() => {
    load();
  }, [load]);

  // Realtime: prepend new notifications as they arrive and bump the unread
  // count. Filtered to this recipient server-side.
  useEffect(() => {
    if (!user) return;
    const viewerId = user.id;

    channelSeq += 1;
    const topic = `notifications:${viewerId}:${channelSeq}`;

    const channel = supabase
      .channel(topic)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'notifications',
          filter: `recipient_id=eq.${viewerId}`,
        },
        async (payload) => {
          const id = (payload.new as { id: string }).id;
          if (itemsRef.current.some((n) => n.id === id)) return;
          try {
            const note = await fetchNotificationById(id);
            if (!note) return;
            setItems((prev) => (prev.some((n) => n.id === note.id) ? prev : [note, ...prev]));
            if (!note.read) setUnreadCount((c) => c + 1);
          } catch {
            // Best-effort live update; a failed hydrate waits for refresh.
          }
        }
      )
      .subscribe();

    return () => {
      supabase.removeChannel(channel);
    };
  }, [user]);

  // Mark everything read (called when the Activity screen opens). Optimistic:
  // zero the badge + flip local rows, roll back on failure.
  const markAllSeen = useCallback(async () => {
    if (!user || unreadCount === 0) return;
    setUnreadCount(0);
    setItems((prev) => prev.map((n) => (n.read ? n : { ...n, read: true })));
    try {
      await markAllRead(user.id);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : String(e));
    }
  }, [user, unreadCount]);

  return {
    items,
    unreadCount,
    loading,
    refreshing,
    loadingMore,
    error,
    hasMore,
    reload: load,
    refresh: () => load({ isRefresh: true }),
    loadMore,
    markAllSeen,
  };
}
