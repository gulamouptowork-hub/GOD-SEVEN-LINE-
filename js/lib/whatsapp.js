// Mensagens e links do WhatsApp. O número vem sempre da configuração central (ver js/services/runtime.js).
import { SITE_CONFIG } from '../../config/site.js';
import { formatPrice } from './format.js';
import { formatPhone } from './validation.js';

export function buildOrderMessage(order, { demo = false } = {}) {
  const lines = [];
  if (demo) lines.push('⚠️ PEDIDO DE TESTE — modo demonstração, ignorar.', '');
  lines.push('Olá! 👋', `Novo pedido — ${SITE_CONFIG.brandName.toUpperCase()}`, '');
  lines.push(`Pedido: #${order.orderNumber}`);
  lines.push(`Cliente: ${order.customer.name}`);
  lines.push(`Telefone: ${formatPhone(order.customer.phone)}`);
  if (order.customer.location) lines.push(`Localização: ${order.customer.location}`);
  lines.push(`Entrega: ${order.customer.deliveryLabel ?? order.customer.deliveryType}`, '');
  lines.push('ITENS', '');
  order.items.forEach((item, index) => {
    lines.push(`${index + 1}. ${item.name}`);
    lines.push(`Cor: ${item.color}`);
    lines.push(`Tamanho: ${item.size || 'Único'}`);
    lines.push(`Quantidade: ${item.quantity}`);
    lines.push(`Preço unitário: ${formatPrice(item.unitPrice)}`);
    lines.push(`Subtotal: ${formatPrice(item.subtotal)}`, '');
  });
  if (order.deliveryFee !== null && order.deliveryFee !== undefined) {
    lines.push(`Subtotal: ${formatPrice(order.subtotal)}`, `Entrega: ${formatPrice(order.deliveryFee)}`);
  }
  lines.push(`TOTAL: ${formatPrice(order.total)}`);
  if (order.customer.notes) lines.push('', 'Observações:', order.customer.notes);
  lines.push('', 'Gostaria de confirmar a disponibilidade deste pedido.');
  return lines.join('\n');
}

export function buildInquiryMessage({ productName, color, size } = {}) {
  const details = [color && `Cor: ${color}`, size && `Tamanho: ${size}`].filter(Boolean).join(' · ');
  return [
    'Olá! 👋',
    `Tenho interesse na peça ${productName} — ${SITE_CONFIG.brandName}.`,
    details,
    'Podem confirmar o preço e a disponibilidade?'
  ].filter(Boolean).join('\n');
}

export function buildWhatsAppURL(number, message = '') {
  const digits = String(number ?? '').replace(/\D/g, '');
  if (!digits) throw new Error('Número de WhatsApp não configurado.');
  return message ? `https://wa.me/${digits}?text=${encodeURIComponent(message)}` : `https://wa.me/${digits}`;
}
