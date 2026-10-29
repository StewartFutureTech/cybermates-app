# Streaming Research: Twitch vs Kick vs Livestream → Cybermates
_Research date: 2026-10-21. Research only; nothing was built._

## Which "Livestream"?
"Livestream" usually means **Vimeo Livestream**, which is now Vimeo Live/Events. It is built for scheduled events: chat, polls, upvoted Q&A, moderated or anonymous questions, questions shown as on-screen overlays, and captions. **Live.me / BIGO LIVE** are mobile apps for live social chat with strangers, built on virtual gifts, multi-guest rooms and PK battles. BIGO is the closer match for Cybermates' social and dating features. Vimeo is the model for scheduled "event" lives.

## Comparison
| Dimension | Twitch | Kick | Vimeo Livestream |
|---|---|---|---|
| Discovery | Browse by category/game, tags, Following tab, recommendations, Clips/Stories for catch-up | Browse by category, following list | Event pages, embeds, calendar |
| Chat | Emotes, slow/follower-only/sub-only/emote-only modes, Shield Mode | Emotes, slow/follower/sub modes | 280-char chat, emoji, polls, upvoted Q&A |
| Follow/notify | Follow plus go-live notifications; raids send your viewers to another channel (incoming raids can be paused for up to 1 hour) | Follow plus notifications, hosting | Registration and reminders |
| Clips/VODs | VODs, Clips, AI Auto Clips ("Clip That"), clip reactions | VODs, clips | Recordings |
| Money | Subs 50/50 → 60/40 (100 Plus Points) → 70/30 (300 Plus Points, no cap since 2024); Bits; ads; Hype Train | **95/5 subs** ($5 flat); KICKs gifts (not currency, no cash value, can't be traded or paid for favors); per-stream payouts (KCIP) | Paid tickets and plans for organizers |
| Tools | Panels, overlays/alerts (third-party), Extensions, Channel Points, Stream Manager | Basic dashboard, overlays via third parties | Browser studio, scenes, Q&A graphics |
| Moderation | AutoMod (4 levels: discrimination, sexual content, hostility, profanity; holds messages for mod review), mods, bans, Shield Mode (bulk ban, no first-time chatters), reporting | Mods, bans, reports plus automatic flags | Organizer deletes/blocks, moderated Q&A |
| Age/labels | 13+, under-18 with a parent's supervision; content labels (Mature game set automatically from ESRB, Sexual, Drugs, Violence, Profanity, Gambling, Politics); some labels show a warning screen viewers must acknowledge | 13+, under-18 with parental consent; **18+ label** required (gambling always; "if unsure, apply it") | Organizer-controlled |

## Patterns to adapt for Cybermates
1. **Label-first age gating:** Twitch/Kick labels only warn viewers. In Cybermates, use them as hard routing rules: a stream carries the streamer's age group (minor or adult), and an 18+ label or Dating mode hides the stream from minors' devices entirely. Minor and adult accounts never share a stream room or a chat.
2. **Stream your Arcade match:** Mesh games are already peer-to-peer. Add spectator seats, turn auto-highlights into short clips, and link to "join next round" or LFG (looking-for-group) posts.
3. **Friends-only lives:** Default audience is friends or a group (small enough for mesh). Notify followers when you go live; raids move a whole squad to a friend's stream.
4. **Chat modes plus AutoMod presets:** Slow, friends-only and boost-supporter-only chat, a one-tap Shield preset, and on-device text classification, since there are no servers.
5. **Boosts in the role of Bits/KICKs:** Gifts with no cash value, Hype-Train-style group goals, and a creator share inspired by Kick's 95/5. Adopt Kick's rule against trading gifts for favors or meetups, which matters for Dating. Minors have no gifting to or from adults.
6. **Vimeo-style Q&A** for scheduled events and tournaments.

## P2P fit / limits
Mesh WebRTC works for about 4–8 viewers. Each peer forwarding the stream to others (relay trees) can reach dozens of viewers, but latency and churn get worse. Broadcasting to hundreds or thousands needs an **SFU or CDN** (selective forwarding unit / content delivery network) or a third-party provider such as LiveKit, Cloudflare Stream or Mux. That breaks the single-entry-point rule, so either cap audiences or approve a paid relay add-on. Video Roulette and Dating lives stay 18+ and 1:1 or small-group.

## Sources
- https://help.twitch.tv/s/article/plus-program
- https://blog.twitch.tv/en/2024/01/24/an-update-to-several-streamer-payout-programs
- https://blog.twitch.tv/en/2025/10/17/ten-years-of-twitchcon-here-s-what-we-announced-in-san-diego/
- https://gamingcareers.com/newsletters/everything-twitch-just-announced-at-twitchcon-rotterdam/
- https://help.twitch.tv/s/article/content-classification-labels
- https://safety.twitch.tv/s/article/Guide-Parents-Educators
- https://safety.twitch.tv/s/article/Chat-Tools
- https://help.twitch.tv/s/article/how-to-manage-harassment-in-chat
- https://help.twitch.tv/s/article/hype-train-guide
- https://streamer.kick.com/partner
- https://kick.com/terms-of-service
- https://kick.com/kicks-usage-policy
- https://help.kick.com/en/articles/15063676-content-classification-labels-when-to-use-them
- https://mubert.com/blog/how-kick-streaming-works-how-creators-make-money
- https://help.vimeo.com/hc/en-us/articles/12426977669777-How-to-set-up-and-manage-Live-Q-A
- https://help.vimeo.com/hc/en-us/articles/12426085683985-Participate-in-a-live-event-chat-poll-or-Q-A-session
- https://vimeo.com/features/livestreaming
- https://www.bigo.tv/ , https://www.liveme.com/ (general knowledge, not fetched)
