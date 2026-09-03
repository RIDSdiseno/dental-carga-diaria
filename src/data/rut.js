// RUT chileno ficticio pero con dígito verificador válido (módulo 11),
// igual al algoritmo que usa el frontend (utils/rut.ts).

export function computeDv(body) {
  let sum = 0;
  let multiplier = 2;
  const digits = String(body);
  for (let i = digits.length - 1; i >= 0; i--) {
    sum += Number(digits[i]) * multiplier;
    multiplier = multiplier === 7 ? 2 : multiplier + 1;
  }
  const remainder = 11 - (sum % 11);
  return remainder === 11 ? '0' : remainder === 10 ? 'K' : String(remainder);
}

export function formatRut(body, dv) {
  const withDots = String(body).replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${withDots}-${dv}`;
}

/**
 * Genera un RUT aleatorio dentro de un rango de cuerpo.
 * Personas: 6.000.000 – 26.999.999. Empresas: 76.000.000 – 77.999.999.
 */
export function generateRut(kind = 'persona', rng = Math.random) {
  const [min, max] = kind === 'empresa' ? [76000000, 77999999] : [6000000, 26999999];
  const body = Math.floor(min + rng() * (max - min + 1));
  const dv = computeDv(body);
  return { body, dv, clean: `${body}${dv}`, formatted: formatRut(body, dv) };
}

export function isValidRut(rut) {
  const clean = String(rut).replace(/[^0-9kK]/g, '').toUpperCase();
  if (clean.length < 2) return false;
  const body = clean.slice(0, -1);
  const dv = clean.slice(-1);
  if (!/^\d+$/.test(body)) return false;
  return computeDv(body) === dv;
}
