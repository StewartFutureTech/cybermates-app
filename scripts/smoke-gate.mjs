// Device gate smoke (imported by smoke.mjs; relies on its localStorage shim).
import * as G from '../src/device-gate.js';
import * as P from '../src/p2p.js';
const assert = (c, m) => { if (!c) { console.error('FAIL', m); process.exit(1); } console.log('ok', m); };
const android = res => ({ getPlatform: () => 'android', isNativePlatform: () => true, Plugins: { EmulatorCheck: { check: async () => res } } });
G.setSimulateEmulator(false);
assert((await G.checkDevice({ cap: undefined })).allowed, 'web: allowed');
G.resetDeviceGate(); assert((await G.checkDevice({ cap: android({ isEmulator: false, reasons: [] }) })).allowed, 'android real device: allowed');
G.resetDeviceGate(); { const r = await G.checkDevice({ cap: android({ isEmulator: true, reasons: ['ro.kernel.qemu=1'] }) }); assert(!r.allowed && r.message === G.EMULATOR_MESSAGE && r.reasons[0] === 'ro.kernel.qemu=1', 'android emulator: blocked with reasons'); }
G.resetDeviceGate(); assert((await G.checkDevice({ cap: { getPlatform: () => 'android', isNativePlatform: () => true, Plugins: {} } })).allowed, 'android plugin missing: fails open');
G.resetDeviceGate(); assert((await G.checkDevice({ cap: { getPlatform: () => 'ios', isNativePlatform: () => true } })).allowed, 'ios: allowed');
G.setSimulateEmulator(true); assert(!(await G.checkDevice({ cap: undefined })).allowed, 'web dev toggle: simulated emulator blocked');
{ let err; try { await G.assertRealDevice(); } catch (e) { err = e; } assert(err?.code === 'EMULATOR', 'assertRealDevice throws EMULATOR'); }
{ const t = { onControl() {}, fetchRecord: async () => null, join: async () => { throw new Error('should not reach'); }, leave: async () => {} };
  P.giveConsent('gate-u'); const n = new P.P2P({ transport: t, userId: 'gate-u' }); let err; try { await n.join(); } catch (e) { err = e; }
  assert(err?.message === G.EMULATOR_MESSAGE && !n.joined, 'p2p join blocked on emulator'); P.revokeConsent(); }
G.setSimulateEmulator(false); assert((await G.checkDevice()).allowed, 'toggle off: allowed again');
