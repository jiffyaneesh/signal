import { Ionicons } from '@expo/vector-icons';
import { useRouter, usePathname } from 'expo-router';
import { useEffect } from 'react';
import { Pressable, Text, View } from 'react-native';

import { useUnreadBadge } from '../hooks/useUnreadBadge';
import { colors, fonts, radius } from '../theme';
import { Headline, Label } from './ui';

// Top app bar with the SIGNAL wordmark and a small route switcher.
// Design forbids a generic bottom nav, so navigation lives up here.
const ROUTES = [
  { href: '/feed' as const, label: 'FEED' },
  { href: '/my-notes' as const, label: 'NOTES' },
  { href: '/profile' as const, label: 'ME' },
];

export default function AppHeader() {
  const router = useRouter();
  const pathname = usePathname();
  const { unreadCount, refresh } = useUnreadBadge();

  // Re-sync the badge on every route change so returning from the Activity
  // screen (which marks all read) drops the count back to 0.
  useEffect(() => { refresh(); }, [pathname, refresh]);

  return (
    <View
      style={{
        borderBottomWidth: 2,
        borderBottomColor: colors.ink,
        backgroundColor: colors.surface,
      }}>
      <View
        style={{
          flexDirection: 'row',
          alignItems: 'center',
          justifyContent: 'space-between',
          paddingHorizontal: 24,
          height: 64,
        }}>
        <Headline style={{ fontSize: 24 }}>SIGNAL</Headline>
        <View style={{ flexDirection: 'row', alignItems: 'center', gap: 18 }}>
          {ROUTES.map((r) => {
            const isActive = pathname === r.href;
            return (
              <Pressable key={r.href} onPress={() => router.navigate(r.href)} hitSlop={8}>
                <Label
                  style={{
                    color: isActive ? colors.ink : colors.onSurfaceVariant,
                    textDecorationLine: isActive ? 'underline' : 'none',
                  }}>
                  {r.label}
                </Label>
              </Pressable>
            );
          })}
          <Pressable
            onPress={() => router.navigate('/search')}
            hitSlop={8}
            accessibilityLabel="Search users"
            style={{ width: 24, height: 24, alignItems: 'center', justifyContent: 'center' }}>
            <Ionicons name="search" size={22} color={colors.ink} />
          </Pressable>
          <Bell count={unreadCount} onPress={() => router.navigate('/notifications')} />
        </View>
      </View>
    </View>
  );
}

// Bell glyph with an unread badge. The badge is a lime pill showing the count
// (capped at 9+); hidden when there's nothing unread.
function Bell({ count, onPress }: { count: number; onPress: () => void }) {
  return (
    <Pressable onPress={onPress} hitSlop={8} accessibilityLabel="Activity" style={{ width: 24, height: 24 }}>
      <Ionicons name={count > 0 ? 'notifications' : 'notifications-outline'} size={22} color={colors.ink} />
      {count > 0 && (
        <View
          style={{
            position: 'absolute',
            top: -6,
            right: -8,
            minWidth: 18,
            height: 18,
            paddingHorizontal: 4,
            borderRadius: radius.full,
            borderWidth: 2,
            borderColor: colors.ink,
            backgroundColor: colors.signal,
            alignItems: 'center',
            justifyContent: 'center',
          }}>
          <Text style={{ fontFamily: fonts.mono, fontSize: 9, color: colors.ink }}>
            {count > 9 ? '9+' : count}
          </Text>
        </View>
      )}
    </Pressable>
  );
}
