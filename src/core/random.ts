// Generador de números aleatorios con semilla (mulberry32). Math.random() no se puede repetir:
// con semilla, el mismo vuelo tiene siempre las mismas ráfagas, así que los tests son
// reproducibles y puedes comparar dos intentos de una lección en igualdad de condiciones.

export class Random {
  private state: number;
  private spareGaussian: number | null = null;

  constructor(seed: number) {
    this.state = seed >>> 0;
  }

  /** Uniforme en [0, 1) */
  next(): number {
    this.state = (this.state + 0x6d2b79f5) >>> 0;
    let t = this.state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /** Normal de media 0 y desviación típica 1 (Box-Muller: genera dos valores de cada vez) */
  gaussian(): number {
    if (this.spareGaussian !== null) {
      const spare = this.spareGaussian;
      this.spareGaussian = null;
      return spare;
    }
    const u = 1 - this.next(); // (0, 1]: evita log(0)
    const v = this.next();
    const radius = Math.sqrt(-2 * Math.log(u));
    this.spareGaussian = radius * Math.sin(2 * Math.PI * v);
    return radius * Math.cos(2 * Math.PI * v);
  }
}
