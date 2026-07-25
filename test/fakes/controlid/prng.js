/**
 * Gerador pseudoaleatório determinístico (mulberry32).
 * Usado para que o dataset de 48.057 logs seja SEMPRE o mesmo para a mesma seed,
 * sem precisar de fixture em disco e sem dependência externa.
 */
function criarPrng(seed = 42) {
  let estado = seed >>> 0;
  return function proximo() {
    estado = (estado + 0x6d2b79f5) >>> 0;
    let t = estado;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

/** Inteiro em [min, max] (inclusive), determinístico. */
function inteiroEntre(prng, min, max) {
  return min + Math.floor(prng() * (max - min + 1));
}

module.exports = { criarPrng, inteiroEntre };
