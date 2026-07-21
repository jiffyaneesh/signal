# Changelog

All notable changes to this project are documented here.

## [Unreleased]

### Added
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
