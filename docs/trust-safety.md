# Trust & Safety / Admin runbook (DRAFT — have counsel review before launch)

Published safety contact: **safety@cybermates.example — PLACEHOLDER**, shown in Settings and Terms (`SAFETY_CONTACT` in `src/compliance.js`). Must be a real, monitored address (plus postal address where required) before launch.

## In-app tools
- **Report** button on every live profile (Discover) and in every chat → row in Supabase `public.reports` (insert-only; reporter code, reported code, reason, optional ≤1000-char excerpt the reporter explicitly chose to attach). With no Supabase configured, reports queue in localStorage (`cybermates:pending-reports`) — NOT delivered.
- **Block** (mesh-level; drops their messages). Report flow offers block afterwards.
- Messages are P2P and not held on our servers, so the excerpt the reporter attaches is usually the only evidence we receive.

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

## Underage users
Age gate (DOB, 18+) at first launch; under-18 is blocked permanently on that device (only an adult yes/no flag is stored, never the DOB). "Underage user" reports → ban. UK: highly effective age assurance required before UK launch (placeholder in `ukAgeAssurance`).

## Sensitive data
Religion/orientation: opt-in only, on-device only, never sent to server/analytics/xAI (`stripSensitive`). Warning shown for countries in `CRIMINALIZING_COUNTRIES` (keep in sync with ILGA World database).

## Voice
Explicit consent + AI disclosure before any mic use; audio transcribed then discarded, never stored; no voiceprints; Grok voice requires xAI Zero Data Retention (see `api/_fn/voice-session.js`). Typed setup is always free.
