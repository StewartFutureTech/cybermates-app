// Optional sign-in wiring (src/signin.js): backend registered on sign-in, mesh code linked to uid, age-band mismatch refused,
// queued reports flushed with resolved uid, no sign-in => mesh-only (no backend).
const mem = {}; globalThis.localStorage = { getItem: k => mem[k] ?? null, setItem: (k, v) => { mem[k] = String(v); }, removeItem: k => { delete mem[k]; } };
const KV = await import('../src/kv-store.js'); const S = await import('../src/signin.js'); const C = await import('../src/compliance.js');
let fails = 0; const assert = (c, m) => { console.log((c ? 'ok ' : 'FAIL ') + m); if (!c) fails++; };
const UID = '11111111-2222-4333-8444-555555555555', PEER = '99999999-2222-4333-8444-555555555555';
const fake = (band) => { const st = { reports: [], links: [], out: 0 }; return { st, auth: { userId: async () => UID, signOut: async () => { st.out++; } },
  store: { getProfile: async () => (band ? { id: UID, age_band: band } : null), upsertProfile: async p => ({ id: UID, ...p }), report: async r => { st.reports.push(r); return { id: 'r' + st.reports.length }; } },
  client: { from: () => ({ upsert: async row => { st.links.push(row); return {}; } }), rpc: async (fn, a) => ({ data: fn === 'resolve_mesh_code' && a.p_code === 'PEERCODE' ? PEER : null }) } }; };
assert(!S.signedIn() && !KV.supabaseBackend(), 'no sign-in: mesh-only (no backend registered)');
const q = await C.submitReport({ reporter: 'MYCODE', reported: 'PEERCODE', reason: 'harassment' }); assert(q.queued, 'signed out: report queued on device');
const bad = fake('adult'); const r0 = await S.activate(bad, { localMinor: true, codes: ['MYCODE'] });
assert(!r0.ok && r0.reason === 'age-band-mismatch' && bad.st.out === 1 && !KV.supabaseBackend(), 'minor device + adult account: refused, signed out');
const be = fake('minor'); const r1 = await S.activate(be, { localMinor: true, codes: ['MYCODE'] });
assert(r1.ok && KV.supabaseBackend() === be, 'sign-in registers backend via useSupabaseBackend()');
assert(be.st.links.some(l => l.code === 'MYCODE' && l.user_id === UID) && (await S.linkedUid('MYCODE')) === UID, 'mesh identity linked to Supabase uid');
assert(be.st.reports.length === 1 && be.st.reports[0].reported === PEER, 'queued report flushed with resolved reported uid');
const r2 = await C.submitReport({ reporter: 'MYCODE', reported: 'PEERCODE', reason: 'spam/scam' }); assert(r2.ok && !r2.queued && be.st.reports[1].reported === PEER, 'signed in: report carries reported user id');
await S.signOut(); assert(!KV.supabaseBackend(), 'sign-out: back to mesh-only');
// new account (no server age_band): submit_age_check(birthdate) during sign-in
const yrs = n => { const d = new Date(); d.setFullYear(d.getFullYear() - n); d.setDate(d.getDate() - 2); return d.toISOString().slice(0, 10); };
const fresh = (srv = d => (S.bandFromDob(d))) => { const f = fake(null); f.st.sub = []; f.store.submitAgeCheck = async d => { f.st.sub.push(d); const r = srv(d); if (r instanceof Error) throw r; return r; }; return f; };
let f = fresh(); let r = await S.activate(f, { localMinor: false, codes: ['MYCODE'], birthdate: yrs(30) });
assert(r.ok && r.band === 'adult' && f.st.sub.length === 1 && f.st.sub[0] === yrs(30) && KV.supabaseBackend() === f, 'new account: birth date from the device age check sent to submit_age_check, band set');
await S.signOut();
f = fresh(); r = await S.activate(f, { localMinor: true, codes: ['MYCODE'] });
assert(!r.ok && r.reason === 'need-birthdate' && f.st.out === 0 && !KV.supabaseBackend() && f.st.sub.length === 0, 'flag only (no date): asks for the birth date, nothing sent, not activated');
r = await S.activate(f, { localMinor: true, codes: ['MYCODE'], birthdate: yrs(15) });
assert(r.ok && r.band === 'minor' && f.st.sub.length === 1, 'birth date entered once: minor band set');
await S.signOut();
f = fresh(); r = await S.activate(f, { localMinor: true, birthdate: yrs(30) });
assert(!r.ok && r.reason === 'age-band-mismatch' && f.st.sub.length === 0 && f.st.out === 1, 'entered date disagrees with device flag: signed out, nothing sent');
f = fresh(() => 'adult'); r = await S.activate(f, { localMinor: true, birthdate: yrs(15) });
assert(!r.ok && r.reason === 'age-band-mismatch' && f.st.out === 1 && !KV.supabaseBackend(), 'server band disagrees with device flag: signed out');
f = fresh(() => new Error('under 13 not permitted')); r = await S.activate(f, { localMinor: true, birthdate: yrs(15) });
assert(!r.ok && r.reason === 'under-13' && f.st.out === 1, 'server refuses: signed out');
assert(!JSON.stringify(mem).includes(yrs(30)) && !JSON.stringify(mem).includes(yrs(15)), 'birth date never stored on the device');
console.log(fails ? 'SIGNIN: FAIL' : 'SIGNIN: ALL OK'); process.exit(fails ? 1 : 0);
