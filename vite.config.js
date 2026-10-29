// Default build: code-split so three.js (3D arcade: chess/checkers/connect4/paddles/tron) is LAZY-LOADED only when a 3D
// game opens (own `three-*.js` chunk; the app chunk stays small). CM_SINGLE=1 restores the single-bundle build that
// scripts/inline.mjs needs for dist-single/index.html (`CM_SINGLE=1 npm run build && node scripts/inline.mjs`).
const single = process.env.CM_SINGLE === '1';
const BUILD = process.env.CM_BUILD_ID || new Date().toISOString().replace(/[-:]/g, '').slice(0, 13);
// __APP_BUILD__: terms re-accept per app version. __FTUE_RESET__: testing flag (CM_FTUE_RESET=1) replays every first-time flow.
export default { define: { __APP_BUILD__: JSON.stringify(BUILD), __FTUE_RESET__: JSON.stringify(process.env.CM_FTUE_RESET === '1') }, build: { rollupOptions: { output: single ? { inlineDynamicImports: true } : { manualChunks: id => (id.includes('node_modules/three/') ? 'three' : undefined) } } } };
