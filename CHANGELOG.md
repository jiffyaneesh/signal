# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Changed
- **Messaging & activity screens — richer, faster, more interactive**:
  - **Activity**: added type filter tabs (All / Reactions / Follows / Replies), a per-type icon badge on each actor monogram, the reaction emoji shown large on reaction rows, a live unread count in the header, and selection haptics on tap.
  - **Inbox**: long-press a thread to delete it (confirm modal, optimistic removal), a total-unread count in the header, a lime left rail on unread threads, and selection/impact haptics.
  - **Chat**: day separators (TODAY / YESTERDAY / date) between message groups, a floating "jump to newest" pill while scrolled up, and haptics on record toggle + successful send.
  - **Perf**: all three lists now use `removeClippedSubviews` + tuned `initialNumToRender`/`maxToRenderPerBatch`/`windowSize`, and the row/bubble components are memoized with stable id-based callbacks so realtime refetches and read-receipt patches only re-render what changed.

### Changed (earlier)
- **Bottom tab navigation**: replaced the in-header FEED / NOTES / ME route switcher with an Expo Router bottom tab group (`app/(tabs)/`). Navigation now uses a custom `BrutalTabBar` — a neo-brutalist floating pill bar detached from all screen edges (bottom/left/right margins), with rounded corners, a 2px ink border, and the solid offset shadow. The lime pill slides smoothly between tabs (Reanimated `withTiming` on the measured slot's x/width) and each active tab's text label morphs in from the icon (animated width + opacity). `AppHeader` keeps only the wordmark and utility icons (search/messages/activity). Route URLs (`/feed`, `/my-notes`, `/profile`) are unchanged.

### Added
- **Push notifications (Android)**:
  - Off-device push for reactions, follows, new notes, replies, and direct voice messages via Expo Push (APNs/FCM proxy) — no third-party vendor.
  - New migration `0020_push_notifications.sql`: `push_tokens` table (one row per device, RLS-scoped to the owner), `pg_net`-based AFTER INSERT triggers on `notifications` and `messages` that POST the row to the `push` edge function. Project URL + service-role key read from Supabase Vault (no committed secrets).
  - New `push` Supabase Edge Function: resolves the recipient's device tokens, sends the Expo Push payload in ≤100-message chunks, and prunes `DeviceNotRegistered` tokens from `push_tokens`.
  - Client: `src/lib/push.ts` requests permission, registers the Expo push token, and upserts it; `usePushRegistration` hook registers on auth and deep-links notification taps to the thread / conversation / activity screen. Token is dropped on sign-out.
  - Added `expo-notifications` + `expo-device`; registered the `expo-notifications` config plugin and the Android `default` notification channel.
- **Direct voice messages (1:1 DMs)**:
  - Added private 1:1 voice messaging between users who mutually follow each other.
  - New `MessagesScreen` (`/messages`) lists all direct message threads sorted by last activity, decorated with unread count badges.
  - New `ChatScreen` (`/messages/[id]`) provides a scrollable chat thread using an inverted FlatList. Supports inline voice note recording, previewing, and sending, with read receipts (`✓` for sent, `✓✓` for read).
  - Added new Database Migration `0019_direct_messages.sql` to define `conversations` and `messages` tables, triggers to update conversation timestamps, and RLS policies enforcing mutual-follow constraints.
  - Created `useUnreadMessages` custom hook to track incoming unread DMs in real-time, displaying a badge on the new chat bubble header icon.
  - Delete conversation: a trash action in the chat header removes the thread and all its clips for both participants (ON DELETE CASCADE + a participant-scoped RLS delete policy), behind a confirm modal.
- **GIF Replies in Thread**: Users can now reply to voice notes using GIFs. Adds a "● GIF" button side-by-side with "● AUDIO" reply button at the bottom of `ThreadScreen`.
- **Instagram-Style GIF Search Bottom Sheet**: Custom Giphy search modal opens in a sliding bottom sheet with a drag handle. Supports touch gestures (drag down to dismiss), search queries, and quick tags carousel (CAT, EXCITED, DANCE, etc.). Includes query debouncing (400ms delay) to optimize Giphy API calls and immediate fetch on clearing search or clicking quick tags.
- **GIF support in DB**: Supabase migration `0018_support_gifs.sql` makes `audio_url` nullable and adds `gif_url` to `public.voice_notes`, with a check constraint to ensure each note contains exactly one audio or GIF content.
- **GIF support in Cards**: `ReplyCard` (on `ThreadScreen`) and `UserReplyCard` (on `MyNotesScreen`) now render the selected GIF via `expo-image` when `gif_url` is present, instead of the AudioPlayer.
- **My Notes — REPLIES tab**: Archive screen now has NOTES / REPLIES tabs. The
  REPLIES tab shows the user's own voice replies as compact cards with a lime
  left-border accent and a tappable "↩ REPLY TO @X" context label that opens the
  parent thread.

- **Motion & haptics**:
  - `ConfirmModal` now springs in — the backdrop fades while the card
    zooms/rises with a slight overshoot (reanimated), replacing the flat fade.
  - Reaction pills are tactile: tapping fires a light haptic, bounces the pill
    with a spring, and floats a ghost copy of the emoji up-and-out when the tap
    selects (not deselects) the reaction.

### Changed
- **Deduplicated audio-storage helpers**: `uriToArrayBuffer` /
  `storagePathFromUrl` / `signAudioUrls` were copy-pasted in `notes.ts` and
  `messages.ts`; extracted to a shared `src/lib/audioStorage.ts`.
- **Deduplicated pure helpers + first tests**: `formatDuration` (defined twice)
  and `canonicalPair` moved to `src/lib/format.ts`, with a `node:test` unit
  suite (`npm test`, Node 24 native TS). Covers the m:ss >59s case and
  order-independence of the conversation pair key.

### Fixed
- **Audio resume point clobbered by a quick switch**: `ActiveAudioPlayer` saved
  the live offset on unmount, but a switch before playback advanced saved 0 —
  wiping a real saved position. Now keeps `initialPosition` when playback never
  advanced.
- **Notifications screen blanked on a partial fetch failure**: the initial load
  used `Promise.all`, so a failed unread-count query threw away the notification
  list too. Switched to `Promise.allSettled` — the list renders even if the
  badge count fails, and vice versa.
- **Following feed missed first-time posters live**: the realtime INSERT handler
  gated on "do we already show a note from this author?", which silently dropped
  a followed user's *first* note until a manual refresh. Now gates on the live
  following set (`fetchFollowingIds`).
- **Empty audio URL guard**: `uploadAndPost` / `postReply` / `uploadAndSendMessage`
  now throw if `getPublicUrl` returns an empty URL, rather than inserting a row
  with unplayable audio.
- **Removed dead code**: deleted the unused `EmojiReactionStrip` component
  (reactions are rendered inline by `VoiceNoteCard`).
- **Voice-note duration formatting**: `VoiceNoteCard` hardcoded the minute to 0
  (`0:75` for a 75s clip); now formats as proper `m:ss`, matching the DM fix.
- **DM read receipts now update live**: `ChatScreen` only subscribed to message
  INSERTs, so a sender's `✓` never flipped to `✓✓` until they left and re-entered
  the chat. Added a realtime UPDATE handler that patches the matching bubble's
  read state in place (migration `0019` already replicated UPDATEs for this).
- **Inbox unread counts no longer N+1**: `fetchConversations` ran one head-count
  query per conversation. Replaced with a single query over all the viewer's
  unread rows, tallied per conversation client-side.
- **DM duration formatting**: durations over 59s rendered as `0:75`; now
  formatted as proper `m:ss` via a `formatDuration` helper.
- **DM migration doc references**: comments in `messages.ts`/`types.ts` pointed
  at "migration 0018" (the GIF migration); corrected to `0019`.
- **Giphy debounce timeout type**: `searchTimeoutRef` used `NodeJS.Timeout`
  (Node-only); switched to `ReturnType<typeof setTimeout>` for RN correctness.
- **Crash after posting a reply**: `ReplyRecordScreen` posted then called
  `router.replace('/thread/[id]')`, mounting a *second* `ThreadScreen` on top of
  the one already beneath the modal. Two instances opened a duplicate
  `supabase.channel('thread:<id>')` on the same client, crashing realtime. Now
  calls `router.back()` to dismiss the modal and reveal the existing thread.
- **New reply not appearing live**: the ThreadScreen realtime INSERT handler
  re-fetched with an exclusive `after` cursor (`>`), which skipped the very row
  that fired the event — so a posted reply only showed after reopening the
  thread. `fetchRepliesPage` now accepts an inclusive `since` (`>=`) bound used
  for realtime hydration.
- **Stats overcounting**: `user_note_stats` RPC now counts only top-level
  broadcasts (`parent_note_id IS NULL`), so the NOTES stat card matches the
  actual list length. Previously, voice replies were inflating the count.
  (Migration `0017_fix_stats_exclude_replies.sql`)


  30-second voice clip. Threads are one-level deep.
  - New `ThreadScreen` (route `/thread/[id]`): parent note at top, reply list below
    in conversation order (oldest first), live updates via Supabase realtime.
  - New `ReplyRecordScreen` (route `/thread/[id]/reply`): full-screen record modal,
    same record/preview/post flow as the main RecordScreen.
  - Reply counts shown on every VoiceNoteCard (all four screens: feed, my notes,
    profile, user profile) as a tappable "▶ N REPLIES" label.
  - `'reply'` notification type: note authors receive an activity notification when
    someone replies; tapping it navigates to the thread.
  - DB migration `0016_voice_replies.sql`: `parent_note_id` FK + `reply_count`
    denormalized column on `voice_notes`, triggers for count maintenance and
    notifications, partial index for fast thread fetches.

### Fixed
- Audio notes can be replayed after finishing. The active player now stays
  mounted at the end of a playthrough (instead of unmounting and persisting the
  end offset), so tapping play seeks back to 0 and replays. The covered portion
  of the waveform stays lime while paused/finished, reflecting progress. Also
  memoized play/pause and made autoplay + position-save fire exactly once.

### Added
- Sign-up screen now leads with the voices illustration in a brutalist frame and
  an inviting "JOIN THE SIGNAL" headline, visually distinct from log in.
- Log-in screen redesigned with a lime wordmark block and "WELCOME BACK" copy so
  the two auth modes are unmistakable at a glance.
- Loading spinner shown in place of the play button while audio buffers/loads.

### Changed
- Audio players remember their paused position: pausing a note (or switching to
  another) resumes from where it stopped instead of restarting. Positions reset
  when leaving the screen. Shared across Feed, My Notes, Profile, and user
  profiles via the new `useWindowedPlayback` hook.
