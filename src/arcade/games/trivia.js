// Trivia Clash (1v1, 2v2, 4v4). LOCAL question bank only (no external API), PG for all ages. Each question every seat
// answers once (simultaneous; moves carry {q, a}); a correct answer scores 1 for the seat's team (+1 bonus for the first
// correct answer on the question). After all seats answered (or the clock — match.js) the next question shows. 10 questions.
export const BANK = [
  ['Which planet is known as the Red Planet?', ['Venus', 'Mars', 'Jupiter', 'Mercury'], 1], ['How many sides does a hexagon have?', ['5', '6', '7', '8'], 1],
  ['What gas do plants absorb from the air?', ['Oxygen', 'Nitrogen', 'Carbon dioxide', 'Helium'], 2], ['Which is the largest ocean?', ['Atlantic', 'Indian', 'Arctic', 'Pacific'], 3],
  ['What is 9 × 7?', ['56', '63', '72', '49'], 1], ['Which animal is the fastest on land?', ['Lion', 'Cheetah', 'Horse', 'Greyhound'], 1],
  ['In computing, what does CPU stand for?', ['Central Processing Unit', 'Core Power Unit', 'Computer Program Utility', 'Central Pixel Unit'], 0], ['Which game features a plumber named Mario?', ['Sonic', 'Zelda', 'Super Mario Bros.', 'Halo'], 2],
  ['What is the freezing point of water in °C?', ['0', '32', '-10', '100'], 0], ['How many players per team on a soccer field?', ['9', '10', '11', '12'], 2],
  ['Which element has the symbol O?', ['Gold', 'Osmium', 'Oxygen', 'Iron'], 2], ['What color do you get mixing blue and yellow?', ['Purple', 'Green', 'Orange', 'Brown'], 1],
  ['Which is the smallest prime number?', ['0', '1', '2', '3'], 2], ['Minecraft blocks are mostly what shape?', ['Spheres', 'Cubes', 'Pyramids', 'Cylinders'], 1],
  ['What is the capital of Japan?', ['Osaka', 'Kyoto', 'Tokyo', 'Seoul'], 2], ['How many continents are there?', ['5', '6', '7', '8'], 2],
  ['Which instrument has 88 keys?', ['Guitar', 'Piano', 'Violin', 'Drum'], 1], ['What does a caterpillar become?', ['Beetle', 'Butterfly', 'Spider', 'Bee'], 1],
  ['Light from the Sun reaches Earth in about…', ['8 seconds', '8 minutes', '8 hours', '8 days'], 1], ['Which shape has three sides?', ['Square', 'Triangle', 'Circle', 'Pentagon'], 1],
  ['What is the hardest natural substance?', ['Gold', 'Iron', 'Diamond', 'Quartz'], 2], ['Pikachu is what type of Pokémon?', ['Fire', 'Water', 'Electric', 'Grass'], 2],
  ['How many minutes are in an hour?', ['30', '60', '90', '100'], 1], ['Which planet has the biggest rings?', ['Saturn', 'Earth', 'Mars', 'Neptune'], 0],
];
export const QN = 10;
export function init({ seats = 2, rng = Math.random } = {}) { const idx = [...BANK.keys()]; for (let i = idx.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [idx[i], idx[j]] = [idx[j], idx[i]]; } return { qs: idx.slice(0, QN), q: 0, seats, ans: {}, score: [0, 0], first: null }; }
export const team = seat => seat % 2;
export const question = st => { const [text, choices] = BANK[st.qs[st.q]]; return { text, choices }; };
export const legal = (st, m, seat) => (st.q >= QN || m?.q !== st.q || seat in st.ans || !(m.a >= 0 && m.a < 4) || seat >= st.seats) ? null : { q: m.q, a: m.a };
export function apply(st, m, seat) { const ans = { ...st.ans, [seat]: m.a }, score = st.score.slice(); let first = st.first; const ok = m.a === BANK[st.qs[st.q]][2];
  if (ok) { score[team(seat)]++; if (first == null) { first = seat; score[team(seat)]++; } }
  if (Object.keys(ans).length >= st.seats) return { ...st, q: st.q + 1, ans: {}, score, first: null }; return { ...st, ans, score, first }; }
export const timeout = st => ({ ...st, q: st.q + 1, ans: {}, first: null }); // clock ran out
export function result(st) { if (st.q < QN) return null; return st.score[0] === st.score[1] ? { draw: true, how: 'tied' } : { winner: st.score[0] > st.score[1] ? 0 : 1, how: `${st.score[0]}-${st.score[1]}` }; }
export function ai(st, seat, rng) { if (seat in st.ans || st.q >= QN) return null; const right = BANK[st.qs[st.q]][2]; return { q: st.q, a: rng() < 0.6 ? right : Math.floor(rng() * 4) }; }
export const turnSeat = st => [...Array(st.seats).keys()].find(s => !(s in st.ans)); // any unanswered seat may move
export const simultaneous = true;
export const meta = { id: 'trivia', name: 'Trivia Clash', modes: ['1v1', '2v2', '4v4'], kind: 'turn' };
