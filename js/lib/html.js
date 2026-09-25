const ENTITIES = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };

export function escapeHTML(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ENTITIES[character]);
}

// Constrói atributos a partir de um objeto. false/null/undefined são omitidos; true gera atributo booleano.
export function attrs(map) {
  return Object.entries(map)
    .filter(([, value]) => value !== false && value !== null && value !== undefined)
    .map(([name, value]) => (value === true ? ` ${name}` : ` ${name}="${escapeHTML(value)}"`))
    .join('');
}

export function slugify(value) {
  return String(value ?? '')
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
}

export function normalizeSearch(value) {
  return String(value ?? '').normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().trim();
}
