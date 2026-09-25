import { SITE_CONFIG } from '../../config/site.js';
import { RUNTIME_CONFIG } from '../../config/runtime.js';

export const runtime = Object.freeze({
  supabaseUrl: String(RUNTIME_CONFIG.supabaseUrl || '').replace(/\/$/, ''),
  supabaseAnonKey: String(RUNTIME_CONFIG.supabaseAnonKey || ''),
  whatsappNumber: String(RUNTIME_CONFIG.whatsappNumber || SITE_CONFIG.whatsappNumber).replace(/\D/g, ''),
  demo: Boolean(RUNTIME_CONFIG.demo)
});

export const hasBackend = Boolean(runtime.supabaseUrl && runtime.supabaseAnonKey);
