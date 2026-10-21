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
