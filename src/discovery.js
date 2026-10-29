// Mode-filtered discovery + under-18 dating gate (pure, shared by UI and mesh glue).
//  - Discovery queries/answers carry a mode tag ('friends'|'gaming'|'dating'); a phone only answers a query for a mode it
//    has enabled, and only processes profile vectors whose modes include the current Discover mode.
//  - Under 18 (setup age, self-reported): Dating tab not rendered, 'dating' is stripped from published modes, dating
//    queries are never sent or answered; adults' dating discovery drops profiles flagged under 18.
export const ALL_MODES = ['friends', 'gaming', 'dating'];
export const isMinor = p => !!p && (p.minor === true || (p.age != null && p.age !== '' && Number(p.age) < 18));
export const visibleModes = (me, modes = ALL_MODES) => isMinor(me) ? modes.filter(m => m !== 'dating') : modes; // Dating tab absent for minors
export const myModes = me => visibleModes(me, (me?.lookingFor || []).filter(m => ALL_MODES.includes(m)));
// Published (mesh) profile: minors never broadcast dating mode or dating-only fields.
export function publishProfile(me, pub) { const o = { ...pub }; if (isMinor(me)) { o.lookingFor = (o.lookingFor || []).filter(m => m !== 'dating'); o.minor = true; delete o.seekingGenders; delete o.ageRange; } return o; }
export const canQuery = (me, mode) => ALL_MODES.includes(mode) && visibleModes(me).includes(mode);
export const discQuery = (me, mode) => canQuery(me, mode) ? { mode } : null;
export const shouldAnswer = (me, q) => !!q && myModes(me).includes(q.mode) && !(q.mode === 'dating' && isMinor(me));
// Process a peer's profile vector for `mode`? (peer modes must include it; dating excludes minors on either side)
export function acceptVector(me, mode, peer) {
  if (!mode || !peer) return false; if (!(peer.lookingFor || []).includes(mode)) return false;
  if (mode === 'dating' && (isMinor(me) || isMinor(peer))) return false; return true;
}
export const filterForMode = (me, mode, profiles, get = x => x) => profiles.filter(x => acceptVector(me, mode, get(x)));
