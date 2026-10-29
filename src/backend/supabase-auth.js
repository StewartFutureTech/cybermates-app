// Supabase Auth: email OTP (6-digit code) or magic link, plus anonymous -> linked upgrade.
// The device-key vault (src/vault.js / src/e2e.js) remains the E2E identity: Auth only proves account ownership;
// we publish the vault's PUBLIC box key (xpub) to profiles.e2e_pubkey. Secret keys never leave the device.
import { AUTH_REDIRECT } from './supabase-config.js';
import { unwrap } from './supabase-client.js';
export class SupabaseAuth {
  constructor(client) { this.c = client; }
  async session() { return unwrap(await this.c.auth.getSession()).session; }
  async userId() { return (await this.session())?.user?.id || null; }
  isAnonymous(s) { return !!s?.user?.is_anonymous; }
  // 1) passwordless: sends a magic link AND a 6-digit code (template must include {{ .Token }} for the code path)
  sendEmailOtp(email, { createUser = true } = {}) { return this.c.auth.signInWithOtp({ email, options: { shouldCreateUser: createUser, emailRedirectTo: AUTH_REDIRECT } }).then(unwrap); }
  verifyEmailOtp(email, token) { return this.c.auth.verifyOtp({ email, token, type: 'email' }).then(unwrap); }
  // 2) guest first (requires Auth > Anonymous sign-ins enabled), upgrade later without losing rows (same user id)
  signInAnonymously() { return this.c.auth.signInAnonymously().then(unwrap); }
  linkEmail(email) { return this.c.auth.updateUser({ email }, { emailRedirectTo: AUTH_REDIRECT }).then(unwrap); } // confirms via email; uid unchanged
  verifyLinkOtp(email, token) { return this.c.auth.verifyOtp({ email, token, type: 'email_change' }).then(unwrap); }
  signInWithPassword(email, password) { return this.c.auth.signInWithPassword({ email, password }).then(unwrap); } // tests/admin only
  signOut() { return this.c.auth.signOut().then(unwrap); }
  onChange(fn) { const { data } = this.c.auth.onAuthStateChange((ev, s) => fn(ev, s)); return () => data.subscription.unsubscribe(); }
  // bind the device vault's public E2E key to this account
  async publishDeviceKey(xpub) {
    const uid = await this.userId(); if (!uid) throw new Error('not signed in');
    return unwrap(await this.c.from('profiles').upsert({ id: uid, e2e_pubkey: xpub }, { onConflict: 'id' }).select('id,e2e_pubkey').single());
  }
}
