# Cybermates UX walkthrough (dictated by David, 2026-10-21) - DOCUMENTATION ONLY, do not implement yet

## 1. Discovery & install
- User finds the app via App Store, Google Play, or a social media link (X etc.) with instructions.
- Consider an "Add to Home Screen" pop-up (PWA-style).
- Also wrap as real native apps for App Store and Google Play.

## 2. Login / first-run sequence
1. User logs in.
2. First pop-up: age verification.
3. Acknowledgement screen with "Read to me" button at the very top.
   - Force scrolling through the full text.
   - Minimum timer (~30s, or ~20s, whatever fits the voice read length) before Accept is enabled.
4. After accepting: background work pulls device info to create the identity hash key.
   - Fallback if device data is unavailable: randomly generated number.
   - Known downside: someone could delete/remake an account to harass; mitigated because there is no search, they'd have to find the person again in the mesh.
5. Forced profile creation: user cannot proceed until the profile is fully complete.

## 3. Profile pictures
- Pre-generated generic character options to start: boy/girl goth, boy/girl jock, boy/girl gamer (one of each).
- Up to 4 pictures maximum displayed.
- More than 4 = "rolling pictures": only 4 shown at a time, cycling each login/logout; extras stored on the phone only, NOT sent in the packet (keeps packet size down). Tell the user this when they add more than 4.

(continued as dictated; engineer commentary to be captured inline)

## 4. AI-assisted profile setup
- At the very top of profile creation: "Have Grok help you set up your profile."
- Grok walks the user through profile questions conversationally, not a rigid form.
- Natural conversation allowed, e.g. "Tell me about your experience with Netflix, what are your favorite shows?" If the user can't recall a show name, Grok helps them figure it out.
- (Engineer note: needs xAI API key; key stays server-side.)

## 5. Matching, filters & profile fields
### Gender filtering
- Dating mode only: users may filter (e.g. "only women").
- Friends and Gaming: fully gender-neutral, one shared space, no gender filter.

### Field weighting per mode
- Dating: most profile aspects at full weight.
- Gaming: only gaming profile fields.
- Friends: gaming, sports, location, event preferences (concerts etc.); religion and similar weighted much lower.
- Online gaming: those weighted even lower; religion barely matters. "Interested only in women" is dating-only.

### Additional profile fields
- Glasses yes/no; income (optional to disclose); job status (full-time, part-time, self-employed).
- Per field, user sets importance: "make or break" vs "I don't care". Deal breakers = simple on/off toggle.

### Compare modes
- Soft compare: categories (both religious = match).
- Hard compare: individual mismatches with partial credit (she likes soccer + baseball, he likes only football = partial). Score clamped 0-100%.
- Matching specific games (e.g. Witcher, Halo) earns extra points in hard compare.

### Input rules
- Interests: hard cap of 20; defaults removable.
- Big lists (religion) = dropdown. Small sets (left/right hand, four political options) and sports = tappable bubbles.
- "I don't want to answer this" per section removes that field from comparison (like OkCupid).

### Hidden fields vs deal breakers (chosen: "sneaky way")
- A field a user hides is never a hard deal-breaker block for them.
- If the other person marked that field as a deal breaker, the hidden field silently applies a significant penalty to the match percentage instead of a full block.
- No indication to either party of why the score dropped.
- Chosen over the clean "hidden means hidden / no effect" approach.

### Age ranges & dating-only fields
- User sets a preferred age range separately for Dating, Friends, and Gaming.
- Dating also asks sexual preference (like OkCupid).
- Dating-only fields (dating age range, sexual preference) appear on the profile only when dating is enabled.
- Profile has a Dating enable/disable toggle (like the app's tab toggles); user can turn dating off anytime.

## 6. Discover (main menu)
- Discover section shows many people. Default = list mode showing everybody; a button enters swipe mode.
- Tap a person to load their profile; can Like and send an initial message.
- Swipe left = pass: disconnects them from your linked mesh and searches for another node to fill that slot.

## 7. Mesh joining (future)
- Eventually remove the "join mesh" buttons in Advanced settings; app silently always auto-joins the mesh.
- LEAVE the buttons for now (server not set up yet).

### Discovery search criteria
- App searches the mesh for responding nodes matching the user's criteria: age group, gender (dating only, e.g. female), gaming status or other mode-specific requirements, and a minimum match %.
- User sets a separate minimum match threshold per mode, e.g. Dating >= 70%, Friends >= 60%, Gaming >= 90%.

### Clumps & background "tentacles"
- Discover list builds into the user's mini set of nodes; the mesh forms small interconnected clumps (like clots) of people.
- Swipe left = disconnect; swipe right = want to talk.
- People round-robin in and out while discovering.
- Background "tentacles" continuously connect/disconnect to other nodes, seeking profiles that match better than the lowest-matching members of the user's current clump, then pull those higher-match nodes in (replacing the weakest) so they join the collective.

## 8. The living mesh (core loop for everything)
- NOT like X's algorithm discovery.
- On connect, a node blasts out its presence, and keeps doing so: broadcasting only once would leave it stuck where it first landed. Nodes must constantly move.
- Each node holds many connections to other nodes (bucket of ~200 highest-match people), and those connections are always shifting and changing.
- Swipe left rejects someone and throws them off your network.
- Because like-minded people are already clustered in the same "nest in the ether", search responses come back much faster, regardless of physical distance (they may be very far apart).
- Searching for more hops into neighboring clusters' buckets and checks them all.

### Broadcast efficiency
- Staggered broadcasting: each node gets a random offset so broadcasts don't fire on the same beat.
- Adaptive interval: quiet when connections are stable, faster when matches are shifting.
- Piggyback profile data onto existing traffic where possible.
- Smallest possible connection packet: profile answers consolidated into compact "soft numbers" (soft-percentage vector) for quick comparison during discovery.
- Full detailed profile exchanged only after a real connection forms.
- Clarification: during discovery only the tiny soft-tag packet circulates (sports, gamer, religious or not, has job, etc.). The full detailed profile (all logic-heavy comparison data) is requested and sent only at the moment a user taps to view that person's profile.
- Opening a profile shows a small "Loading their profile..." screen; during it the app also checks whether that person is currently online. Should not feel laggy since only the full profile travels at that point.

## 9. Sending messages
- Messages that successfully get through are delivered and held (existing 7-day hold for offline recipients stays).
- Any message that fails to deliver because the recipient has gone offline (no response to the send check) does NOT appear in their message box; the sender is told "they logged off to mesh" and any boost is refunded.
- Applies to every failed message, not just first or boosted ones.
