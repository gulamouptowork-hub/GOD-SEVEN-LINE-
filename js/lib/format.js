import { SITE_CONFIG } from '../../config/site.js';

export function isPrice(value) {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

// Agrupamento fixo com ponto (1.250) — não depende do ICU do browser/Node, que para pt-MZ/pt-PT
// não agrupa números de 4 dígitos.
export function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return '';
  const negative = number < 0;
  const [integer, decimals] = Math.abs(number).toFixed(Number.isInteger(number) ? 0 : 2).split('.');
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${negative ? '-' : ''}${grouped}${decimals && decimals !== '00' ? `,${decimals}` : ''}`;
}

// formatPrice(1250) → "1.250 MT". Valores inválidos devolvem o fallback (por omissão '').
export function formatPrice(value, fallback = '') {
  if (!isPrice(value)) return fallback;
  return `${formatNumber(value)} ${SITE_CONFIG.currencyLabel}`;
}

const pad = value => String(value).padStart(2, '0');

export function formatDate(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
}

export function formatDateTime(value) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return `${formatDate(date)} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function pluralize(count, singular, plural) {
  return `${count} ${count === 1 ? singular : plural}`;
}
