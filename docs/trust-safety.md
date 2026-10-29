# Trust & Safety / Admin runbook (DRAFT — have counsel review before launch)

Published safety contact: **stewartfuturetech@gmail.com**, shown in Settings and Terms (`SAFETY_CONTACT` in `src/compliance.js`). Must be a real, monitored address (plus postal address where required) before launch.

## In-app tools
- **Report** button on every live profile (Discover) and in every chat → row in Supabase `public.reports` (insert-only; reporter code, reported code, reason, optional ≤1000-char excerpt the reporter explicitly chose to attach). With no Supabase configured, reports queue in localStorage (`cybermates:pending-reports`) — NOT delivered.
- **Block** (mesh-level; drops their messages). Report flow offers block afterwards.
- Messages are P2P and not held on our servers, so the excerpt the reporter attaches is usually the only evidence we receive. **Exception (v45): child-safety reports**. These carry no plaintext excerpt. The reporter's phone seals what it holds from the reported person (messages, attachments/media, the 7-day safety copy, the profile view) to the safety-team public key and uploads it to an evidence hold (see below).

## Triage (target: illegal-content reports reviewed within 24h)
Moderators (rows in `public.moderators`, added by the owner with the service role/dashboard; adult accounts only) review in the app: Profile → ⚑ Reports & moderation queue → 🛡️ Team review (buckets Serious abuse / All open / Resolved; `public.mod_queue`, `mod_claim`, `mod_resolve`, every action logged in `public.report_actions`; only a lead can dismiss a priority-1 report; nobody can act on a report they filed or are named in). Admins can still read `reports` with the service role (Supabase dashboard / SQL). Act by adding the reported code/public key to a signed denylist (future: signed `app_config` key) and banning their entitlements.

## CSAM / child sexual exploitation — escalation path
1. **Do not** download, forward, copy or re-share the material. Do not investigate beyond what is needed. Limit access to designated staff.
2. If a child is in imminent danger: call **911** / local law enforcement immediately.
3. **Report to NCMEC CyberTipline** (https://report.cybertip.org/) as soon as reasonably possible. US providers with actual knowledge of apparent CSAM must report under **18 U.S.C. §2258A** (applicability to our P2P architecture is UNVERIFIED — counsel to confirm; we report regardless). Include: reported code/public key, report excerpt, timestamps (UTC), any IP/account data we hold (we hold very little by design).
4. **Preserve** the report row and associated data for **1 year** after submitting the CyberTip (§2258A(h) as amended by the REPORT Act — UNVERIFIED), secured and access-logged. Do not notify the reported user.
5. Ban the user (denylist + entitlements), record the CyberTip report ID internally.
6. Non-US users: also report to the relevant hotline (UK: IWF https://report.iwf.org.uk/; EU: INHOPE member hotline) — counsel to confirm obligations (UK OSA, EU DSA).
7. Other illegal content (threats, trafficking, terrorism): refer to law enforcement; respond to valid legal process via the safety contact.

## CSAM evidence holds (v45, technical side; counsel to review)
- **What is held.** A report filed under *illegal content (incl. child abuse)* makes an evidence hold (`app.evidence_holds`, private schema, no client access). It contains:
  - the sealed bundle the reporter's phone uploaded (ciphertext only; the server verifies SHA-256 per part and for the whole bundle and can't read it)
  - a snapshot of the report and the reported account (id, handle, display name, created/last seen, age band, public key)
  - our own copies of that conversation's server message ciphertext, taken before the 7-day purge
- **Retention.** Holds are exempt from `purge_expired`. The default is 1 year. When a lead records the CyberTip report ID (`mod_cybertip_recorded`), it becomes 1 year from that moment (§2258A(h) as amended by the REPORT Act, UNVERIFIED). A 2703(f) / legal hold adds 1–90 days per request, and a renewal extends from the current end. `app.purge_evidence()` runs daily and removes a hold only after both periods have passed, logging the expiry. Everything else keeps the phones-only / auto-delete model.
- **Access.** Only active adult moderators can open a hold (`public.moderators`), and never on a report they filed or are named in. Every list, view, server-copy read, packet, preservation and CyberTip record goes to `app.evidence_access_log` and is mirrored into `report_actions`. The reporter can't read the bundle back, and the reported user sees nothing.
- **Opening evidence.** Use Team review → 🔒 Evidence & preservation → *Open sealed evidence*, then paste the team secret key. It decrypts in memory, the key is never saved, images stay blurred until tapped, and *Close & wipe* clears the screen. Do not download, forward, copy or screenshot anything.
- **CyberTip packet.** *CyberTip packet* assembles the fields the CyberTipline report asks for:
  - reporting ESP and contact (placeholders)
  - incident type and time (UTC)
  - reported person (user id, screen name, account dates, age band, key; no IPs, since we don't log them)
  - uploaded files with SHA-256 and whether the ESP viewed them; once the bundle is opened, it adds per-file hashes of the decrypted media
  - timeline, moderator notes and preservation status
  
  **It is never sent by the app.** After counsel review, a person submits it through NCMEC (report.cybertip.org / ESP API), and then a lead records the CyberTip ID.
- **2703(f) requests.** *2703(f) preservation* works on any report. If there's no bundle, it creates a metadata + server-copy hold. It records the request reference, agency and days. Respond to the legal process itself through the safety contact.
- **Team key.** Run `node scripts/evidence-key.mjs gen --out <offline file>` on an offline machine. It prints the SQL that registers the public half in `app.evidence_keys` (owner / SQL editor). Rotate by deactivating the old row. Old holds still need the old secret key. Until a key is registered, phones keep bundles in their encrypted vault (max 5, 30 days, the server upload window).
- **Open (owner's calls).** Counsel review of all of the above, the real safety contact, NCMEC ESP registration and the actual submission, and who holds the team secret key.

## Underage users
Age gate (DOB, 18+) at first launch; under-18 is blocked permanently on that device (only an adult yes/no flag is stored, never the DOB). "Underage user" reports → ban. UK: highly effective age assurance required before UK launch (placeholder in `ukAgeAssurance`).

## Sensitive data
Religion/orientation: opt-in only, on-device only, never sent to server/analytics/xAI (`stripSensitive`). Warning shown for countries in `CRIMINALIZING_COUNTRIES` (keep in sync with ILGA World database).

## Voice
Explicit consent + AI disclosure before any mic use; audio transcribed then discarded, never stored; no voiceprints; Grok voice requires xAI Zero Data Retention (see `api/_fn/voice-session.js`). Typed setup is always free.

## Proximity voice links (v44)
- Arcade proximity voice opens a direct audio link only between two players of the **same age band** who are inside each other's range (nearest 8). Both sides check, and the receiver refuses any offer it doesn't want. An adult can never open or hold an audio link to a minor, even with a modified app that lies about bands, because the receiver checks the band it knows.
- Blocked and muted players never connect, and muting or blocking closes the live link on both sides at once. Minors still need the parent toggle. Talk is push-to-talk with the 10 s turn / 10 s-per-minute limits, enforced by the listener too. No audio goes through a server (a TURN relay, once configured, only forwards encrypted SRTP), and nothing is recorded.

## ID ↔ key binding (v43)
- Every public ID is bound to one signing key. Peers and the bootstrap server refuse a key that isn't the one the ID is bound to, so nobody can take over someone else's ID in pings, adverts, presence, logoff or account deletion. The server's presence row also feeds boost-refund receipt checks, so those can't be redirected either.
- New IDs pay a one-time proof of work (the web join cost), which slows mass creation of throwaway IDs for ban evasion or floods. It doesn't stop it; real attestation (Play Integrity / App Attest) is the stronger fix and is still a hook.
- Reinstall on the same phone (same ID, new key): the old binding frees up after 14 days of silence, and the new install pays a heavier proof of work. Support can also rotate a binding if the user still has the old key. David decides the idle window.

## Mesh suspensions (v46)
- Moderators can cut one user off the shared Realtime mesh: `mod_mesh_suspend(user, minutes, reason)` (reviewer up to 7 days, lead up to 30, never themselves, reason required) and `mod_mesh_lift(user)`. The user's admission is removed at once, so Realtime refuses their next join and their next token refresh. The server has `mesh_suspend_service` (service role). Attempts and suspensions are logged in `app.mesh_admit_log` (no IPs, kept 7 days). This is a network lever, separate from bans (`api/_fn/ban.js`) and report actions.
