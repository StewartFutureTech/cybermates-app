// Public Supabase config for Cybermates (project dapocxyyrexemnmpzzsr, us-east-1).
// The publishable/anon key is PUBLIC by design: every table is RLS-protected (see supabase/migrations).
// NEVER put the service_role / secret key here or in any VITE_* var — scripts/smoke-supa-adapter.mjs fails the build if one appears.
const env = (typeof import.meta !== 'undefined' && import.meta.env) || {};
export const SUPABASE_URL = env.VITE_SUPABASE_URL || 'https://dapocxyyrexemnmpzzsr.supabase.co';
export const SUPABASE_PUBLISHABLE_KEY = env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Ix4T-XAJZbVDyZLDJrG-fQ_cp6NSnvc';
// Where magic links land. Must be listed in Auth > URL Configuration > Redirect URLs.
export const AUTH_REDIRECT = env.VITE_AUTH_REDIRECT || (globalThis.location ? globalThis.location.origin + '/' : 'https://cybermates-stewart-future-tech.vercel.app/');
export const MESSAGE_HOLD_DAYS = 7, MAX_PHOTOS = 4, MAX_INTERESTS = 20;
export const PARENT_FEATURES = ['messages', 'friends', 'voice', 'lfg', 'events', 'photos', 'matching', 'presence'];
