// Identificadores de pedido.
//  • Com backend (Supabase): número sequencial atribuído pela base de dados → GSL-0047.
//  • Sem backend: identificador temporário GSL-AAMMDD-XXXX, com sufixo criptograficamente aleatório.
//    Não é sequencial nem garante unicidade global — é apenas uma referência para a conversa no WhatsApp.
const ALPHABET = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ'; // sem 0/O/1/I para ler facilmente ao telefone

export function formatOrderNumber(sequence) {
  const number = Number(sequence);
  if (!Number.isInteger(number) || number < 1) throw new RangeError('Sequência de pedido inválida.');
  return `GSL-${String(number).padStart(4, '0')}`;
}

export function createLocalOrderNumber(date = new Date(), randomValues = bytes => globalThis.crypto.getRandomValues(bytes)) {
  const pad = value => String(value).padStart(2, '0');
  const stamp = `${String(date.getFullYear()).slice(2)}${pad(date.getMonth() + 1)}${pad(date.getDate())}`;
  const bytes = randomValues(new Uint8Array(4));
  const suffix = Array.from(bytes, byte => ALPHABET[byte % ALPHABET.length]).join('');
  return `GSL-${stamp}-${suffix}`;
}

export function isLocalOrderNumber(value) {
  return /^GSL-\d{6}-[2-9A-HJ-NP-Z]{4}$/.test(String(value));
}
