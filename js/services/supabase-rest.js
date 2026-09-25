// Cliente mínimo para a API REST do Supabase (PostgREST) usado pela loja pública.
// Usa apenas a anon key (pública por natureza); as permissões reais são garantidas por RLS
// e pela função create_order (ver supabase/schema.sql). O admin usa o supabase-js completo.
import { runtime } from './runtime.js';

export class ServiceError extends Error {
  constructor(code, message, details = null) {
    super(message);
    this.name = 'ServiceError';
    this.code = code;
    this.details = details;
  }
}

export async function supabaseRequest(path, { method = 'GET', body, headers = {}, timeout = 10000 } = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeout);
  try {
    const response = await fetch(`${runtime.supabaseUrl}/rest/v1/${path}`, {
      method,
      headers: {
        apikey: runtime.supabaseAnonKey,
        // As anon keys antigas são JWT (eyJ…) e vão também no Authorization; as novas sb_publishable_… só no apikey.
        ...(runtime.supabaseAnonKey.startsWith('eyJ') ? { Authorization: `Bearer ${runtime.supabaseAnonKey}` } : {}),
        'Content-Type': 'application/json',
        Accept: 'application/json',
        ...headers
      },
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: controller.signal
    });
    const text = await response.text();
    const data = text ? JSON.parse(text) : null;
    if (!response.ok) {
      // Erros levantados pela create_order chegam como { code, message, details, hint }.
      throw new ServiceError(data?.message || `HTTP_${response.status}`, data?.details || data?.hint || 'Pedido ao servidor falhou.', data);
    }
    return data;
  } catch (error) {
    if (error instanceof ServiceError) throw error;
    if (error.name === 'AbortError') throw new ServiceError('TIMEOUT', 'O servidor demorou demasiado a responder.');
    throw new ServiceError('NETWORK', 'Sem ligação ao servidor. Verifica a tua internet.');
  } finally {
    clearTimeout(timer);
  }
}

export const supabaseRpc = (fn, args) => supabaseRequest(`rpc/${fn}`, { method: 'POST', body: args });
