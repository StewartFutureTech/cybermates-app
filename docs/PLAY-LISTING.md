# Google Play listing — DRAFT (not submitted)

*Draft written 2026-10-21 for `com.cybermates.app` (Capacitor 6, `android/`). Nothing here has been submitted to Play Console. Items marked **[DECIDE]** need David's call before upload; items marked **[LEGAL]** need counsel review.*

## Store listing

**App name (≤30):** Cybermates: Friends, Games & Dates

**Short description (≤80):** Meet people who match you. Play 3D arcade games. Friends, gaming and 18+ dating.

**Full description (≤4000):**

> Cybermates is a social mesh for finding your people — gamers, friends and (18+) dates — built around who is online right now.
>
> **Match on what matters to you.** Pick how much each answer matters, from "I don't care" to "make or break". Turn deal breakers on or off. Skip any question with "I don't want to answer". Friends and Gaming are fully gender-neutral; gender filters only exist in Dating.
>
> **Discover your way.** Browse everyone in a list, or switch to swipe mode. Swipe left and that person leaves your mesh, and a new match fills the spot.
>
> **Play together.** 3D arcade games with sound: chess, checkers, Connect Four, battleship, air hockey, light-cycle duels, snake battles, trivia, Draw & Guess, bingo and mass-arena games. Jump into a running game anytime. Empty seats are filled by clearly labeled AI players until real people join.
>
> **Real voice, fair turns.** Proximity voice in arenas and room voice at game tables. Push to talk, up to 10 seconds per turn and 10 seconds per minute, so nobody hogs the room.
>
> **Looking for group.** Add your favorite multiplayer games with console, post to the LFG board, and find a squad.
>
> **Events.** Create a concert, LAN party or meetup in Friends. It's shown to people who like that kind of event.
>
> **Safety first.** Under-18 accounts are kept completely separate from adults: no dating, no video roulette, and voice only with players in the same age group. Report a profile, chat or player in a game, and the report goes to our review team. Block or mute anyone in one tap.
>
> **Private by design.** Your profile is encrypted on your phone. Religion and orientation are optional and never leave the device. Photos beyond your top 4 stay on your phone.
>
> Cybermates does not run criminal background checks or identity verification. Meet in public and never send money to someone you met online.

**Category:** Social. **Tags:** Social networking, Multiplayer, Friends, Dating (see age note).

**Contact email:** **[DECIDE]**. The app currently shows a placeholder (`safety@cybermates.example`). A real, monitored address is required before submission.
**Privacy policy URL:** **[DECIDE]** Must be a public HTTPS page. Not created yet.
**Website:** https://cybermates-stewart-future-tech.vercel.app

## Graphics checklist

| Asset | Spec | Status |
|---|---|---|
| App icon | 512×512 PNG, 32-bit | `public/icon-512.png` exists; check it against the Play icon spec (no alpha in corners) |
| Feature graphic | 1024×500 JPG/PNG | **TODO**: glass/neon 3D style, no small text |
| Phone screenshots | 2–8, 16:9 or 9:16, ≥1080 px | **TODO**: Discover (list + swipe), match card, chess 3D, arena with voice, LFG board, events |
| 7" / 10" tablet | optional | skip for v1 |

## Content rating (IARC questionnaire): expected answers

- Users can interact / exchange info: **Yes** (chat, voice, video, photos).
- Shares location: **Approximate only** (city / region; the distance filter uses coarse coordinates on device).
- Digital purchases: **Yes** (boosts, cosmetics, Cybermates+ subscription).
- Gambling / simulated gambling: **No** (bingo has no stakes or prizes). **[LEGAL]** confirm.
- Sexual content: **No** (moderated; reports bucket).
- Expected outcome: **Teen** or **Mature 17+** because of dating and user-generated content.

## Target audience & Families policy: **[DECIDE] / [LEGAL] — blocking question**

The app allows 13–17 accounts (minor mode: friends, chat and games only, fully separated from adults). Google Play policy for apps with **dating** features generally requires **18+** targeting. If the target audience includes under-18s, the Families / teen requirements apply. Options:
1. **Ship 18+ only on Play** (simplest; disable minor mode in the Play build flavor).
2. Ship **two listings**: an 18+ app with dating, and a separate teen app (friends + games, no dating code).
3. Keep one app for 13+ with dating hidden for minors. This is high review risk, so get counsel and a pre-review first.

Until this is decided, the target-audience section stays blank.

## Data safety form: draft answers

| Data type | Collected? | Shared? | Notes |
|---|---|---|---|
| Name, profile info, photos (≤4) | Collected **on device**; sent peer-to-peer to matched users | Shared with other users (user-initiated) | Encrypted at rest on device |
| Approximate location | Yes (city/region) | With matches (city only) | No precise GPS sent |
| Messages | Peer-to-peer; offline messages held encrypted on the **sender's** phone for 7 days | No server storage today | 7-day encrypted safety copy on device for reports |
| Audio (voice) | Streamed peer-to-peer in real time, **not recorded or stored** | — | Grok voice setup (optional, paid) runs under xAI Zero Data Retention |
| Device ID | A hashed ID derived on device (or a random one) | Used for bans/abuse prevention | Not an advertising ID |
| Purchase history | Yes (Play Billing receipts) | Server verification | |
| Reports | Content the reporter chooses to attach | Cybermates safety team; law enforcement when legally required | |
| Religion / orientation | **Optional, on device only, never transmitted** | No | |

- Data encrypted in transit: **Yes** (E2E-sealed mesh envelopes; DTLS-SRTP for WebRTC media).
- Users can request deletion: **[DECIDE]**. An in-app "delete account" flow plus a web form URL are required.

## Permissions (AndroidManifest)

`INTERNET`; `RECORD_AUDIO`, `MODIFY_AUDIO_SETTINGS` (game voice and calls, asked only when voice is turned on); `CAMERA` (video calls, asked only when video starts). Microphone and camera are declared `required="false"`.

## Monetization disclosure

In-app purchases: $0.49–$4.99 boosts and cosmetics; Cybermates+ is $4.99 per month or $29.99 per year (18+ only). Shown prices are mock in the beta. **Play Billing integration is still TODO.** Today the shop calls a mock purchase path. Google Play requires Play Billing for digital goods.

## Pre-launch checklist

- [ ] Release signing key (Play App Signing). Never commit the keystore or passwords.
- [ ] `versionCode` / `versionName` bump (currently 1 / "1.0").
- [ ] Target API level: currently `targetSdkVersion 34`. Play requires API 35 for new apps from Aug 31 2025, so this must be bumped **[verify the current requirement]**.
- [ ] TURN server for voice behind strict NATs (`src/rtc-config.js` slot is intentionally empty).
- [ ] Real safety contact, privacy policy and account-deletion URL.
- [ ] Reports bucket backend (Supabase `reports` table). Reports are stored on device until then.
- [ ] Closed testing track with ≥12 testers for 14 days (required for new personal developer accounts).
