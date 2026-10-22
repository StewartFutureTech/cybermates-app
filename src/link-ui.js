// v37 Device linking screen (Profile -> 📱 Linked devices). Wires the signed QR / short-code flow in src/linking.js:
//   existing device A: "Link a new device" -> signed offer drawn as a QR (src/qr.js, generated locally) + 8-char short code,
//     5-minute countdown -> approve/deny prompt for an incoming request -> signed grant (+ best-effort POST /api/link, which
//     records the hashed device fingerprint and enforces the 5-device cap / bans server-side).
//   new device B: "Link to an existing profile" -> scan the QR (BarcodeDetector + camera) or type the short code -> signed
//     request -> on approve, acceptGrant() opens the profile signing key sealed to B's own box key. B keeps its own
//     encryption key; only the shared profile network ID (+ its signing key) is received. A ban on that ID covers every device.
// Rendezvous: a channel named from a hash of the short code. Messages are public-by-design (signed offer/request, grant
// sealed to B's key). Transport: BroadcastChannel (same browser) + Supabase Realtime broadcast when the backend is Supabase.
import nacl from 'tweetnacl';
import { makeOffer, makeRequest, approve, acceptGrant, shortCode, devHash, verifySigned, LINK_TTL_MS, MAX_DEVICES } from './linking.js';
import { drawQr } from './qr.js';
import { migrateIdentity, stableDeviceFields } from './identity.js';
import { sha256 } from './sha256.js';
import { BACKEND, signal } from './store.js';
const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const T = () => globalThis.__cmLinkTest || {}; // test-only hooks (clock skew, reply timeout); never set by the app
const now = () => Date.now() + (T().skew || 0);
const b64 = u => { let t = ''; for (const x of u) t += String.fromCharCode(x); return btoa(t); };
const keyPair = () => { const k = nacl.sign.keyPair(); return { pub: b64(k.publicKey), sec: b64(k.secretKey) }; };
const boxPair = () => { const k = nacl.box.keyPair(); return { xpub: b64(k.publicKey), xsec: b64(k.secretKey) }; };
const QR_PREFIX = 'CML1~';
export const MSG = {
  expired: 'This link code has expired. Make a new code on your other device (codes last 5 minutes).',
  badQr: "That QR code isn't a Cybermates link code.",
  badCode: 'Link codes are 8 letters or numbers.',
  noAnswer: 'No device answered that code. Check the code, or make a new one on your other device.',
  cap: `This profile already has the maximum of ${MAX_DEVICES} linked devices.`,
  denied: 'Your other device declined the link.',
  banned: 'Linking is disabled for banned accounts.',
  badGrant: 'Link failed: the approval could not be verified. Try again with a new code.',
  already: 'This device is already linked to a profile.',
  noCam: "Camera scanning isn't available in this browser. Type the 8-character code instead.",
  camDenied: 'Camera permission was denied. Type the 8-character code instead.',
};
// QR payload: compact signed offer (pid~nonce~exp~ppub~sig) so it fits a small QR (version ~9, level M).
export const encodeOffer = o => QR_PREFIX + [o.pid, o.nonce, o.exp.toString(36), o.ppub, o.sig].join('~');
export function decodeOffer(s) {
  s = String(s || '').trim(); if (!s.startsWith(QR_PREFIX)) return null; const [pid, nonce, exp, ppub, sig] = s.slice(QR_PREFIX.length).split('~');
  if (!pid || !nonce || !exp || !ppub || !sig) return null; const o = { t: 'link-offer', pid, nonce, exp: parseInt(exp, 36), ppub, sig };
  return verifySigned(o, ppub) ? o : null;
}
export const checkCode = async pub => b64(new Uint8Array(await sha256(new TextEncoder().encode('cm-link-check|' + pub)))).replace(/[^A-Z0-9]/gi, '').toUpperCase().slice(0, 4);
const rdv = async code => 'cm-link:' + b64(new Uint8Array(await sha256(new TextEncoder().encode('cm-link-rdv:' + code)))).replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
export function deviceLabel(n = globalThis.navigator || {}) {
  const ua = n.userAgent || '', os = /Android/.test(ua) ? 'Android' : /iPhone|iPad/.test(ua) ? 'iPhone/iPad' : /Mac OS/.test(ua) ? 'Mac' : /Windows/.test(ua) ? 'Windows' : /Linux/.test(ua) ? 'Linux' : 'device';
  const br = /Edg\//.test(ua) ? 'Edge' : /Firefox\//.test(ua) ? 'Firefox' : /Chrome\//.test(ua) ? 'Chrome' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  return `${br} on ${os}`;
}
async function linkBus(name) {
  if (T().bus) return T().bus(name); // tests: relay between isolated browser contexts (= separate phones)
  const fns = [], parts = [], emit = m => fns.forEach(f => { try { f(m); } catch {} });
  try { const c = new BroadcastChannel(name); c.onmessage = e => emit(e.data); parts.push({ send: m => c.postMessage(m), close: () => c.close() }); } catch {}
  if (BACKEND === 'supabase' && signal) try { const cl = await signal._client(), ch = cl.channel(name, { config: { broadcast: { self: false, ack: false } } });
    ch.on('broadcast', { event: 'l' }, ({ payload }) => emit(payload)).subscribe(); parts.push({ send: m => ch.send({ type: 'broadcast', event: 'l', payload: m }), close: () => cl.removeChannel(ch) }); } catch (e) { console.warn('link relay', e); }
  return { send: m => parts.forEach(p => { try { p.send(m); } catch {} }), on: fn => fns.push(fn), close: () => parts.forEach(p => { try { p.close(); } catch {} }) };
}
// Identity: the profile network ID + signing key. A device that was itself linked uses the shared one (p.devLink).
async function identity(v, me) {
  const persona = new URLSearchParams(globalThis.location?.search || '').get('as') || null;
  return v.use(async p => { if (p.devLink?.pid) return { pid: p.devLink.pid, keys: p.devLink.keys, viaLink: true };
    p.meshIds ||= {}; const rec = (p.meshIds[me?.id || 'me'] ||= { keys: keyPair(), friends: {}, blocked: [] }); await migrateIdentity(rec, { persona }); return { pid: rec.code, keys: rec.keys, viaLink: false }; });
}
async function postLink(grant, ppub) {
  try { const r = await fetch('/api/link', { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ grant, ppub, code: grant.pid }) });
    let j = null; try { j = await r.json(); } catch {} if (r.status === 403) return 'banned'; if (r.status === 409) return 'cap'; return r.ok && j?.ok ? 'ok' : 'pending'; } catch { return 'pending'; }
}
const mmss = ms => { const s = Math.max(0, Math.ceil(ms / 1000)); return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`; };
let live = null; // current session (one per screen), exposed to tests as __cmLink()
globalThis.__cmLink = () => live && { role: live.role, state: live.state, code: live.code, pid: live.pid, exp: live.exp, count: live.count, error: live.error, check: live.check };

let panel = null; // the screen survives re-renders of the Profile/settings area (a running link session keeps its state)
export function deviceLinkPanel(el, me, getVault) {
  if (panel && panel.me === (me?.id || 'me')) { el.append(panel.el); return panel.el; }
  const d = document.createElement('details'); panel = { el: d, me: me?.id || 'me' }; d.className = 'card'; d.id = 'devlink'; d.style.marginTop = '8px';
  d.innerHTML = `<summary><b>📱 Linked devices</b> <span class="muted small" id="dl-count"></span></summary>
    <p class="muted small">Use one profile on up to ${MAX_DEVICES} devices. Each device keeps its own private encryption key; all of them share your profile's network ID. A ban on the profile covers every linked device.</p>
    <ul id="dl-list" class="small" style="padding-left:18px;margin:6px 0"></ul><p id="dl-cap" class="small warn" hidden></p>
    <div class="row gap" style="flex-wrap:wrap"><button class="primary" id="dl-new">Link a new device</button><button id="dl-join">Link to an existing profile</button></div>
    <div id="dl-stage" style="margin-top:10px"></div><p id="dl-err" class="small" role="alert" style="color:#ff6b8b;min-height:1em;margin:6px 0 0"></p>`;
  el.append(d); const q = s => d.querySelector(s), stage = q('#dl-stage');
  const err = t => { q('#dl-err').textContent = t || ''; if (live) live.error = t || ''; };
  const stop = () => { if (!live) return; clearInterval(live.tick); clearTimeout(live.to); live.bus?.close(); live.cam?.getTracks().forEach(t => t.stop()); live.stopped = true; };
  let vault = null; const V = async () => vault ||= await getVault();
  async function renderList() {
    const p = await (await V()).read(), linked = p.linkedDevices || [], count = p.devLink ? null : 1 + linked.length;
    q('#dl-count').textContent = p.devLink ? '· linked' : `· ${count} of ${MAX_DEVICES}`;
    q('#dl-list').innerHTML = p.devLink ? `<li>This device is linked to profile <b>${esc(p.devLink.pid.slice(0, 6))}…</b> (shared network ID) · ${esc(new Date(p.devLink.at).toLocaleString())}</li>`
      : `<li>This device</li>` + linked.map(x => `<li>${esc(x.label || 'Device')} · linked ${esc(new Date(x.at).toLocaleString())} ${x.server === 'ok' ? '· ✓ recorded' : '· ⏳ server record pending'}</li>`).join('');
    const atCap = count !== null && count >= MAX_DEVICES; q('#dl-cap').hidden = !atCap; q('#dl-cap').textContent = atCap ? `${count} of ${MAX_DEVICES} devices linked. ${MSG.cap} No more devices can be added.` : '';
    q('#dl-new').disabled = atCap; q('#dl-join').disabled = !!p.devLink || linked.length > 0; if (live) live.count = count; return { p, linked, count, atCap };
  }
  const seed = async () => { const n = +T().seedLinked || 0; if (!n) return; const v = await V(); await v.use(async p => { const l = (p.linkedDevices ||= []); for (let i = l.length; i < n; i++) l.push({ devHash: 'test-' + i, devPub: 'test-' + i, label: 'Test device ' + (i + 1), at: now(), server: 'pending' }); }); };
  d.addEventListener('toggle', () => { if (d.open) seed().then(renderList).catch(() => {}); else { stop(); stage.innerHTML = ''; } });
  // ---------- existing device A ----------
  q('#dl-new').onclick = async () => {
    stop(); err(''); const v = await V(), { p, linked, atCap } = await renderList(); if (p.ban) return err(MSG.banned); if (atCap) return err(MSG.cap);
    const id = await identity(v, me); let offer; do offer = makeOffer({ pid: id.pid, profileKeys: id.keys, now: now() }); while (shortCode(offer.nonce).length < 8);
    const code = shortCode(offer.nonce), bus = await linkBus(await rdv(code));
    live = { role: 'A', state: 'showing', code, pid: id.pid, exp: offer.exp, bus, count: 1 + linked.length, error: '' }; const S = live;
    stage.innerHTML = `<div class="card" style="margin:0;text-align:center"><p class="small">On your new device open <b>Profile → 📱 Linked devices → Link to an existing profile</b> and scan this code.</p>
      <div style="display:inline-block;background:#fff;padding:8px;border-radius:10px;box-shadow:0 0 18px color-mix(in srgb,var(--cy) 45%,transparent)"><canvas id="dl-qr" aria-label="Device link QR code" style="display:block;width:208px;height:208px;image-rendering:pixelated"></canvas></div>
      <p class="small" style="margin:8px 0 2px">or type this code</p><p id="dl-code" style="font:700 26px/1.2 ui-monospace,monospace;letter-spacing:4px;margin:0">${code.slice(0, 4)} ${code.slice(4)}</p>
      <p class="small muted">Expires in <b id="dl-timer">${mmss(offer.exp - now())}</b></p><div id="dl-prompt"></div></div>`;
    drawQr(stage.querySelector('#dl-qr'), encodeOffer(offer), { scale: 4, margin: 4 });
    const expire = () => { if (S.state === 'done') return; S.state = 'expired'; clearInterval(S.tick); stage.querySelector('#dl-timer').textContent = '0:00'; stage.querySelector('#dl-qr').style.opacity = '.15';
      stage.querySelector('#dl-prompt').innerHTML = `<p class="small">Code expired.</p><button id="dl-again">Make a new code</button>`; stage.querySelector('#dl-again').onclick = () => q('#dl-new').click(); err(MSG.expired); };
    S.tick = setInterval(() => { const left = offer.exp - now(); if (left <= 0) return expire(); const t = stage.querySelector('#dl-timer'); if (t) t.textContent = mmss(left); }, 1000);
    bus.on(async m => {
      if (S.stopped || !m || typeof m !== 'object') return;
      if (offer.exp < now()) { if (m.t === 'l-hello' || m.t === 'l-req') bus.send({ t: 'l-err', reason: 'expired' }); return expire(); }
      if (m.t === 'l-hello' && S.state === 'showing') return bus.send({ t: 'l-offer', offer: encodeOffer(offer) });
      if (m.t !== 'l-req' || !m.req) return; if (S.state !== 'showing') return bus.send({ t: 'l-err', reason: 'busy', to: m.req.devPub });
      if (m.req.nonce !== offer.nonce || m.req.pid !== offer.pid || !verifySigned(m.req, m.req.devPub)) return bus.send({ t: 'l-err', reason: 'bad', to: m.req.devPub });
      S.state = 'prompt'; S.check = await checkCode(m.req.devPub); const label = String(m.label || 'New device').slice(0, 40), pr = stage.querySelector('#dl-prompt');
      pr.innerHTML = `<div class="card warn" style="margin:10px 0 0;text-align:left"><p class="small"><b>A new device wants to link to your profile.</b><br>${esc(label)} · check code <b id="dl-check">${S.check}</b></p>
        <p class="muted small">Only approve if the same check code shows on your new device.</p><div class="row gap"><button class="primary" id="dl-ok">Approve</button><button id="dl-no">Deny</button></div></div>`;
      pr.querySelector('#dl-no').onclick = () => { bus.send({ t: 'l-deny', to: m.req.devPub }); S.state = 'denied'; pr.innerHTML = '<p class="small">Request denied.</p>'; setTimeout(() => { if (S.state === 'denied' && offer.exp > now()) { S.state = 'showing'; pr.innerHTML = ''; } }, 1500); };
      pr.querySelector('#dl-ok').onclick = async () => {
        await seed(); const { p: p2, linked: l2 } = await renderList(); const r = approve(m.req, offer, { profileKeys: (await identity(v, me)).keys, linked: [{ self: true }, ...l2], now: now() });
        if (!r.ok) { bus.send({ t: 'l-err', reason: r.reason === 'device cap' ? 'cap' : 'bad', to: m.req.devPub }); S.state = 'error'; pr.innerHTML = ''; return err(r.reason === 'device cap' ? MSG.cap : offer.exp < now() ? MSG.expired : 'That request could not be verified.'); }
        if (p2.ban) { bus.send({ t: 'l-err', reason: 'banned', to: m.req.devPub }); return err(MSG.banned); }
        const server = await postLink(r.grant, offer.ppub); if (server === 'banned' || server === 'cap') { bus.send({ t: 'l-err', reason: server, to: m.req.devPub }); S.state = 'error'; pr.innerHTML = ''; return err(MSG[server]); }
        await v.use(async p => { (p.linkedDevices ||= []).push({ devHash: r.grant.devHash, devPub: r.grant.devPub, label, at: now(), server }); });
        bus.send({ t: 'l-grant', grant: r.grant, to: m.req.devPub }); S.state = 'done'; clearInterval(S.tick);
        stage.innerHTML = `<p class="small">✅ ${esc(label)} is now linked to your profile.</p>`; await renderList();
      };
    });
  };
  // ---------- new device B ----------
  q('#dl-join').onclick = async () => {
    stop(); err(''); const { p, linked } = await renderList(); if (p.devLink) return err(MSG.already); if (p.ban) return err(MSG.banned); if (linked.length) return err('This device already has linked devices, so it cannot join another profile.');
    live = { role: 'B', state: 'entry', error: '' }; const S = live;
    stage.innerHTML = `<div class="card" style="margin:0"><p class="small">On the device that already has your profile open <b>Profile → 📱 Linked devices → Link a new device</b>, then scan its QR code or type its 8-character code.</p>
      <p class="small warn">This device will switch to that profile's network ID.</p>
      <div class="row gap" style="flex-wrap:wrap"><button class="primary" id="dl-scan">📷 Scan QR code</button></div><video id="dl-video" playsinline muted style="display:none;width:100%;max-width:260px;margin-top:8px;border-radius:10px"></video>
      <div class="row gap" style="margin-top:8px;flex-wrap:wrap"><input id="dl-input" maxlength="9" autocomplete="off" autocapitalize="characters" spellcheck="false" placeholder="8-character code" style="width:10em;text-transform:uppercase;letter-spacing:2px"><button id="dl-send">Link</button></div>
      <p id="dl-status" class="small"></p></div>`;
    const st = t => { stage.querySelector('#dl-status').innerHTML = t; };
    const fail = t => { S.state = 'error'; clearTimeout(S.to); S.bus?.close(); S.bus = null; st(''); err(t); };
    async function request(offer) { // offer verified; send signed request and wait for A's answer
      if (offer.exp < now()) return fail(MSG.expired);
      const devKeys = keyPair(), boxKeys = boxPair(), dev = await stableDeviceFields(), hash = await devHash([dev.platform, ...dev.fields].join('|')); // hardware-only, hashed (server bans by it)
      let req; try { req = makeRequest(offer, { devKeys, boxKeys, hash, now: now() }); } catch { return fail(MSG.expired); }
      S.state = 'waiting'; S.check = await checkCode(devKeys.pub); S.bus ||= await linkBus(await rdv(shortCode(offer.nonce)));
      st(`Waiting for your other device to approve… Check code: <b id="dl-check">${S.check}</b> (it should match on your other device).`);
      clearTimeout(S.to); S.to = setTimeout(() => S.state === 'waiting' && fail(MSG.expired), Math.max(1000, offer.exp - now()));
      S.bus.on(async m => {
        if (S.state !== 'waiting' || !m || (m.to && m.to !== devKeys.pub)) return;
        if (m.t === 'l-deny') return fail(MSG.denied);
        if (m.t === 'l-err' && m.to === devKeys.pub || m.t === 'l-err' && m.reason === 'expired') return fail(MSG[m.reason] || (m.reason === 'busy' ? 'Your other device is busy with another request. Try again in a moment.' : MSG.badGrant));
        if (m.t !== 'l-grant' || !m.grant || m.grant.devPub !== devKeys.pub) return;
        let got; try { got = acceptGrant(m.grant, { offer, boxKeys }); } catch { return fail(MSG.badGrant); }
        const v = await V(); await v.use(async p => { p.devLink = { pid: got.pid, keys: { pub: offer.ppub, sec: got.profileSec }, devPub: devKeys.pub, devHash: hash, at: now() }; });
        S.state = 'done'; S.pid = got.pid; clearTimeout(S.to); S.bus.close(); S.bus = null;
        stage.innerHTML = `<p class="small">✅ Linked! This device now shares your profile's network ID (${esc(got.pid.slice(0, 6))}…). It takes effect the next time you jack in.</p>`; await renderList();
      });
      S.bus.send({ t: 'l-req', req, label: deviceLabel() });
    }
    S.onScan = async text => { const o = decodeOffer(text); if (!o) return err(MSG.badQr); err(''); await request(o); };
    stage.querySelector('#dl-send').onclick = async () => {
      err(''); const code = stage.querySelector('#dl-input').value.replace(/\s+/g, '').toUpperCase(); if (!/^[A-Z0-9]{8}$/.test(code)) return err(MSG.badCode);
      S.state = 'hello'; S.bus?.close(); S.bus = await linkBus(await rdv(code)); st('Looking for your other device…'); clearTimeout(S.to);
      S.to = setTimeout(() => S.state === 'hello' && fail(MSG.noAnswer), T().timeoutMs || 12000);
      S.bus.on(m => { if (S.state !== 'hello' || !m) return; if (m.t === 'l-err' && m.reason === 'expired') return fail(MSG.expired);
        if (m.t !== 'l-offer') return; const o = decodeOffer(m.offer); if (!o || shortCode(o.nonce) !== code) return; clearTimeout(S.to); request(o); });
      S.bus.send({ t: 'l-hello' });
    };
    stage.querySelector('#dl-scan').onclick = async () => {
      err(''); const md = globalThis.navigator?.mediaDevices; if (!('BarcodeDetector' in globalThis) || !md?.getUserMedia) return err(MSG.noCam);
      let det; try { det = new globalThis.BarcodeDetector({ formats: ['qr_code'] }); } catch { return err(MSG.noCam); }
      try { S.cam = await md.getUserMedia({ video: { facingMode: 'environment' }, audio: false }); } catch { return err(MSG.camDenied); }
      const vid = stage.querySelector('#dl-video'); vid.srcObject = S.cam; vid.style.display = 'block'; await vid.play().catch(() => {}); st('Point the camera at the QR code on your other device.');
      const loop = async () => { if (S.stopped || !S.cam) return; try { const r = await det.detect(vid); const hit = r.find(x => x.rawValue); if (hit) { S.cam.getTracks().forEach(t => t.stop()); S.cam = null; vid.style.display = 'none'; return S.onScan(hit.rawValue); } } catch {} setTimeout(loop, 300); };
      loop();
    };
  };
}
