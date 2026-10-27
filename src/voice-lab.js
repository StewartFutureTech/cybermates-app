// v44 TEST HOOK (admin/dev builds only; see app-mesh.js): exposes the proximity-voice transport classes so the browser e2e
// (scripts/e2e-proxvoice.mjs) can drive real WebRTC links over the real mesh 'vrtc' signaling with test-chosen positions.
// Nothing here bypasses a gate: the same VoiceHub / ProximityVoice / canLink rules apply as in the arcade.
export { VoiceHub, VoiceLink, validSignal, canLink, MAX_LINKS } from './rtc-voice.js';
export { ProximityVoice, gainFor, inView, RANGE } from './arcade/proximity.js';
export { iceServers, hasTurn } from './rtc-config.js';
