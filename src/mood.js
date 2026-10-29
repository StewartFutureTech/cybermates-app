// Temporary MOOD feature. Session-only: kept in MEMORY (this module), never persisted locally or in Supabase.
// It rides in the signed presence row (membership row field `mood`), so it lives in the server super list only while the
// presence row lives (expires with presence; cleared on logoff/offline). Fixed list only: no custom text (no moderation).
export const MOODS = [
  { id: 'gaming', label: 'Gaming', icon: '🎮' }, { id: 'movie-night', label: 'Movie night', icon: '🍿' }, { id: 'date-night', label: 'Date night', icon: '💘', adult: true },
  { id: 'chill', label: 'Chill', icon: '🧊' }, { id: 'annoyed', label: 'Annoyed', icon: '😤' }, { id: 'snack-goblin', label: 'Snack goblin', icon: '🧌' },
  { id: 'main-character', label: 'Main character energy', icon: '🌟' }, { id: 'touch-grass', label: 'Touch grass later', icon: '🌱' }, { id: 'chaos', label: 'Here for chaos', icon: '🌀' }, { id: 'npc', label: 'NPC mode', icon: '🤖' },
];
export const MOOD_IDS = new Set(MOODS.map(m => m.id));
export const validMood = id => id == null || MOOD_IDS.has(id);
export const moodsFor = minor => MOODS.filter(m => !(m.adult && minor));
export const moodOf = id => MOODS.find(m => m.id === id) || null;
let current = null, askedThisSession = false;
export const getMood = () => current;
export function setMood(id, { minor = false } = {}) { if (id != null && (!MOOD_IDS.has(id) || (minor && moodOf(id).adult))) throw new Error('mood not allowed'); current = id; return current; }
export const clearMood = () => { current = null; };
export const shouldAsk = () => !askedThisSession && (askedThisSession = true);
export const badge = id => { const m = moodOf(id); return m ? `<span class="mood-badge" data-mood="${m.id}" aria-label="Mood: ${m.label}">${m.icon} ${m.label}</span>` : ''; };
