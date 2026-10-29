// Option catalogs + deterministic fake seed profiles (all FAKE, for debugging only).
export const MODES = ['friends', 'gaming', 'dating'];
export const MODE_LABEL = { friends: '🤝 Friends', gaming: '🎮 Gaming', dating: '❤️ Dating' };
// Per-mode distance scopes. radius value is stored in the user's unit (mi for US/GB/LR/MM, else km).
export const DIST_SCOPES = { radius: 'Within radius', city: 'Same city', region: 'Same state / region', country: 'Same country', global: 'Global' };
export const DEFAULT_DIST = { dating: { scope: 'radius', value: 50, unit: 'mi' }, friends: { scope: 'region' }, gaming: { scope: 'global' } };
export const MILE_COUNTRIES = ['US', 'GB', 'LR', 'MM'];
export const unitFor = cc => MILE_COUNTRIES.includes((cc || 'US').toUpperCase()) ? 'mi' : 'km';
export function defaultDist(cc) { const u = unitFor(cc); const d = structuredClone(DEFAULT_DIST); d.dating.unit = u; d.dating.value = u === 'mi' ? 50 : 80; return d; }
export const GAMER_PLATFORMS = ['Xbox', 'PlayStation', 'Nintendo', 'Steam', 'Epic', 'Battle.net', 'Discord', 'Riot', 'EA', 'Ubisoft'];
export const SOCIALS = ['Instagram', 'TikTok', 'X', 'Snapchat', 'YouTube', 'Twitch', 'Kick', 'Reddit', 'Threads', 'Bluesky'];
export const STREAMING = ['Netflix', 'Hulu', 'Disney+', 'Max', 'Prime Video', 'Crunchyroll', 'Twitch', 'YouTube', 'Apple TV+', 'Peacock', 'Paramount+', 'Spotify'];
export const INTERESTS = ['anime', 'football', 'basketball', 'hiking', 'cooking', 'cosplay', 'esports', 'board games', 'music festivals', 'gym', 'reading', 'travel', 'photography', 'coding', 'K-pop', 'horror movies', 'D&D', 'skateboarding', 'art', 'karaoke'];
export const GAMES = ['Halo', 'Fortnite', 'Call of Duty', 'Minecraft', 'Valorant', 'League of Legends', 'Overwatch 2', 'Apex Legends', 'Elden Ring', 'Zelda', 'Smash Bros', 'Animal Crossing', 'FIFA/EA FC', 'Madden', 'Destiny 2', 'World of Warcraft', 'Baldur\'s Gate 3', 'Stardew Valley', 'Rocket League', 'Pokémon'];
export const ANIME = ['One Piece', 'Naruto', 'Attack on Titan', 'Jujutsu Kaisen', 'Demon Slayer', 'Spy x Family', 'Frieren', 'My Hero Academia', 'Chainsaw Man', 'Cowboy Bebop'];
export const SHOWS = ['The Office', 'Stranger Things', 'The Last of Us', 'Arcane', 'Breaking Bad', 'The Bear', 'Severance', 'Euphoria', 'Succession', 'The Boys'];
export const MOVIES = ['Star Wars', 'Interstellar', 'Spider-Verse', 'The Matrix', 'Dune', 'Spirited Away', 'John Wick', 'Barbie', 'Oppenheimer', 'Lord of the Rings'];
export const TEAMS = ['Chicago Bears', 'Kansas City Chiefs', 'Dallas Cowboys', 'Green Bay Packers', 'Chicago Bulls', 'LA Lakers', 'Chicago Cubs', 'NY Yankees', 'Real Madrid', 'Man United', 'T1 (esports)', 'FaZe Clan'];
export const RELIGIONS = ['Agnostic', 'Atheist', 'Christian', 'Catholic', 'Jewish', 'Muslim', 'Hindu', 'Buddhist', 'Spiritual', 'Other', 'Prefer not to say'];
export const GENDERS = ['Man', 'Woman', 'Non-binary', 'Trans man', 'Trans woman', 'Other'];
export const ORIENTATIONS = ['Straight', 'Gay', 'Lesbian', 'Bisexual', 'Pansexual', 'Asexual', 'Queer', 'Questioning'];
export const YNS = ['Never', 'Sometimes', 'Often'];
export const KIDS = ["Don't want", 'Want someday', 'Have kids', 'Open'];
export const POLITICS = ['Liberal', 'Moderate', 'Conservative', 'Apolitical', 'Other'];
export const BUDGETS = ['$0 (free dates)', 'Under $25', '$25–$75', '$75–$150', '$150+'];
export const IMPORTANCE = { 0: 'Irrelevant', 1: 'A little', 10: 'Somewhat', 50: 'Very', 250: 'Mandatory' };

// OkCupid-style weighted questions. Each user stores {answer, accept:[idx...], importance}
export const QUESTIONS = [
  { id: 'q1', text: 'Is it OK to stay up all night gaming on a weeknight?', options: ['Yes', 'No', 'Only on weekends'] },
  { id: 'q2', text: 'How often do you want to talk to a match?', options: ['Every day', 'A few times a week', 'Whenever'] },
  { id: 'q3', text: 'Competitive or casual gamer?', options: ['Competitive', 'Casual', 'Both'] },
  { id: 'q4', text: 'Would you date someone who doesn\'t game at all?', options: ['Yes', 'No', 'Maybe'] },
  { id: 'q5', text: 'Who pays on a first date?', options: ['I do', 'They do', 'Split it', 'Whoever asked'] },
  { id: 'q6', text: 'Voice chat or text chat?', options: ['Voice', 'Text', 'Either'] },
  { id: 'q7', text: 'Is trash talk during games OK?', options: ['Love it', 'Light banter only', 'No'] },
  { id: 'q8', text: 'Do you want a long-term relationship?', options: ['Yes', 'No', 'Not sure'] },
];

// ---- seed generator (deterministic) ----
function rng(seed) { return () => (seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296; }
const FIRST = ['Pixel', 'Neon', 'Byte', 'Glitch', 'Nova', 'Echo', 'Vex', 'Lumen', 'Rook', 'Kira', 'Juno', 'Zed', 'Mochi', 'Blaze', 'Sora', 'Indie', 'Cass', 'Remy', 'Taro', 'Wren', 'Onyx', 'Fable', 'Quill', 'Rue', 'Sage', 'Tox', 'Vale', 'Yuki', 'Ash', 'Bit'];
// [city, region, country name, ISO code, lat, lng] — clusters so local Dating has real matches.
export const CITIES = [
  ['Chicago', 'IL', 'United States', 'US', 41.88, -87.63], ['Evanston', 'IL', 'United States', 'US', 42.05, -87.69], ['Naperville', 'IL', 'United States', 'US', 41.75, -88.15],
  ['Milwaukee', 'WI', 'United States', 'US', 43.04, -87.91], ['Joliet', 'IL', 'United States', 'US', 41.53, -88.08], ['Austin', 'TX', 'United States', 'US', 30.27, -97.74],
  ['Dallas', 'TX', 'United States', 'US', 32.78, -96.8], ['London', 'England', 'United Kingdom', 'GB', 51.51, -0.13], ['Reading', 'England', 'United Kingdom', 'GB', 51.45, -0.97],
  ['Toronto', 'ON', 'Canada', 'CA', 43.65, -79.38], ['Mississauga', 'ON', 'Canada', 'CA', 43.59, -79.64], ['Berlin', 'Berlin', 'Germany', 'DE', 52.52, 13.4],
  ['Tokyo', 'Tokyo', 'Japan', 'JP', 35.68, 139.69], ['Yokohama', 'Kanagawa', 'Japan', 'JP', 35.44, 139.64], ['Sydney', 'NSW', 'Australia', 'AU', -33.87, 151.21],
  ['São Paulo', 'SP', 'Brazil', 'BR', -23.55, -46.63], ['Manila', 'Metro Manila', 'Philippines', 'PH', 14.6, 120.98], ['Mexico City', 'CDMX', 'Mexico', 'MX', 19.43, -99.13],
];
// Mode mix per seed slot: plenty of Dating, all modes covered.
const SEED_MODES = [['dating'], ['friends'], ['gaming'], ['dating', 'gaming'], ['dating', 'friends'], ['dating'], ['friends', 'gaming'], ['dating', 'friends', 'gaming'], ['dating', 'gaming'], ['gaming']];

export function makeSeed() {
  const r = rng(42);
  const pick = a => a[Math.floor(r() * a.length)];
  const some = (a, min, max) => { const n = min + Math.floor(r() * (max - min + 1)); return [...a].sort(() => r() - 0.5).slice(0, n); };
  const out = [];
  for (let i = 0; i < 30; i++) {
    const handle = FIRST[i].toLowerCase() + '_test' + (i + 1);
    const city = i < 12 ? CITIES[i % 5] : CITIES[(i - 7) % CITIES.length]; // first 12 cluster around Chicago
    const modes = SEED_MODES[i % SEED_MODES.length];
    const age = 18 + Math.floor(r() * 30);
    const gamertags = {};
    some(GAMER_PLATFORMS, 1, 4).forEach(p => gamertags[p] = `${FIRST[i]}${p.replace(/\W/g, '')}${100 + i}`);
    const socials = {};
    some(SOCIALS, 0, 3).forEach(s => socials[s] = '@' + handle);
    if (gamertags.Discord) gamertags.Discord = handle; // Discord usernames are lowercase
    const reveal = {}; // per-account privacy: public | match | hidden
    Object.keys(gamertags).forEach(k => reveal['gamertags.' + k] = pick(['public', 'match', 'match']));
    Object.keys(socials).forEach(k => reveal['socials.' + k] = pick(['public', 'match', 'match', 'hidden']));
    const dist = defaultDist(city[3]);
    const platforms = Object.keys(gamertags);
    const answers = {};
    QUESTIONS.forEach(q => {
      const a = Math.floor(r() * q.options.length);
      answers[q.id] = { answer: a, accept: [a, ...some(q.options.map((_, k) => k), 0, 1)].filter((v, k, s) => s.indexOf(v) === k), importance: pick([1, 10, 10, 50, 250]) };
    });
    out.push({
      id: 'seed-' + (i + 1), seed: true,
      name: `${FIRST[i]} (TEST)`, handle, age,
      gender: r() < 0.85 ? pick(GENDERS.slice(0, 3)) : pick(GENDERS), orientation: pick(ORIENTATIONS),
      lookingFor: modes, seekingGenders: i % 2 ? some(GENDERS.slice(0, 3), 2, 3) : GENDERS.slice(0, 5),
      ageMin: 18, ageMax: Math.min(99, age + 10 + Math.floor(r() * 10)),
      city: city[0], region: city[1], country: city[2], countryCode: city[3], location: `${city[0]}, ${city[1]}, ${city[3]}`,
      lat: city[4] + (r() - 0.5) * 0.1, lng: city[5] + (r() - 0.5) * 0.1, distPrefs: dist, reveal, platforms, photos: [], photoReveal: 'match', verified: i % 4 === 0, // verified = preview flag only
      discordInvite: gamertags.Discord && i % 3 === 0 ? 'cybermates-test' + (i + 1) : '',
      religion: pick(RELIGIONS), drinking: pick(YNS), smoking: pick(YNS), kids: pick(KIDS), politics: pick(POLITICS),
      budget: pick(BUDGETS),
      gamertags, socials, streaming: some(STREAMING, 1, 4),
      interests: some(INTERESTS, 2, 5), games: some(GAMES, 1, 5), anime: some(ANIME, 0, 3),
      shows: some(SHOWS, 0, 3), movies: some(MOVIES, 1, 3), teams: some(TEAMS, 0, 2),
      bio: `Fake test profile #${i + 1}. Not a real person. Into ${pick(GAMES)} and ${pick(INTERESTS)}.`,
      answers, avatarHue: Math.floor(r() * 360), createdAt: Date.now() - i * 86400000,
    });
  }
  return out;
}
