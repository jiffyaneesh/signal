import { Ionicons } from '@expo/vector-icons';
import { useRouter } from 'expo-router';
import { useEffect, useRef } from 'react';
import { Animated, FlatList, Keyboard, Pressable, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, Chip, Display, IconButton, Label, Monogram } from '../components/ui';
import { useUserSearch } from '../hooks/useUserSearch';
import { colors, fonts, iosFocusShadow, radius, space } from '../theme';
import type { SearchUser } from '../types';

// Find people by username. A debounced prefix search (server-side RPC) backs a
// live results list; stale responses are discarded in the hook. Loading shows
// shimmer skeletons, results animate in, and each row carries an inline follow
// control. Design: brutalist — 2px ink, one lime accent (the focused field +
// active follow chips).
export default function SearchScreen() {
  const router = useRouter();
  const { query, setQuery, results, status, error, pendingIds, toggleFollow } = useUserSearch();

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      {/* Top bar: back + search field. */}
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
        <SearchField value={query} onChange={setQuery} onClear={() => setQuery('')} />
      </View>

      <FlatList
        data={status === 'results' ? results : []}
        keyExtractor={(item) => item.id}
        keyboardShouldPersistTaps="handled"
        onScrollBeginDrag={Keyboard.dismiss}
        contentContainerStyle={{ padding: space.containerPadding, gap: 12, paddingBottom: 48, flexGrow: 1 }}
        ListHeaderComponent={
          status === 'results' ? (
            <Label muted style={{ marginBottom: 12 }}>
              {results.length} {results.length === 1 ? 'MATCH' : 'MATCHES'}
            </Label>
          ) : null
        }
        ListEmptyComponent={
          <ListBody status={status} query={query} error={error} />
        }
        renderItem={({ item, index }) => (
          <ResultRow
            user={item}
            index={index}
            pending={pendingIds.has(item.id)}
            onPress={() => {
              Keyboard.dismiss();
              router.push({ pathname: '/user/[id]', params: { id: item.id } });
            }}
            onToggle={() => toggleFollow(item)}
          />
        )}
      />
    </SafeAreaView>
  );
}

// The brutalist search field: leading magnifier, mono input, trailing clear
// button. Autofocuses on mount (this screen exists to type). Gains the ink
// offset shadow on focus, matching TextField.
function SearchField({
  value,
  onChange,
  onClear,
}: {
  value: string;
  onChange: (v: string) => void;
  onClear: () => void;
}) {
  const inputRef = useRef<TextInput>(null);

  // Autofocus after mount so the keyboard rises with the screen.
  useEffect(() => {
    const t = setTimeout(() => inputRef.current?.focus(), 250);
    return () => clearTimeout(t);
  }, []);

  return (
    <View
      collapsable={false}
      style={[
        {
          flex: 1,
          flexDirection: 'row',
          alignItems: 'center',
          gap: 10,
          height: 48,
          borderWidth: 2,
          borderColor: colors.ink,
          borderRadius: radius.md,
          backgroundColor: colors.canvas,
          paddingHorizontal: 14,
        },
        value.length > 0 ? iosFocusShadow : null,
      ]}>
      <Ionicons name="search" size={18} color={colors.ink} />
      <TextInput
        ref={inputRef}
        value={value}
        onChangeText={onChange}
        placeholder="SEARCH USERS"
        placeholderTextColor={colors.onSurfaceVariant}
        autoCapitalize="none"
        autoCorrect={false}
        returnKeyType="search"
        style={{
          flex: 1,
          fontFamily: fonts.mono,
          fontSize: 14,
          letterSpacing: 1,
          color: colors.ink,
          paddingVertical: 0,
        }}
      />
      {value.length > 0 && (
        <Pressable onPress={onClear} hitSlop={10} accessibilityLabel="Clear search">
          <Ionicons name="close-circle" size={20} color={colors.onSurfaceVariant} />
        </Pressable>
      )}
    </View>
  );
}

// Non-list body: whatever fills the space when there are no result rows.
// Loading → shimmer skeletons; idle/empty/error → a centered message.
function ListBody({
  status,
  query,
  error,
}: {
  status: ReturnType<typeof useUserSearch>['status'];
  query: string;
  error: string | null;
}) {
  if (status === 'loading') return <SkeletonList />;

  if (status === 'error') {
    return (
      <Center>
        <Display style={{ textAlign: 'center', fontSize: 40 }}>OFFLINE?</Display>
        <Body muted style={{ fontSize: 17, textAlign: 'center' }}>
          {error ?? 'Search failed. Try again.'}
        </Body>
      </Center>
    );
  }

  if (status === 'empty') {
    return (
      <Center>
        <Display style={{ textAlign: 'center', fontSize: 40 }}>NO ONE.</Display>
        <Body muted style={{ fontSize: 17, textAlign: 'center' }}>
          No user matches “{query.trim()}”.
        </Body>
      </Center>
    );
  }

  // idle
  return (
    <Center>
      <Display style={{ textAlign: 'center', fontSize: 40 }}>FIND{'\n'}VOICES.</Display>
      <Body muted style={{ fontSize: 17, textAlign: 'center' }}>
        Type a username to search.
      </Body>
    </Center>
  );
}

function Center({ children }: { children: React.ReactNode }) {
  return (
    <View style={{ flex: 1, gap: 16, alignItems: 'center', justifyContent: 'center', paddingTop: 48 }}>
      {children}
    </View>
  );
}

// A single search result: monogram + username (tap → profile) with an inline
// follow chip. Fades + slides up on mount, staggered by list index for a
// cascading reveal. Reuses the FollowRow visual language.
function ResultRow({
  user,
  index,
  pending,
  onPress,
  onToggle,
}: {
  user: SearchUser;
  index: number;
  pending: boolean;
  onPress: () => void;
  onToggle: () => void;
}) {
  const anim = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.timing(anim, {
      toValue: 1,
      duration: 260,
      delay: Math.min(index, 8) * 40, // cap the stagger so late rows aren't slow
      useNativeDriver: true,
    }).start();
  }, [anim, index]);

  return (
    <Animated.View
      style={{
        opacity: anim,
        transform: [{ translateY: anim.interpolate({ inputRange: [0, 1], outputRange: [12, 0] }) }],
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          gap: 14,
          borderWidth: 2,
          borderColor: colors.ink,
          borderRadius: radius.lg,
          backgroundColor: colors.canvas,
          paddingVertical: 14,
          paddingHorizontal: 16,
        }}>
        <Pressable
          onPress={onPress}
          style={{ flexDirection: 'row', alignItems: 'center', gap: 14, flex: 1 }}>
          <Monogram name={user.username} size={44} filled={user.isFollowing} />
          <Body style={{ fontSize: 18, textTransform: 'uppercase', flex: 1 }} numberOfLines={1}>
            {user.username}
          </Body>
        </Pressable>

        <Chip
          label={pending ? '…' : user.isFollowing ? '✓ FOLLOWING' : '+ FOLLOW'}
          filled={user.isFollowing}
          onPress={pending ? undefined : onToggle}
        />
      </View>
    </Animated.View>
  );
}

// ─────────────────────────────────────────────────────────────
// Loading skeletons — shimmering placeholder rows
// ─────────────────────────────────────────────────────────────

function SkeletonList() {
  const shimmer = useRef(new Animated.Value(0)).current;

  // One shared opacity pulse drives all skeleton rows (cheap, native-driver).
  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(shimmer, { toValue: 1, duration: 650, useNativeDriver: true }),
        Animated.timing(shimmer, { toValue: 0, duration: 650, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [shimmer]);

  const opacity = shimmer.interpolate({ inputRange: [0, 1], outputRange: [0.45, 1] });

  return (
    <View style={{ gap: 12 }}>
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonRow key={i} opacity={opacity} widthPct={70 - (i % 3) * 12} />
      ))}
    </View>
  );
}

function SkeletonRow({ opacity, widthPct }: { opacity: Animated.AnimatedInterpolation<number>; widthPct: number }) {
  return (
    <View
      style={{
        flexDirection: 'row',
        alignItems: 'center',
        gap: 14,
        borderWidth: 2,
        borderColor: colors.outlineVariant,
        borderRadius: radius.lg,
        backgroundColor: colors.canvas,
        paddingVertical: 14,
        paddingHorizontal: 16,
      }}>
      <Animated.View
        style={{
          opacity,
          width: 44,
          height: 44,
          borderRadius: radius.md,
          backgroundColor: colors.surfaceContainerHigh,
        }}
      />
      <Animated.View
        style={{
          opacity,
          height: 16,
          width: `${widthPct}%`,
          borderRadius: radius.full,
          backgroundColor: colors.surfaceContainerHigh,
        }}
      />
    </View>
  );
}
