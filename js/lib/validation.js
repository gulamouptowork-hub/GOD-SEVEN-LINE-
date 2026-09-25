import { SITE_CONFIG, deliveryOption } from '../../config/site.js';

// Telefones aceites:
//  • Moçambique, com ou sem indicativo (+258 / 00258 / 258): móvel 8[2-7] + 7 dígitos, fixo 2 + 7 dígitos.
//  • Internacionais válidos em formato E.164, escritos com "+" ou "00" (8 a 15 dígitos).
const MZ_LOCAL = /^(?:8[2-7]\d{7}|2\d{7})$/;

export function phoneDigits(value) {
  return String(value ?? '').replace(/[^\d+]/g, '').replace(/(?!^)\+/g, '');
}

export function parsePhone(value) {
  const compact = phoneDigits(value);
  if (!compact) return null;
  let international = null;
  if (compact.startsWith('+')) international = compact.slice(1);
  else if (compact.startsWith('00')) international = compact.slice(2);
  else if (compact.startsWith('258') && compact.length > 9) international = compact;

  if (international === null) {
    return MZ_LOCAL.test(compact) ? { country: 'MZ', national: compact, e164: `258${compact}` } : null;
  }
  if (international.startsWith('258')) {
    const national = international.slice(3);
    return MZ_LOCAL.test(national) ? { country: 'MZ', national, e164: international } : null;
  }
  return /^[1-9]\d{7,14}$/.test(international) ? { country: 'INTL', national: international, e164: international } : null;
}

export function isValidPhone(value) {
  return parsePhone(value) !== null;
}

// "841234567" → "84 123 4567"; internacionais → "+27 821234567" (sem adivinhar agrupamentos).
export function formatPhone(value) {
  const phone = parsePhone(value);
  if (!phone) return String(value ?? '').trim();
  if (phone.country === 'MZ') {
    const n = phone.national;
    const local = `${n.slice(0, 2)} ${n.slice(2, 5)} ${n.slice(5)}`; // 84 123 4567 · 21 123 456
    return String(value).trim().startsWith('+') || phoneDigits(value).startsWith('00') ? `+258 ${local}` : local;
  }
  return `+${phone.e164}`;
}

// Número para links wa.me (apenas dígitos, com indicativo).
export function whatsappDigits(value) {
  return parsePhone(value)?.e164 ?? '';
}

export const LIMITS = Object.freeze({ name: 80, location: 120, notes: 500 });

const clean = value => String(value ?? '').replace(/\s+/g, ' ').trim();

export function validateCustomer(input = {}) {
  const value = {
    name: clean(input.name),
    phone: clean(input.phone),
    location: clean(input.location),
    deliveryType: String(input.deliveryType ?? ''),
    notes: String(input.notes ?? '').trim()
  };
  const errors = {};
  if (!value.name) errors.name = 'Indica o teu nome.';
  else if (value.name.length < 2) errors.name = 'O nome parece demasiado curto.';
  else if (value.name.length > LIMITS.name) errors.name = `Usa no máximo ${LIMITS.name} caracteres.`;

  if (!value.phone) errors.phone = 'Indica o teu telefone.';
  else if (!isValidPhone(value.phone)) errors.phone = 'Número inválido. Usa o formato 84 123 4567 ou inclui o indicativo (ex.: +27 …).';

  const option = deliveryOption(value.deliveryType);
  if (!option) errors.deliveryType = 'Escolhe a forma de entrega.';
  if (option?.requiresLocation && !value.location) errors.location = 'Indica a localização ou bairro para a entrega.';
  if (value.location.length > LIMITS.location) errors.location = `Usa no máximo ${LIMITS.location} caracteres.`;
  if (value.notes.length > LIMITS.notes) errors.notes = `Usa no máximo ${LIMITS.notes} caracteres.`;

  return { valid: Object.keys(errors).length === 0, errors, value };
}

export const DEFAULT_DELIVERY = SITE_CONFIG.deliveryOptions[0].id;
