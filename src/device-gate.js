// Device gate: blocks Android emulators from finishing signup and joining P2P.
// Identity is NOT derived from any device hash/fingerprint — this is only a yes/no gate.
// Android native: calls the custom Capacitor plugin `EmulatorCheck` (android/app/src/main/java/com/cybermates/app/EmulatorCheckPlugin.java).
// iOS native: allowed (simulator detection not trivially available from JS; see README gaps).
// Web: allowed, unless the dev toggle localStorage 'cm_sim_emulator' = '1' (or ?simEmulator=1) is set.
export const EMULATOR_MESSAGE = "Cybermates needs a real phone — it looks like you're on an emulator. Please install the app on your own device to finish signing up or join the peer network.";
const SIM_KEY = 'cm_sim_emulator';
const ls = () => globalThis.localStorage;
export const setSimulateEmulator = on => { try { on ? ls().setItem(SIM_KEY, '1') : ls().removeItem(SIM_KEY); } catch {} cached = null; };
export const isSimulatingEmulator = () => { try { return ls()?.getItem(SIM_KEY) === '1' || /[?&]simEmulator=1/.test(globalThis.location?.search || ''); } catch { return false; } };
const platform = cap => cap?.getPlatform?.() || 'web';
let cached = null;
export const resetDeviceGate = () => { cached = null; };
export async function checkDevice({ cap = globalThis.Capacitor } = {}) {
  if (cached) return cached;
  const p = platform(cap);
  let r;
  if (isSimulatingEmulator()) r = { platform: p, isEmulator: true, reasons: ['dev toggle: simulated emulator'] };
  else if (p === 'android' && cap?.isNativePlatform?.()) {
    try {
      const plugin = cap.Plugins?.EmulatorCheck || cap.registerPlugin?.('EmulatorCheck');
      const res = await plugin.check();
      r = { platform: p, isEmulator: !!res?.isEmulator, reasons: res?.reasons || [] };
    } catch (e) { r = { platform: p, isEmulator: false, reasons: ['check unavailable: ' + (e?.message || e)] }; } // fail open
  } else r = { platform: p, isEmulator: false, reasons: [] };
  r.allowed = !r.isEmulator; r.message = r.allowed ? '' : EMULATOR_MESSAGE;
  return (cached = r);
}
export async function assertRealDevice(opts) { const r = await checkDevice(opts); if (!r.allowed) { const e = new Error(r.message); e.code = 'EMULATOR'; e.reasons = r.reasons; throw e; } return r; }
