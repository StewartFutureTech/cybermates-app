// Neon line nav icons (inline SVG, stroke = currentColor = theme). Idle loops are CSS (see style.css .ni-*);
// "pathLength=1" lets the activate animation draw strokes on. Pure decoration: aria-hidden, no listeners.
const S = (body, cls) => `<svg class="ni ${cls}" viewBox="0 0 24 24" width="24" height="24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg>`;
export const NAV_ICON = {
  discover: S('<circle class="d" pathLength="1" cx="12" cy="12" r="9"/><circle class="d" pathLength="1" cx="12" cy="12" r="5" opacity=".6"/><g class="ni-sweep"><path d="M12 12 L12 3" stroke-width="2"/><path d="M12 12 L12 3 A9 9 0 0 1 18.4 5.6 Z" fill="currentColor" stroke="none" opacity=".22"/></g><circle class="ni-blip" cx="16" cy="9" r="1.3" fill="currentColor" stroke="none"/>', 'ni-discover'),
  inbox: S('<rect class="d" pathLength="1" x="3" y="6" width="18" height="13" rx="2"/><path class="d" pathLength="1" d="M3.5 7 12 13.5 20.5 7"/><circle class="ni-dot" cx="19.5" cy="6" r="2.6" fill="var(--hot,#ff2bd6)" stroke="none"/>', 'ni-inbox'),
  profile: S('<circle class="d" pathLength="1" cx="12" cy="9" r="3.6"/><path class="d" pathLength="1" d="M5.5 19.5c1.2-3.4 3.7-5 6.5-5s5.3 1.6 6.5 5"/><circle class="ni-ring" cx="12" cy="12" r="10.3" stroke-dasharray="4 3.2" stroke-width="1.1" opacity=".75"/>', 'ni-profile'),
  shop: S('<path class="d" pathLength="1" d="M5 8h14l-1.2 11.2a1.5 1.5 0 0 1-1.5 1.3H7.7a1.5 1.5 0 0 1-1.5-1.3Z"/><path class="d" pathLength="1" d="M9 8V6.5a3 3 0 0 1 6 0V8"/><path class="ni-glint" d="M8 18 15.5 10.5" stroke="#fff" stroke-width="1.4" opacity="0"/><path class="ni-spark" d="M18.5 3.5v3M17 5h3" stroke-width="1.3"/>', 'ni-shop'),
  help: S('<rect class="d" pathLength="1" x="4" y="7" width="16" height="12" rx="3"/><path class="d" pathLength="1" d="M12 7V4M12 3.5h.01"/><g class="ni-eyes"><circle cx="9" cy="13" r="1.4" fill="currentColor"/><circle cx="15" cy="13" r="1.4" fill="currentColor"/></g><path class="d" pathLength="1" d="M2 12v3M22 12v3"/>', 'ni-help'),
  arcade: S('<rect class="d" pathLength="1" x="3" y="3" width="18" height="18" rx="2"/><path class="d" pathLength="1" d="M3 12h18M12 3v18" opacity=".45"/><path class="d ni-snake" pathLength="1" d="M6 7.5h4v4h4v4h4"/><circle class="ni-blip" cx="18" cy="15.5" r="1.4" fill="currentColor" stroke="none"/>', 'ni-arcade'),
  roulette: S('<circle class="d" pathLength="1" cx="12" cy="12" r="9"/><path class="d" pathLength="1" d="M8 9.5a2 2 0 1 0 0 .01M16 14.5a2 2 0 1 0 0 .01"/><g class="ni-sweep"><path d="M7 16.5 17 7.5" stroke-width="1.4"/><path d="M14 7.5h3v3" stroke-width="1.4"/></g>', 'ni-roulette'),
  friends: S('<circle class="d" pathLength="1" cx="9" cy="8" r="3.2"/><path class="d" pathLength="1" d="M3 20c0-3.6 2.7-6 6-6s6 2.4 6 6"/><circle class="d" pathLength="1" cx="17" cy="9" r="2.4" opacity=".7"/><path class="d" pathLength="1" d="M15.5 14.2c2.9-.4 5.5 1.6 5.5 4.8" opacity=".7"/><circle class="ni-blip" cx="20" cy="5" r="1.4" fill="currentColor" stroke="none"/>', 'ni-friends'),
  brawl: S('<path class="d" pathLength="1" d="M13 2 5 13h6l-1 9 8-12h-6Z"/><circle class="ni-blip" cx="19" cy="5" r="1.4" fill="currentColor" stroke="none"/>', 'ni-brawl'),
  dev: S('<path class="d" pathLength="1" d="M14.5 5.5a4 4 0 0 0-5 5L4 16l4 4 5.5-5.5a4 4 0 0 0 5-5l-2.5 2.5-2.5-.5-.5-2.5Z"/>', 'ni-dev'),
};
let lastTab = null; // activate animation only when the selected tab actually changes (nav re-renders often)
export function navIcon(t, on) { const changed = on && lastTab !== t; if (on) lastTab = t; return `<span class="nic${changed ? ' act' : ''}">${NAV_ICON[t] || ''}</span>`; }
// Mode icons for inbox rows: same neon line-art style (stroke = currentColor = theme), animated idle loops in style.css
// (.mi-*), disabled under prefers-reduced-motion. Labeled for screen readers.
const M = (body, cls, label) => `<span class="mode-ic" role="img" aria-label="${label}"><svg class="ni mi ${cls}" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${body}</svg></span>`;
export const MODE_ICON = {
  gaming: M('<path class="d" pathLength="1" d="M7 9h10a4 4 0 0 1 3.9 4.9l-.6 2.6a2 2 0 0 1-3.4.9L15 15.5H9l-1.9 1.9a2 2 0 0 1-3.4-.9l-.6-2.6A4 4 0 0 1 7 9Z"/><path d="M8 11.5v3M6.5 13h3"/><circle class="mi-btn" cx="15.5" cy="12" r=".9" fill="currentColor"/><circle class="mi-btn b2" cx="17.3" cy="13.6" r=".9" fill="currentColor"/>', 'mi-gaming', 'Gaming'),
  dating: M('<path class="d mi-beat" pathLength="1" d="M12 20s-7-4.4-7-9.6A4 4 0 0 1 12 8a4 4 0 0 1 7 2.4C19 15.6 12 20 12 20Z"/>', 'mi-dating', 'Dating'),
  friends: M('<path class="d" pathLength="1" d="M3 12l3-3 3 1 3-2 3 2 3-1 3 3"/><path class="d mi-shake" pathLength="1" d="M6 12l4 4a1.5 1.5 0 0 0 2.1 0l.4-.4M9 13l3 3M11 12l3 3a1.5 1.5 0 0 0 2.1-2.1L13 10"/>', 'mi-friends', 'Friends'),
};
