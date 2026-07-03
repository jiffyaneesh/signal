import { useRouter } from 'expo-router';
import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { Body, ConfirmModal, Headline, IconButton, Label, Rule, SecondaryButton, TextField } from '../components/ui';
import { useAuth } from '../context/AuthContext';
import { deleteOwnAccount, updatePassword, updateUsername } from '../lib/account';
import { colors, space } from '../theme';

// Account settings: change username, change password, log out, delete account.
// Each section is self-contained with its own inline status. Layout follows the
// local-topbar pattern from FollowListScreen / UserProfileScreen.
export default function SettingsScreen() {
  const router = useRouter();
  const { user, profile, refreshProfile, signOut } = useAuth();

  // Username
  const [username, setUsername] = useState(profile?.username ?? '');
  const [savingName, setSavingName] = useState(false);
  const [nameMsg, setNameMsg] = useState<string | null>(null);
  const [nameErr, setNameErr] = useState<string | null>(null);

  // Password
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [savingPw, setSavingPw] = useState(false);
  const [pwMsg, setPwMsg] = useState<string | null>(null);
  const [pwErr, setPwErr] = useState<string | null>(null);

  // Delete
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);

  const nameChanged = username.trim() !== (profile?.username ?? '') && username.trim().length >= 3;

  async function saveUsername() {
    setNameMsg(null);
    setNameErr(null);
    setSavingName(true);
    try {
      await updateUsername(user!.id, username);
      await refreshProfile();
      setNameMsg('Username updated.');
    } catch (e: unknown) {
      setNameErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingName(false);
    }
  }

  async function savePassword() {
    setPwMsg(null);
    setPwErr(null);
    if (pw !== pw2) {
      setPwErr('Passwords do not match.');
      return;
    }
    setSavingPw(true);
    try {
      await updatePassword(pw);
      setPw('');
      setPw2('');
      setPwMsg('Password updated.');
    } catch (e: unknown) {
      setPwErr(e instanceof Error ? e.message : String(e));
    } finally {
      setSavingPw(false);
    }
  }

  async function confirmDeleteAccount() {
    setDeleteErr(null);
    setDeleting(true);
    try {
      await deleteOwnAccount();
      // Sign out — AuthContext flips the navigator back to onboarding.
      await signOut();
    } catch (e: unknown) {
      setDeleteErr(e instanceof Error ? e.message : String(e));
      setDeleting(false);
      setConfirmDelete(false);
    }
  }

  return (
    <SafeAreaView style={{ flex: 1, backgroundColor: colors.surface }} edges={['top']}>
      {/* Top bar: back + title. */}
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
        <Label muted>SETTINGS</Label>
      </View>

      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={{ flex: 1 }}>
        <ScrollView
          contentContainerStyle={{ padding: space.containerPadding, gap: space.sectionMargin, paddingBottom: 64 }}
          keyboardShouldPersistTaps="handled">
          {/* USERNAME */}
          <View style={{ gap: 16 }}>
            <Headline style={{ fontSize: 22 }}>USERNAME</Headline>
            <TextField
              placeholder="USERNAME"
              value={username}
              onChangeText={(t) => { setUsername(t); setNameMsg(null); setNameErr(null); }}
              autoCapitalize="none"
              autoCorrect={false}
              maxLength={20}
            />
            {nameErr && <Body style={{ color: colors.error }}>{nameErr}</Body>}
            {nameMsg && <Body muted>{nameMsg}</Body>}
            <SecondaryButton
              label={savingName ? 'SAVING…' : 'SAVE USERNAME'}
              onPress={saveUsername}
              disabled={savingName || !nameChanged}
            />
          </View>

          <Rule />

          {/* PASSWORD */}
          <View style={{ gap: 16 }}>
            <Headline style={{ fontSize: 22 }}>PASSWORD</Headline>
            <TextField
              placeholder="NEW PASSWORD"
              value={pw}
              onChangeText={(t) => { setPw(t); setPwMsg(null); setPwErr(null); }}
              secureTextEntry
              autoCapitalize="none"
            />
            <TextField
              placeholder="CONFIRM PASSWORD"
              value={pw2}
              onChangeText={(t) => { setPw2(t); setPwMsg(null); setPwErr(null); }}
              secureTextEntry
              autoCapitalize="none"
            />
            {pwErr && <Body style={{ color: colors.error }}>{pwErr}</Body>}
            {pwMsg && <Body muted>{pwMsg}</Body>}
            <SecondaryButton
              label={savingPw ? 'UPDATING…' : 'UPDATE PASSWORD'}
              onPress={savePassword}
              disabled={savingPw || pw.length === 0}
            />
          </View>

          <Rule />

          {/* SESSION */}
          <View style={{ gap: 16 }}>
            <Headline style={{ fontSize: 22 }}>SESSION</Headline>
            <SecondaryButton label="LOG OUT" onPress={signOut} />
          </View>

          <Rule />

          {/* DANGER ZONE */}
          <View style={{ gap: 16 }}>
            <Headline style={{ fontSize: 22, color: colors.error }}>DANGER ZONE</Headline>
            <Body muted>
              Deleting your account is permanent. Your notes, reactions, follows, and
              activity are removed and cannot be recovered.
            </Body>
            {deleteErr && <Body style={{ color: colors.error }}>{deleteErr}</Body>}
            <SecondaryButton
              label={deleting ? 'DELETING…' : 'DELETE ACCOUNT'}
              onPress={() => setConfirmDelete(true)}
              disabled={deleting}
              style={{ backgroundColor: colors.errorContainer }}
            />
          </View>
        </ScrollView>
      </KeyboardAvoidingView>

      <ConfirmModal
        visible={confirmDelete}
        title="DELETE ACCOUNT?"
        message="This permanently removes your account and everything you've posted. This cannot be undone."
        confirmLabel="DELETE FOREVER"
        cancelLabel="CANCEL"
        tone="danger"
        busy={deleting}
        onConfirm={confirmDeleteAccount}
        onCancel={() => setConfirmDelete(false)}
      />
    </SafeAreaView>
  );
}
