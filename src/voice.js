// Web Speech API helpers + transcript parsing. Everything degrades to typed input.
export const canSpeak = 'speechSynthesis' in window;
const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
export const canListen = !!SR;

export function speak(text) {
  return new Promise(res => {
    if (!canSpeak) return res();
    speechSynthesis.cancel();
    const u = new SpeechSynthesisUtterance(text); u.rate = 1.02; u.onend = res; u.onerror = res;
    speechSynthesis.speak(u);
  });
}
export function listen() {
  return new Promise((res, rej) => {
    if (!canListen) return rej(new Error('SpeechRecognition not supported'));
    const r = new SR(); r.lang = 'en-US'; r.interimResults = false; r.maxAlternatives = 1;
    r.onresult = e => res(e.results[0][0].transcript); r.onerror = e => rej(new Error(e.error)); r.onnomatch = () => res('');
    r.start();
  });
}

const norm = s => s.toLowerCase().replace(/[^a-z0-9+ ]/g, ' ');
// Find catalog options mentioned in a transcript; unknown comma/"and"-separated items are kept too.
export function parseList(text, options = []) {
  const t = ' ' + norm(text) + ' ';
  const found = [...new Set([...options.filter(o => t.includes(' ' + norm(o).trim() + ' ') || t.includes(norm(o).trim())), ...smartList(text, options)])];
  if (found.length) return found;
  return text.split(/,| and |;/i).map(s => s.trim()).filter(Boolean);
}
export function parseOne(text, options = []) {
  const t = norm(text); const syn = smartList(text, options); if (syn.length === 1) return syn[0];
  return options.find(o => t.includes(norm(o).trim())) || options.find(o => norm(o).split(' ').some(w => w.length > 3 && t.includes(w))) || '';
}
export function parseNumber(text) {
  const words = { eighteen: 18, nineteen: 19, twenty: 20, thirty: 30, forty: 40, fifty: 50, sixty: 60 };
  const m = text.match(/\d+/); if (m) return +m[0];
  let n = 0; norm(text).split(' ').forEach(w => { if (words[w]) n += words[w]; const u = ['', 'one', 'two', 'three', 'four', 'five', 'six', 'seven', 'eight', 'nine'].indexOf(w); if (u > 0) n += u; });
  return n || null;
}
// "my xbox is MasterChief117 and steam is chiefy" -> {Xbox:'MasterChief117', Steam:'chiefy'}
export function parseHandles(text, platforms) {
  const out = {};
  const parts = text.split(/,| and |;/i);
  for (const p of parts) {
    const plat = platforms.find(x => norm(p).includes(norm(x).trim()));
    if (!plat) continue;
    const m = p.match(/(?:is|tag|name|handle|at)\s+@?([\w.#-]+)\s*$/i) || p.match(/@?([\w.#-]+)\s*$/);
    if (m && norm(m[1]).trim() !== norm(plat).trim()) out[plat] = m[1];
  }
  return out;
}

// ---- Smarter scripted parsing: synonyms/slang -> catalog values, and cross-field pickup ----
export const SYNONYMS = {
  'Call of Duty': ['cod', 'warzone', 'call of duty'], 'League of Legends': ['lol', 'league'], 'Overwatch 2': ['overwatch', 'ow2'], 'World of Warcraft': ['wow', 'warcraft'],
  "Baldur's Gate 3": ['bg3', 'baldurs gate', 'baldur'], 'FIFA/EA FC': ['fifa', 'ea fc', 'fc 24', 'fc 25', 'fc 26'], 'Smash Bros': ['smash'], 'Zelda': ['zelda', 'tears of the kingdom', 'breath of the wild'],
  'Pokémon': ['pokemon', 'pokémon'], 'Apex Legends': ['apex'], 'Destiny 2': ['destiny'], 'Rocket League': ['rocket league'], 'Stardew Valley': ['stardew'], 'Elden Ring': ['elden'],
  'PlayStation': ['playstation', 'ps5', 'ps4', 'psn', 'play station'], 'Xbox': ['xbox', 'x box', 'game pass'], 'Nintendo': ['nintendo', 'switch'], 'Steam': ['steam', 'pc', 'computer'], 'Battle.net': ['battle net', 'battlenet', 'blizzard'], 'Riot': ['riot'],
  'Attack on Titan': ['aot', 'attack on titan'], 'Jujutsu Kaisen': ['jjk', 'jujutsu'], 'My Hero Academia': ['mha', 'my hero'], 'Demon Slayer': ['demon slayer'], 'One Piece': ['one piece'],
  'D&D': ['dnd', 'd and d', 'dungeons'], 'K-pop': ['kpop', 'k pop'], 'gym': ['gym', 'lifting', 'working out', 'workout'], 'esports': ['esports', 'e sports', 'competitive'], 'coding': ['coding', 'programming', 'developer'],
  'Disney+': ['disney'], 'Max': ['hbo', 'max'], 'Prime Video': ['prime', 'amazon'], 'Apple TV+': ['apple tv'], 'Paramount+': ['paramount'], 'Crunchyroll': ['crunchyroll', 'crunchy roll'],
  dating: ['dating', 'date', 'relationship', 'love', 'partner', 'girlfriend', 'boyfriend', 'romance'], friends: ['friend', 'friends', 'buddies', 'people to hang', 'hang out'], gaming: ['gaming', 'squad', 'duo', 'teammate', 'play with', 'party up', 'gamer'],
  Man: ['man', 'men', 'guy', 'guys', 'male', 'dude'], Woman: ['woman', 'women', 'girl', 'girls', 'female', 'lady', 'ladies'], 'Non-binary': ['non binary', 'nonbinary', 'enby', 'nb'],
};
const has = (t, w) => new RegExp('(^| )' + norm(w).trim().replace(/[+]/g, '\\+') + '( |$)').test(t);
// Options mentioned in text, via exact name or synonym.
export function smartList(text, options = []) {
  const t = ' ' + norm(text).replace(/\s+/g, ' ') + ' ';
  return options.filter(o => has(t, o) || (SYNONYMS[o] || []).some(w => has(t, w)));
}
// Pick up answers for OTHER list fields from one sentence ("I play Halo on Xbox" -> games + platforms).
export function crossPick(text, fields) {
  const out = {};
  for (const f of fields) { const hit = smartList(text, f.o); if (hit.length) out[f.k] = hit; }
  return out;
}
