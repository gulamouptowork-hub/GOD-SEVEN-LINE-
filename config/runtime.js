// Configuração de execução. Em produção este ficheiro é REESCRITO pelo build (scripts/build.js)
// a partir das variáveis de ambiente SUPABASE_URL, SUPABASE_ANON_KEY e WHATSAPP_NUMBER.
// Valores vazios = modo local (catálogo de data/products.json, pedidos guardados só no dispositivo).
// Nunca colocar aqui a service_role key do Supabase.
export const RUNTIME_CONFIG = Object.freeze({
  supabaseUrl: '',
  supabaseAnonKey: '',
  whatsappNumber: '',
  demo: false
});
