// cm-v35: while in a game, press-and-hold never selects text or opens the context/callout menu. Inputs, textareas,
// contenteditable and chat stay fully usable (we never block events that start inside them).
const GAME = '.arc-stage,.arc-pad,.arc-3d,.br-stage,[class^="br-"],.cm-fs-btn';
const TYPABLE = 'input,textarea,select,[contenteditable],[contenteditable] *,.chat,.chat *,.br-say,.br-say *';
export const inGame = t => !!(t?.closest && t.closest(GAME) && !t.closest(TYPABLE));
export function installNoSelect(doc = globalThis.document) { if (!doc || doc.__cmNoSel) return; doc.__cmNoSel = true;
  for (const ev of ['contextmenu', 'selectstart', 'dragstart']) doc.addEventListener(ev, e => { if (inGame(e.target)) e.preventDefault(); }, { capture: true }); }
installNoSelect();
