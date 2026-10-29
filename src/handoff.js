// Handoff hub: Cybermates holds your tags/socials and hands off to the real platform. No APIs, no keys — just links + copy.
const clean = h => String(h || '').trim().replace(/^@/, '');
const enc = h => encodeURIComponent(clean(h));
const URLS = {
  Steam: h => `https://steamcommunity.com/id/${enc(h)}`,
  Xbox: h => `https://account.xbox.com/en-us/profile?gamertag=${enc(h)}`,
  PlayStation: h => `https://profile.playstation.com/${enc(h)}`,
  Instagram: h => `https://instagram.com/${enc(h)}`,
  TikTok: h => `https://www.tiktok.com/@${enc(h)}`,
  X: h => `https://x.com/${enc(h)}`,
  Snapchat: h => `https://www.snapchat.com/add/${enc(h)}`,
  YouTube: h => `https://www.youtube.com/@${enc(h)}`,
  Twitch: h => `https://www.twitch.tv/${enc(h)}`,
  Kick: h => `https://kick.com/${enc(h)}`,
  Reddit: h => `https://www.reddit.com/user/${enc(h)}`,
  Threads: h => `https://www.threads.net/@${enc(h)}`,
  Bluesky: h => `https://bsky.app/profile/${clean(h).includes('.') ? enc(h) : enc(h) + '.bsky.social'}`,
  // Discord has no username URL: copy username, then open Add Friend.
  Discord: () => 'https://discord.com/channels/@me',
};
// Copy-only platforms (no public profile URL by name): Nintendo friend code, Epic, Battle.net, Riot ID, EA, Ubisoft.
export const HOW_TO = {
  Discord: 'Username copied. In Discord: Friends → Add Friend → paste.',
  Nintendo: 'Friend code copied. Switch: Add Friend → Search with Friend Code.',
  Epic: 'Epic name copied. Epic launcher: Friends → Add Friend.',
  'Battle.net': 'BattleTag copied. Battle.net: Add Friend.',
  Riot: 'Riot ID copied. Riot client: Add Friend → paste name#tag.',
  EA: 'EA ID copied. EA app: Friends → Add.',
  Ubisoft: 'Ubisoft name copied. Ubisoft Connect: Friends → Add.',
};
export const linkFor = (platform, handle) => URLS[platform]?.(handle) || null;
export const inviteUrl = code => code ? (/^https?:/.test(code) ? code : `https://discord.gg/${enc(code)}`) : null;

// Which accounts of `owner` can `viewer` see? reveal: public | match (default) | hidden.
export function visibleAccounts(owner, { isSelf = false, mutual = false } = {}) {
  const out = [];
  for (const kind of ['gamertags', 'socials']) for (const [platform, handle] of Object.entries(owner[kind] || {})) {
    if (!handle) continue;
    const level = owner.reveal?.[`${kind}.${platform}`] || 'match';
    const shown = isSelf || level === 'public' || (level === 'match' && mutual);
    out.push({ kind, platform, handle, level, shown });
  }
  return out;
}
// Mutual match = both people have sent each other at least one message.
export const isMutual = (msgs, a, b) => msgs.some(m => m.from === a && m.to === b) && msgs.some(m => m.from === b && m.to === a);

export function cardText(p, accounts) {
  return `${p.name} on Cybermates\n` + accounts.filter(a => a.shown).map(a => `${a.platform}: ${a.handle}${linkFor(a.platform, a.handle) && a.platform !== 'Discord' ? ' — ' + linkFor(a.platform, a.handle) : ''}`).join('\n') + (p.discordInvite ? `\nDiscord server: ${inviteUrl(p.discordInvite)}` : '');
}
export async function copy(text) { try { await navigator.clipboard.writeText(text); return true; } catch { prompt('Copy this:', text); return false; } }
