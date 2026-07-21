import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, FlatList, Pressable, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import AudioPlayer from '../components/AudioPlayer';
import WaveformVisualizer from '../components/WaveformVisualizer';
import { Body, ConfirmModal, IconButton, Label } from '../components/ui';
import { timeAgo } from '../components/VoiceNoteCard';
import { useAuth } from '../context/AuthContext';
import { useAudioRecorder } from '../hooks/useAudioRecorder';
import { useWindowedPlayback } from '../hooks/useWindowedPlayback';
import { formatDuration } from '../lib/format';
import {
  deleteConversation,
  fetchConversationMeta,
  fetchMessagesPage,
  markConversationRead,
  uploadAndSendMessage,
} from '../lib/messages';
import { supabase } from '../lib/supabase';
import { colors, radius, space } from '../theme';
import type { DirectMessage } from '../types';

// Module-level monotonic topic seq — a fast remount must not reuse a topic
// (see useUnreadBadge / MessagesScreen for the same guard).
let chatSeq = 0;

// 1:1 voice chat. Messages render newest-at-bottom via an inverted FlatList
// (state holds them newest-first). Scrolling up (onEndReached, inverted) pages
// older history; a realtime channel prepends incoming clips. The compose bar
// records → previews → sends a voice clip inline (voice-only: no text input).
export default function ChatScreen() {
  const router = useRouter();
  const { id: conversationId } = useLocalSearchParams<{ id: string }>();
  const { user } = useAuth();

  const [other, setOther] = useState<{ id: string; username: string } | null>(null);
  const [messages, setMessages] = useState<DirectMessage[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [hasMore, setHasMore] = useState(true);
  const cursorRef = useRef<string | null>(null); // oldest loaded created_at
  const inFlight = useRef(false);
  const [confirmDelete, setConfirmDelete] = useState(false); // delete-thread modal
  const [deleting, setDeleting] = useState(false);

  const { playingNoteId, activate, savePosition, getInitialPosition, handleFinish } =
    useWindowedPlayback();

  // ── Initial load: header meta + newest page, then mark read ───────────────
  const load = useCallback(async () => {
    if (!conversationId || !user) return;
    setError(null);
    try {
      const [meta, page] = await Promise.all([
        fetchConversationMeta(conversationId, user.id),
        fetchMessagesPage({ conversationId, viewerId: user.id }),
      ]);
      setOther(meta);
      // Page is oldest-first; invert to newest-first for the inverted list.
      setMessages([...page.messages].reverse());
      cursorRef.current = page.nextCursor;
      setHasMore(page.hasMore);
      // Opening the chat clears its unread badge.
      markConversationRead(conversationId, user.id).catch(() => {});
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not load conversation.');
    } finally {
      setLoading(false);
    }
  }, [conversationId, user]);

  useEffect(() => { load(); }, [load]);

  // ── Delete the whole conversation (both sides — see deleteConversation) ────
  const removeConversation = useCallback(async () => {
    if (!conversationId || deleting) return;
    setDeleting(true);
    try {
      await deleteConversation(conversationId);
      setConfirmDelete(false);
      router.back();
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Could not delete conversation.');
      setConfirmDelete(false);
    } finally {
      setDeleting(false);
    }
  }, [conversationId, deleting, router]);

  // ── Paginate older history (scroll up in an inverted list) ────────────────
  const loadOlder = useCallback(async () => {
    if (!conversationId || !user || !hasMore || inFlight.current || !cursorRef.current) return;
    inFlight.current = true;
    setLoadingMore(true);
    try {
      const page = await fetchMessagesPage({
        conversationId,
        viewerId: user.id,
        before: cursorRef.current,
      });
      // Older messages go at the END of a newest-first array.
      setMessages((prev) => {
        const seen = new Set(prev.map((m) => m.id));
        const older = [...page.messages].reverse().filter((m) => !seen.has(m.id));
        return [...prev, ...older];
      });
      cursorRef.current = page.nextCursor;
      setHasMore(page.hasMore);
    } catch {
      // Non-fatal — user can scroll again to retry.
    } finally {
      inFlight.current = false;
      setLoadingMore(false);
    }
  }, [conversationId, user, hasMore]);

  // ── Realtime: incoming clips appear live, and mark read immediately ───────
  useEffect(() => {
    if (!conversationId || !user) return;
    chatSeq += 1;
    const channel = supabase
      .channel(`chat:${conversationId}:${chatSeq}`)
      .on(
        'postgres_changes',
        {
          event: 'INSERT',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        async (payload) => {
          try {
            // Inclusive `since` — the payload row IS the new message; an
            // exclusive cursor would skip it (same bug fixed in ThreadScreen).
            const page = await fetchMessagesPage({
              conversationId,
              viewerId: user.id,
              since: (payload.new as { created_at: string }).created_at,
            });
            setMessages((prev) => {
              const seen = new Set(prev.map((m) => m.id));
              const fresh = page.messages.filter((m) => !seen.has(m.id));
              if (!fresh.length) return prev;
              // Newest-first: prepend the fresh (also newest-first) clips.
              return [...[...fresh].reverse(), ...prev];
            });
            // A message that arrived while we're looking is already read.
            markConversationRead(conversationId, user.id).catch(() => {});
          } catch {
            // Hydration failed — leaving/re-entering the chat will resync.
          }
        }
      )
      // Read receipts: when the recipient marks our sent clips read, read_at
      // flips non-null. Patch the matching bubble in place so ✓ → ✓✓ live
      // (migration 0019 enabled UPDATE replication for exactly this).
      .on(
        'postgres_changes',
        {
          event: 'UPDATE',
          schema: 'public',
          table: 'messages',
          filter: `conversation_id=eq.${conversationId}`,
        },
        (payload) => {
          const row = payload.new as { id: string; read_at: string | null };
          setMessages((prev) =>
            prev.map((m) =>
              m.id === row.id ? { ...m, read: row.read_at !== null } : m
            )
          );
        }
      )
      .subscribe();
    return () => { supabase.removeChannel(channel); };
  }, [conversationId, user]);

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      {/* Header: back + the other participant. */}
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
        <Pressable
          onPress={() => other && router.navigate(`/user/${other.id}`)}
          style={{ flex: 1 }}>
          <Label style={{ fontSize: 15 }} numberOfLines={1}>
            {other?.username ?? '—'}
          </Label>
        </Pressable>
        {/* Delete the thread for both participants (confirm first). */}
        <IconButton
          glyph="🗑"
          size={40}
          onPress={() => setConfirmDelete(true)}
          accessibilityLabel="Delete conversation"
        />
      </View>

      {loading ? (
        <View style={{ flex: 1, justifyContent: 'center' }}>
          <ActivityIndicator color={colors.ink} size="large" />
        </View>
      ) : error && messages.length === 0 ? (
        <View style={{ flex: 1, justifyContent: 'center', padding: space.containerPadding, gap: 16 }}>
          <Body style={{ color: colors.error }}>{error}</Body>
        </View>
      ) : (
        <FlatList
          data={messages}
          inverted
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: space.containerPadding, gap: space.elementGap }}
          onEndReached={loadOlder}
          onEndReachedThreshold={0.4}
          ListFooterComponent={
            loadingMore ? (
              <View style={{ paddingVertical: 16 }}>
                <ActivityIndicator color={colors.ink} />
              </View>
            ) : null
          }
          ListEmptyComponent={
            <View style={{ alignItems: 'center', paddingVertical: 40 }}>
              <Label muted>SAY SOMETHING. HOLD TO RECORD.</Label>
            </View>
          }
          renderItem={({ item }) => (
            <MessageBubble
              message={item}
              active={item.id === playingNoteId}
              onActivate={() => activate(item.id)}
              initialPosition={getInitialPosition(item.id)}
              onSavePosition={(s) => savePosition(item.id, s)}
              onFinish={() => handleFinish(item.id)}
            />
          )}
        />
      )}

      {/* Inline voice compose bar. */}
      {!loading && (
        <Composer
          onSend={async (uri, durationSec) => {
            if (!conversationId || !user) return;
            const sent = await uploadAndSendMessage({
              conversationId,
              senderId: user.id,
              uri,
              durationSec,
            });
            // Optimistic prepend (realtime will de-dupe by id if it also fires).
            setMessages((prev) =>
              prev.some((m) => m.id === sent.id) ? prev : [sent, ...prev]
            );
          }}
        />
      )}

      <ConfirmModal
        visible={confirmDelete}
        title="DELETE CONVERSATION?"
        message="This removes every voice message for both of you. Can't be undone."
        confirmLabel="DELETE"
        busy={deleting}
        onConfirm={removeConversation}
        onCancel={() => setConfirmDelete(false)}
      />
    </SafeAreaView>
  );
}

// ── Message bubble ──────────────────────────────────────────────────────────
// Own messages align right with a lime accent; incoming align left. Each is a
// windowed AudioPlayer so only one clip holds native audio at a time.
function MessageBubble({
  message,
  active,
  onActivate,
  initialPosition,
  onSavePosition,
  onFinish,
}: {
  message: DirectMessage;
  active: boolean;
  onActivate: () => void;
  initialPosition: number;
  onSavePosition: (s: number) => void;
  onFinish: () => void;
}) {
  const mine = message.mine;
  return (
    <View style={{ alignItems: mine ? 'flex-end' : 'flex-start' }}>
      <View
        style={{
          maxWidth: '82%',
          minWidth: 220,
          padding: 12,
          borderWidth: 2,
          borderColor: colors.ink,
          borderRadius: 16,
          backgroundColor: mine ? colors.signal : colors.canvas,
          gap: 8,
        }}>
        <AudioPlayer
          uri={message.audio_url}
          bars={22}
          height={44}
          active={active}
          onActivate={onActivate}
          initialPosition={initialPosition}
          onSavePosition={onSavePosition}
          onFinish={onFinish}
        />
        <View style={{ flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' }}>
          <Label muted style={{ fontSize: 9 }}>
            {timeAgo(message.createdAt)}
            {typeof message.duration === 'number'
              ? `  ·  ${formatDuration(message.duration)}`
              : ''}
          </Label>
          {/* Read receipt on own messages: ✓✓ once the recipient has heard it. */}
          {mine && (
            <Label muted style={{ fontSize: 9 }}>{message.read ? '✓✓' : '✓'}</Label>
          )}
        </View>
      </View>
    </View>
  );
}

// ── Composer ──────────────────────────────────────────────────────────────
// Voice-only compose: idle → recording → preview → send. Mirrors
// ReplyRecordScreen's flow, condensed into a fixed bottom bar.
function Composer({ onSend }: { onSend: (uri: string, durationSec: number) => Promise<void> }) {
  const rec = useAudioRecorder();
  const [recordedUri, setRecordedUri] = useState<string | null>(null);
  const [recordedDuration, setRecordedDuration] = useState(0);
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);

  const isRecording = rec.isRecording;
  const hasPreview = !!recordedUri && !isRecording;

  async function toggleRecord() {
    setSendError(null);
    if (isRecording) {
      const uri = await rec.stop();
      setRecordedDuration(rec.durationSec);
      if (uri) setRecordedUri(uri);
    } else {
      await rec.start();
    }
  }

  function discard() {
    setRecordedUri(null);
    setRecordedDuration(0);
    setSendError(null);
  }

  async function send() {
    if (!recordedUri || sending) return;
    setSending(true);
    setSendError(null);
    try {
      await onSend(recordedUri, recordedDuration || 1);
      discard();
    } catch (e: unknown) {
      setSendError(e instanceof Error ? e.message : 'Could not send.');
    } finally {
      setSending(false);
    }
  }

  return (
    <View
      style={{
        borderTopWidth: 2,
        borderTopColor: colors.ink,
        backgroundColor: colors.surface,
        padding: space.containerPadding,
        gap: 10,
      }}>
      {sendError && (
        <Body style={{ color: colors.error, fontSize: 13 }}>{sendError}</Body>
      )}

      {hasPreview ? (
        // Preview + send row.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1 }}>
            <AudioPlayer uri={recordedUri} bars={28} height={44} />
          </View>
          <Pressable onPress={discard} disabled={sending} hitSlop={8}>
            <Label muted style={{ fontSize: 12 }}>DISCARD</Label>
          </Pressable>
          <Pressable
            onPress={send}
            disabled={sending}
            style={({ pressed }) => ({
              paddingHorizontal: 18,
              height: 48,
              borderRadius: radius.full,
              borderWidth: 2,
              borderColor: colors.ink,
              backgroundColor: colors.signal,
              alignItems: 'center',
              justifyContent: 'center',
              transform: pressed ? [{ translateX: 1 }, { translateY: 1 }] : [],
            })}>
            {sending ? <ActivityIndicator color={colors.ink} /> : <Label style={{ fontSize: 13 }}>SEND ▶</Label>}
          </Pressable>
        </View>
      ) : (
        // Idle / recording row: live waveform + record-toggle button.
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 12 }}>
          <View style={{ flex: 1, height: 44, justifyContent: 'center' }}>
            {isRecording ? (
              <WaveformVisualizer bars={32} height={44} levels={rec.levels} active />
            ) : (
              <Label muted style={{ fontSize: 12 }}>
                {rec.error ?? 'TAP TO RECORD A VOICE MESSAGE'}
              </Label>
            )}
          </View>
          <Pressable
            onPress={toggleRecord}
            style={({ pressed }) => ({
              width: 56,
              height: 56,
              borderRadius: radius.full,
              borderWidth: 2,
              borderColor: colors.ink,
              backgroundColor: isRecording ? colors.error : colors.signal,
              alignItems: 'center',
              justifyContent: 'center',
              transform: pressed ? [{ translateX: 1 }, { translateY: 1 }] : [],
            })}>
            {isRecording ? (
              <View style={{ width: 20, height: 20, borderRadius: 3, backgroundColor: colors.ink }} />
            ) : (
              <View style={{ width: 24, height: 24, borderRadius: radius.full, borderWidth: 3, borderColor: colors.ink }} />
            )}
          </Pressable>
        </View>
      )}
    </View>
  );
}
