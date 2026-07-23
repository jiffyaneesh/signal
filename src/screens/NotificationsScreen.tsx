import { Ionicons } from '@expo/vector-icons';
import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { timeAgo } from '../components/VoiceNoteCard';
import { Body, IconButton, Label, Monogram, Segmented, SignalButton } from '../components/ui';
import type { SegmentOption } from '../components/ui';
import { useNotifications } from '../hooks/useNotifications';
import { colors, fonts, radius, space } from '../theme';
import type { AppNotification, NotificationType } from '../types';

// Per-type presentation. Design system is monochrome + a single lime accent, so
// types are distinguished by ICON (a small corner badge on the actor monogram)
// rather than colour — unread state is what the lime accent is reserved for.
const TYPE_META: Record<NotificationType, { icon: keyof typeof Ionicons.glyphMap; verb: string }> = {
  reaction: { icon: 'heart', verb: 'reacted to your note' },
  follow: { icon: 'person-add', verb: 'followed you' },
  note: { icon: 'mic', verb: 'posted a new note' },
  reply: { icon: 'arrow-undo', verb: 'replied to your note' },
};

// Client-side filter tabs. 'all' shows everything; the rest map 1:1 to a type.
type Filter = 'all' | NotificationType;
const FILTERS: SegmentOption<Filter>[] = [
  { label: 'ALL', value: 'all' },
  { label: 'REACTIONS', value: 'reaction' },
  { label: 'FOLLOWS', value: 'follow' },
  { label: 'REPLIES', value: 'reply' },
];

// Activity: the viewer's notifications (reactions on their notes, new
// followers, notes from people they follow), newest first, 20 per page with
// infinite scroll and live prepends. Opening the screen marks everything read,
// clearing the header badge.
export default function NotificationsScreen() {
  const router = useRouter();
  const {
    items, unreadCount, loading, refreshing, loadingMore, error,
    reload, refresh, loadMore, markAllSeen,
  } = useNotifications();
  const [filter, setFilter] = useState<Filter>('all');

  // Clear the badge whenever this screen gains focus.
  useFocusEffect(useCallback(() => { markAllSeen(); }, [markAllSeen]));

  // Client-side filter. The list is small (paged 20), so filtering in memory is
  // cheaper and simpler than a per-type server query.
  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((n) => n.type === filter)),
    [items, filter],
  );

  // Stable row handler so the memoized NotificationRow can skip re-rendering
  // (item refs are stable across renders; this handler is too).
  const openNotification = useCallback(
    (item: AppNotification) => {
      Haptics.selectionAsync().catch(() => {});
      // Reply notifications link to the thread; everything else to the actor.
      if (item.type === 'reply' && item.voiceNoteId) {
        router.push(`/thread/${item.voiceNoteId}`);
      } else {
        router.push({ pathname: '/user/[id]', params: { id: item.actor.id } });
      }
    },
    [router],
  );

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      {/* Top bar: back + title + live unread count. */}
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 12,
          paddingHorizontal: 24,
          height: 64,
          borderBottomWidth: 2,
          borderBottomColor: colors.ink,
        }}>
        <IconButton glyph="‹" size={40} onPress={() => router.back()} accessibilityLabel="Back" />
        <Label muted>ACTIVITY</Label>
        {unreadCount > 0 && (
          <View
            style={{
              minWidth: 22,
              height: 22,
              paddingHorizontal: 7,
              borderRadius: 11,
              borderWidth: 2,
              borderColor: colors.ink,
              backgroundColor: colors.signal,
              alignItems: 'center',
              justifyContent: 'center',
            }}>
            <Text style={{ fontFamily: fonts.mono, fontSize: 10, color: colors.ink }}>
              {unreadCount > 99 ? '99+' : unreadCount}
            </Text>
          </View>
        )}
      </View>

      {loading && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.ink} size="large" />
        </View>
      ) : error && items.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: space.containerPadding, gap: 16 }}>
          <Body style={{ color: colors.error }}>{error}</Body>
          <SignalButton label="RETRY" onPress={reload} />
        </View>
      ) : (
        <FlatList
          data={visible}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: space.containerPadding, gap: 12, paddingBottom: 120, flexGrow: 1 }}
          refreshing={refreshing}
          onRefresh={refresh}
          onEndReachedThreshold={0.5}
          onEndReached={loadMore}
          // Perf: recycle offscreen rows and cap per-batch work so long lists
          // stay smooth on low-end devices.
          removeClippedSubviews
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={9}
          ListHeaderComponent={
            <View style={{ marginBottom: space.elementGap }}>
              <Segmented options={FILTERS} value={filter} onChange={setFilter} />
            </View>
          }
          ListEmptyComponent={
            !loading ? (
              <View style={{ flex: 1, alignItems: 'center', justifyContent: 'center', gap: 16 }}>
                <Body muted style={{ fontSize: 18, textAlign: 'center' }}>
                  {filter === 'all'
                    ? 'No activity yet. React, follow, and post to get things moving.'
                    : 'Nothing here yet.'}
                </Body>
              </View>
            ) : null
          }
          renderItem={({ item }) => <NotificationRow item={item} onPress={openNotification} />}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 24 }}>
                <ActivityIndicator color={colors.ink} />
              </View>
            ) : null
          }
        />
      )}
    </SafeAreaView>
  );
}

// One activity row. Unread rows get a filled-lime monogram and a thick lime left
// rail; read rows are plain. A small ink badge in the monogram corner carries
// the type icon; reactions also show the emoji large on the right.
const NotificationRow = memo(function NotificationRow({
  item,
  onPress,
}: {
  item: AppNotification;
  onPress: (item: AppNotification) => void;
}) {
  const meta = TYPE_META[item.type];
  return (
    <Pressable
      onPress={() => onPress(item)}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderWidth: 2,
        borderColor: colors.ink,
        borderRadius: radius.lg,
        backgroundColor: colors.canvas,
        borderLeftWidth: item.read ? 2 : 8,
        borderLeftColor: item.read ? colors.ink : colors.signal,
        paddingVertical: 14,
        paddingHorizontal: 16,
        transform: pressed ? [{ translateX: 1 }, { translateY: 1 }] : [],
      })}>
      {/* Monogram + type-icon corner badge. */}
      <View>
        <Monogram name={item.actor.username} size={44} filled={!item.read} />
        <View
          style={{
            position: 'absolute',
            bottom: -4,
            right: -4,
            width: 20,
            height: 20,
            borderRadius: 10,
            borderWidth: 2,
            borderColor: colors.ink,
            backgroundColor: colors.surface,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Ionicons name={meta.icon} size={10} color={colors.ink} />
        </View>
      </View>

      <View style={{ flex: 1, gap: 4 }}>
        <Body style={{ fontSize: 16 }} numberOfLines={2}>
          {item.actor.username.toUpperCase()} {meta.verb}
        </Body>
        <Label muted style={{ fontSize: 11 }}>{timeAgo(item.createdAt)}</Label>
      </View>

      {/* Reaction emoji, shown large so the row reads at a glance. */}
      {item.type === 'reaction' && item.emoji && (
        <Text style={{ fontSize: 22 }}>{item.emoji}</Text>
      )}
    </Pressable>
  );
});
