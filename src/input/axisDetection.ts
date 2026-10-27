// Análisis puro de un gesto grabado: qué eje domina, en qué sentido y cuánto se
// mueven los demás (acoplamiento). Lo usa el asistente de mapeo de devices.html.

export interface GestureResult {
  /** Índice del eje que más se movió */
  axis: number;
  /** Sentido del eje dominante en su pico */
  sign: 1 | -1;
  /** Valor absoluto máximo del eje dominante (0..1) */
  max: number;
  /** Pico de cada eje dividido por el pico del dominante (el dominante vale 1) */
  coupling: number[];
}

/**
 * @param samples una muestra por frame, cada una con el valor de todos los ejes
 * @param minPeak pico mínimo para considerar que hubo gesto; si no se alcanza devuelve null
 */
export function analyzeGesture(samples: readonly (readonly number[])[], minPeak: number): GestureResult | null {
  const axisCount = Math.max(0, ...samples.map((s) => s.length));
  const peaks = new Array<number>(axisCount).fill(0);
  const peakValues = new Array<number>(axisCount).fill(0);

  for (const sample of samples) {
    sample.forEach((value, i) => {
      if (Math.abs(value) > peaks[i]) {
        peaks[i] = Math.abs(value);
        peakValues[i] = value;
      }
    });
  }

  let axis = -1;
  let max = 0;
  peaks.forEach((peak, i) => {
    if (peak > max) {
      max = peak;
      axis = i;
    }
  });
  if (axis < 0 || max < minPeak) return null;

  return {
    axis,
    sign: peakValues[axis] < 0 ? -1 : 1,
    max,
    coupling: peaks.map((peak) => peak / max),
  };
}

export interface GestureTrackerConfig {
  minPeak: number;
  restRatio: number;
  restMs: number;
}

/** waiting: aún no hay gesto · moving: gesto en curso o soltando · done: gesto terminado */
export type GestureStatus = 'waiting' | 'moving' | 'done';

/**
 * Graba un gesto frame a frame y decide cuándo ha terminado: tras superar minPeak,
 * la tapa tiene que volver por debajo de restRatio × pico durante restMs.
 */
export class GestureTracker {
  private readonly config: GestureTrackerConfig;
  private samples: number[][] = [];
  private peak = 0;
  private restSince: number | null = null;

  constructor(config: GestureTrackerConfig) {
    this.config = config;
  }

  reset(): void {
    this.samples = [];
    this.peak = 0;
    this.restSince = null;
  }

  push(axes: readonly number[], nowMs: number): GestureStatus {
    const { minPeak, restRatio, restMs } = this.config;
    this.samples.push([...axes]);
    const magnitude = Math.max(0, ...axes.map(Math.abs));
    this.peak = Math.max(this.peak, magnitude);

    if (this.peak < minPeak) return 'waiting';
    if (magnitude > this.peak * restRatio) {
      this.restSince = null;
      return 'moving';
    }
    this.restSince ??= nowMs;
    return nowMs - this.restSince >= restMs ? 'done' : 'moving';
  }

  result(): GestureResult | null {
    return analyzeGesture(this.samples, this.config.minPeak);
  }
}

/** Eje (distinto del dominante) con más acoplamiento, o null si solo hay un eje. */
export function strongestCoupling(result: GestureResult): { axis: number; ratio: number } | null {
  let best: { axis: number; ratio: number } | null = null;
  result.coupling.forEach((ratio, axis) => {
    if (axis !== result.axis && (!best || ratio > best.ratio)) best = { axis, ratio };
  });
  return best;
}
