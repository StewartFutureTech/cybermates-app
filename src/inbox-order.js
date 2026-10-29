// INBOX ORDER. Friends are pinned at the top, newest activity first. Non-friend conversations keep a STABLE position (a new
// ordinary message never reorders them; new conversations join at the end of the section); a BOOSTED message/request moves
// that conversation to the top of the non-friend section, just below the friends. State persists on this device.
export function makeOrder(store = globalThis.localStorage, key = 'cm.convOrder') {
  let st = { order: [], seen: {} }; try { st = { ...st, ...JSON.parse(store?.getItem(key) || '{}') }; } catch {}
  const save = () => { try { store?.setItem(key, JSON.stringify(st)); } catch {} };
  // rows: [{code, friend, at, boostId?}] -> ordered rows
  return { state: () => st, apply(rows) { let dirty = false; const codes = new Set(rows.map(r => r.code));
      for (const r of rows) if (!r.friend && !st.order.includes(r.code)) { st.order.push(r.code); dirty = true; }
      for (const r of rows) if (!r.friend && r.boostId && st.seen[r.code] !== r.boostId) { st.seen[r.code] = r.boostId; st.order = [r.code, ...st.order.filter(c => c !== r.code)]; dirty = true; }
      const before = st.order.length; st.order = st.order.filter(c => codes.has(c) && !rows.find(r => r.code === c)?.friend); if (st.order.length !== before) dirty = true; if (dirty) save();
      const friends = rows.filter(r => r.friend).sort((a, b) => (b.at - a.at) || (a.code < b.code ? -1 : 1)), others = st.order.map(c => rows.find(r => r.code === c)).filter(Boolean);
      return [...friends, ...others]; } };
}
