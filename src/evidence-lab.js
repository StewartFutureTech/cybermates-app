// v45 TEST HOOK (admin/dev builds only; see app-mesh.js): lets the browser e2e (scripts/e2e-csam.mjs) drive the REAL report flow
// and moderator review against a stand-in backend. Nothing here bypasses a gate: access rules live in the database.
export * from './evidence.js';
export { useSupabaseBackend, supabaseBackend } from './kv-store.js';
export { reportFlow } from './mesh-ui.js';
export { teamReviewView, modQueueView } from './reports.js';
