# Cybermates competitive research
*Oct 16, 2026. Sources: app support/newsroom pages, 2026 review roundups and review-complaint analyses (Unstar "8 dating apps ranked by negative reviews 2026", RightIdea "730+ dating-app complaints" Jul 2026, Mashable "best dating apps 2026"), Bumble/Hinge/Discord help centers, and our own MONETIZATION.md price scan. Prices are typical US list prices and vary by age, region and plan length.*

## Tinder
- **Core:** swipe deck, mutual-like match, Super Like, Boost, Passport (pick any location), Explore/vibes, photo + ID verification, Double Date, an AI-assisted matching ("Chemistry") rollout.
- **Money:** Plus / Gold / Platinum (~$25–$50/mo); Boosts ~$4–$12, Super Likes in bundles; "See who likes you" sits behind Gold.
- **Love:** huge, global user pool; fast and simple; works anywhere when traveling.
- **Hate:** the most negative reviews of any major app (~48% 1–3★); paywalled basics (who liked you, rewind, more likes); bots and Telegram/WhatsApp scam redirects; matches that feel random; Passport profiles ignoring distance.
- **Borrow:** the dead-simple core loop; **verification badge**; travel/"global" as an *explicit* choice (our Gaming = global). **Avoid:** paying to see likes, and fake "nearby" profiles. Label each person's real location honestly.

## OkCupid
- **Core:** long profiles; thousands of questions, each with "answers I accept" + importance weights → match %; 20+ gender and 12+ orientation options; DoubleTake; Intros.
- **Money:** Basic/Premium (~$45/mo; ~$22/mo on 6-month plans), Boosts, SuperLikes.
- **Love:** match % that works when people answer many questions; inclusive identity options; detailed profiles.
- **Hate:** bots, bugs and a sense of neglect; distance filters ignored ("virtual travellers" with no way to filter them out); thin profiles with only ~15 answers that still score 90%.
- **Borrow:** we already use its weighted-question scoring (geometric mean). Add **"answer more to improve your %"** nudges. Weight the score down when few questions overlap. **Make distance a hard filter on both sides** (done in this pass).

## Hinge
- **Core:** 3 required Prompts plus photos; like or comment on a *specific* prompt or photo; "Most Compatible" daily pick; Roses; Date Ideas (3 preferred first dates + availability); AI Convo Starters and prompt feedback; "We Met" feedback.
- **Money:** Hinge+ (~$33/mo), HingeX (~$50/mo), Roses (3 for $9.99), Boosts.
- **Love:** fewest scam complaints (prompt profiles are hard to bot); conversations start from real content; "designed to be deleted" intent.
- **Hate:** a few free likes per day; pricing; AI-driven bans with no human appeal.
- **Borrow:** **reply-to-a-specific-thing openers.** Our "You both: Game X" chips should be tappable icebreakers ("Ask about World of Warcraft"). Also **"Session Ideas"**, the gaming version of Date Ideas: "duo ranked tonight", "co-op Stardew this weekend", "watch-party Arcane". Add human appeal for bans.

## Bumble (+ BFF)
- **Core:** in 2026 *both* people send one opening message before the chat unlocks (Opening Moves retired), within a 72-hour window (was 24 h). Low-effort "hey" openers trigger a nudge. BFF is now a separate app with interest tags, photo prompts, mandatory selfie verification, and **Groups** (chat, posts, video, IRL plans).
- **Money:** Premium (~$40/mo), Premium+ (~$80/mo), Boosts, BumbleCoins/Spotlight.
- **Love:** safety tools, verification, and less harassment; BFF for making friends; groups.
- **Hate:** matches expiring ("busy one day, lost my match"); expensive tiers; billing after cancelling; bots.
- **Borrow:** a **"hey" nudge** on first messages; **verified-only friends**; **Groups/squads** for Gaming mode (a 5-stack, not just 1:1). **One-tap cancel** for Cybermates+ (shipped in the mock shop). **Avoid** hard expiry; maybe use a soft "still interested?" reminder instead.

## Discord (positioning: Cybermates is the *hub*, not a replacement)
- **What it is:** servers, voice, streaming (Go Live), friends/DMs, profile "Connections" (Steam, Xbox, PSN, Twitch, YouTube, Spotify, Riot, Battle.net…), Nitro (~$10/mo), server boosts, Quests/Orbs, an app directory, and 2025–26 age-assurance rollouts in some regions.
- **Love:** best-in-class voice and community; free core; connections show your other accounts.
- **Hate:** hard to *find* new people outside servers; friend requests need an exact username, with no public "add me" link by username; `discord.com/users/<id>` only works if you already share a server, and the `discord://` protocol only works in the Windows client; spam DMs; the age-verification privacy backlash.
- **The gap Cybermates fills:** Discord is where you hang out *after* you've met someone. Cybermates is where you *find* them, and then holds all your gamer tags, socials and streams in one place and hands off.

### Handoff features
| Feature | Status |
|---|---|
| One-tap **copy** + **open** for every platform (Steam, Xbox, PSN, Twitch, Kick, YouTube, Instagram, TikTok, X, Snapchat, Reddit, Threads, Bluesky) | ✅ shipped |
| **Discord friend-add handoff**: copy exact username, open Discord, toast "Friends → Add Friend → paste" | ✅ shipped |
| Copy-only platforms (Riot ID, Nintendo friend code, Battle.net, Epic, EA, Ubisoft) with how-to-add text | ✅ shipped |
| **Discord server invite** field → "Join their Discord server" button | ✅ shipped |
| **Per-account privacy**: Everyone / After mutual match / Hidden; locked count shown ("🔒 3 accounts unlock after you both message") | ✅ shipped (RLS-backed in Supabase mode) |
| **Send my linked-accounts card** in chat after a mutual match (only accounts that person can see) | ✅ shipped |
| Photos hidden until match (optional) | ✅ shipped |
| Discord OAuth "Connect Discord" (verified username + user ID → working `discord.com/users/<id>` link, auto-fill) | next (needs a Discord app, free) |
| Steam/Xbox/PSN/Twitch OAuth or OpenID to *verify* ownership of tags (anti-catfish) | next |
| QR "add me" card / shareable profile link (cybermates.app/u/handle) with the same privacy rules | next |
| "Create a group DM / squad" handoff: generate a one-time Discord invite to the user's own server for a matched 3–5 stack | later |
| Reveal timeline: auto-reveal chosen accounts after N messages or a scheduled session | later |
| Revoke: un-share an account from one person (per-match override) | later |

## Top takeaways for Cybermates
1. **Don't paywall the basics.** "Pay to see who liked you" is the #1 complaint (about 31% of negative reviews). Keep matching and replies free; charge for reach (starters) and priority (boosts) at low unit prices. One-tap cancel.
2. **Real filters that are actually respected.** Distance being ignored is a top complaint at OkCupid and Bumble. Per-mode ranges (Dating 50 mi, Friends region, Gaming global), checked on *both* sides, is a real differentiator.
3. **Anti-bot trust is the product.** Verification badges (Tinder/Bumble), prompt-based profiles (Hinge), and verified linked gaming accounts (our edge) cut scams. Ship the selfie check and OAuth-verified tags early.
4. **Start conversations from shared content.** Hinge comments, Bumble's "no 'hey'" nudge and Date Ideas all turn a match into a first message. Our shared games/shows chips plus "Session Ideas" do the same for gamers.
5. **Be the hub, not the destination.** Discord, Steam and Twitch already own hanging out. Cybermates should win at *finding* people and make handoff to those platforms easy and privacy-controlled (reveal-after-match), plus squads/groups for Gaming.
