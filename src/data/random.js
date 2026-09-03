// Generador de números pseudoaleatorios determinista (mulberry32).
// Con la misma semilla produce siempre la misma secuencia, lo que permite
// reproducir un plan diario completo a partir de su `seed`.

/** Convierte cualquier semilla (número o texto) en un entero de 32 bits (xmur3). */
export function hashSeed(seed) {
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  const str = String(seed ?? '');
  let h = 1779033703 ^ str.length;
  for (let i = 0; i < str.length; i++) {
    h = Math.imul(h ^ str.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  return (h ^ (h >>> 16)) >>> 0;
}

/**
 * Crea un RNG con semilla.
 * Métodos: next(), int(min,max), float(min,max), pick(arr), pickMany(arr,n),
 * chance(p), shuffle(arr), weighted([[valor, peso], ...]), fork(etiqueta).
 */
export function createRng(seed = 1) {
  let state = hashSeed(seed) || 0x9e3779b9;

  function next() {
    state = (state + 0x6d2b79f5) | 0;
    let t = Math.imul(state ^ (state >>> 15), 1 | state);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Entero uniforme en [min, max] (ambos incluidos). */
  function int(min, max) {
    if (max < min) [min, max] = [max, min];
    return Math.floor(min + next() * (max - min + 1));
  }

  /** Decimal uniforme en [min, max). */
  function float(min, max) {
    return min + next() * (max - min);
  }

  function pick(arr) {
    if (!arr || arr.length === 0) throw new Error('pick() recibió una lista vacía.');
    return arr[Math.floor(next() * arr.length)];
  }

  /** Copia barajada (Fisher-Yates); no modifica el original. */
  function shuffle(arr) {
    const copy = [...arr];
    for (let i = copy.length - 1; i > 0; i--) {
      const j = Math.floor(next() * (i + 1));
      [copy[i], copy[j]] = [copy[j], copy[i]];
    }
    return copy;
  }

  /** n elementos distintos (o todos si n > largo). */
  function pickMany(arr, n) {
    if (n <= 0) return [];
    return shuffle(arr).slice(0, Math.min(n, arr.length));
  }

  function chance(p) {
    return next() < p;
  }

  /** Elige según pesos: weighted([['a', 70], ['b', 30]]). */
  function weighted(entries) {
    const total = entries.reduce((sum, [, w]) => sum + w, 0);
    if (total <= 0) throw new Error('weighted() necesita pesos positivos.');
    let r = next() * total;
    for (const [value, weight] of entries) {
      r -= weight;
      if (r < 0) return value;
    }
    return entries[entries.length - 1][0];
  }

  /** RNG hijo independiente, derivado de esta semilla y una etiqueta. */
  function fork(label) {
    return createRng(`${seed}::${label}::${int(0, 0x7fffffff)}`);
  }

  return { seed, next, int, float, pick, pickMany, chance, shuffle, weighted, fork };
}
