import * as Haptics from 'expo-haptics';
import { useFocusEffect, useRouter } from 'expo-router';
import { memo, useCallback, useEffect, useMemo, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, ConfirmModal, Display, IconButton, Label, Monogram, SignalButton } from '../components/ui';
import { timeAgo } from '../components/VoiceNoteCard';
import { useAuth } from '../context/AuthContext';
import { deleteConversation, fetchConversations } from '../lib/messages';
import { supabase } from '../lib/supabase';
import { colors, fonts, space } from '../theme';
import type { Conversation } from '../types';

// Module-level monotonic topic seq (same reasoning as useUnreadBadge: per-
// instance refs collide on fast remount, so uniquify the realtime topic).
let inboxSeq = 0;

// Direct-message inbox: every 1:1 voice conversation the viewer is part of,
// newest activity first. Tapping a row opens the chat; long-pressing offers to
// delete the thread. New/updated messages bump a conversation live via a
// realtime subscription on `messages`.
export default function MessagesScreen() {
  const router = useRouter();
  const { user } = useAuth();

  const [conversations, setConversations] = useState<Conversation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  // Conversation queued for deletion (drives the confirm modal) + busy flag.
  const [pendingDelete, setPendingDelete] = useState<Conversation | null>(null);
  const [deleting, setDeleting] = useState(false);

  const load = useCallback(async () => {
    if (!user) return;
    setError(null);
    try {
      const list = await fetchConversations(user.id);
      setConversations(list);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load messages.');
    } finally {
      setLoading(false);
    }
  }, [user]);

  // Refetch whenever the inbox regains focus (returning from a chat updates
  // unread counts + ordering).
  useFocusEffect(useCallback(() => { load(); }, [load]));

  // Realtime: any new message in one of the viewer's conversations should
  // re-sort/re-badge the inbox. The cheapest correct move is to refetch — the
  // list is small and this avoids reconciling counts by hand.
  useEffect(() => {
    if (!user) return;
    inboxSeq += 1;
    const channel = supabase
      .channel(`inbox:${user.id}:${inboxSeq}`)
      .on(
        'postgres_changes',
        { event: 'INSERT', schema: 'public', table: 'messages' },
        () => { load(); }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [user, load]);

  // Sum of unread across all threads — surfaced in the header so the inbox
  // shows its weight at a glance.
  const totalUnread = useMemo(
    () => conversations.reduce((n, c) => n + c.unreadCount, 0),
    [conversations],
  );

  const openConversation = useCallback(
    (c: Conversation) => {
      Haptics.selectionAsync().catch(() => {});
      router.navigate(`/messages/${c.id}`);
    },
    [router],
  );

  const requestDelete = useCallback((c: Conversation) => {
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
    setPendingDelete(c);
  }, []);

  // Confirmed delete: drop the thread for both sides, then remove it from the
  // list optimistically (realtime won't fire a DELETE we subscribe to).
  const confirmDelete = useCallback(async () => {
    if (!pendingDelete || deleting) return;
    setDeleting(true);
    try {
      await deleteConversation(pendingDelete.id);
      setConversations((prev) => prev.filter((c) => c.id !== pendingDelete.id));
      setPendingDelete(null);
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete conversation.');
      setPendingDelete(null);
    } finally {
      setDeleting(false);
    }
  }, [pendingDelete, deleting]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      {/* Local top bar: back + title + total unread. */}
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
        <Label muted>MESSAGES</Label>
        {totalUnread > 0 && (
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
              {totalUnread > 99 ? '99+' : totalUnread}
            </Text>
          </View>
        )}
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.ink} size="large" />
        </View>
      ) : error && conversations.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: space.containerPadding, gap: 16 }}>
          <Body style={{ color: colors.error }}>{error}</Body>
          <SignalButton label="RETRY" onPress={load} />
        </View>
      ) : (
        <FlatList
          data={conversations}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: space.containerPadding, gap: space.elementGap, paddingBottom: 120, flexGrow: 1 }}
          removeClippedSubviews
          initialNumToRender={10}
          maxToRenderPerBatch={10}
          windowSize={9}
          ListHeaderComponent={
            <View style={{ marginBottom: space.elementGap }}>
              <Label muted>◆ DIRECT</Label>
              <Display style={{ marginTop: 8 }}>WHISPERS</Display>
              <Body muted style={{ fontSize: 17, marginTop: 6 }}>
                Private voice, only between you two. Hold a thread to delete it.
              </Body>
            </View>
          }
          ListEmptyComponent={
            <View style={{ flex: 1, gap: space.elementGap, alignItems: 'center', justifyContent: 'center' }}>
              <Display style={{ textAlign: 'center' }}>NO{'\n'}WHISPERS.</Display>
              <Body muted style={{ fontSize: 18, textAlign: 'center' }}>
                Open a voice you follow back and tap MESSAGE.
              </Body>
            </View>
          }
          renderItem={({ item }) => (
            <ConversationRow
              conversation={item}
              onPress={openConversation}
              onLongPress={requestDelete}
            />
          )}
        />
      )}

      <ConfirmModal
        visible={!!pendingDelete}
        title="DELETE CONVERSATION?"
        message="This removes every voice message for both of you. Can't be undone."
        confirmLabel="DELETE"
        busy={deleting}
        onConfirm={confirmDelete}
        onCancel={() => setPendingDelete(null)}
      />
    </SafeAreaView>
  );
}

// One inbox row: the other participant's monogram + name, last-activity time,
// and a lime unread pill when there are messages the viewer hasn't heard.
// Memoized — the inbox refetches on every realtime event, so unchanged rows
// should skip re-rendering.
const ConversationRow = memo(function ConversationRow({
  conversation,
  onPress,
  onLongPress,
}: {
  conversation: Conversation;
  onPress: (c: Conversation) => void;
  onLongPress: (c: Conversation) => void;
}) {
  const hasUnread = conversation.unreadCount > 0;
  return (
    <Pressable
      onPress={() => onPress(conversation)}
      onLongPress={() => onLongPress(conversation)}
      delayLongPress={300}
      style={({ pressed }) => ({
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        padding: 16,
        borderWidth: 2,
        borderColor: colors.ink,
        borderRadius: 16,
        backgroundColor: colors.canvas,
        // Unread threads get a lime left rail, matching the Activity screen.
        borderLeftWidth: hasUnread ? 8 : 2,
        borderLeftColor: hasUnread ? colors.signal : colors.ink,
        transform: pressed ? [{ translateX: 1 }, { translateY: 1 }] : [],
      })}>
      <Monogram name={conversation.other.username} size={44} filled={hasUnread} />
      <View style={{ flex: 1, gap: 3 }}>
        <Label numberOfLines={1} style={{ fontSize: 14 }}>
          {conversation.other.username}
        </Label>
        <Label muted style={{ fontSize: 11 }}>
          {hasUnread ? `${conversation.unreadCount} NEW` : timeAgo(conversation.lastMessageAt)}
        </Label>
      </View>
      {hasUnread && (
        <View
          style={{
            minWidth: 24,
            height: 24,
            paddingHorizontal: 8,
            borderRadius: 12,
            borderWidth: 2,
            borderColor: colors.ink,
            backgroundColor: colors.signal,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Label style={{ fontSize: 11 }}>{conversation.unreadCount}</Label>
        </View>
      )}
    </Pressable>
  );
});
