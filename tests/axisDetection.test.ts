import { describe, expect, it } from 'vitest';
import { analyzeGesture, GestureTracker, strongestCoupling } from '../src/input/axisDetection';

const trackerConfig = { minPeak: 0.02, restRatio: 0.15, restMs: 400 };

/** Empuja una secuencia de muestras a 60 fps y devuelve el último estado. */
function feed(tracker: GestureTracker, samples: number[][], startMs = 0): string {
  let status = '';
  samples.forEach((axes, i) => (status = tracker.push(axes, startMs + i * 16)));
  return status;
}

describe('GestureTracker', () => {
  it('espera mientras solo hay ruido por debajo del pico mínimo', () => {
    const tracker = new GestureTracker(trackerConfig);
    expect(feed(tracker, [[0, 0.01], [0.005, 0]])).toBe('waiting');
  });

  it('detecta un gesto de escala pequeña (pico 0,04) al soltar durante restMs', () => {
    const tracker = new GestureTracker(trackerConfig);
    const press = [[0, 0, 0.01], [0, 0.002, 0.03], [0, 0.003, 0.04]];
    const release = Array.from({ length: 30 }, () => [0, 0, 0]); // 30 × 16 ms = 480 ms
    expect(feed(tracker, press)).toBe('moving');
    expect(feed(tracker, release, 100)).toBe('done');
    expect(tracker.result()).toMatchObject({ axis: 2, sign: 1 });
  });

  it('no termina si se suelta menos de restMs', () => {
    const tracker = new GestureTracker(trackerConfig);
    feed(tracker, [[-0.9, 0]]);
    expect(feed(tracker, Array.from({ length: 10 }, () => [0, 0]), 100)).toBe('moving');
  });

  it('con escala completa, un valor residual por debajo del 15 % del pico cuenta como suelto', () => {
    const tracker = new GestureTracker(trackerConfig);
    feed(tracker, [[0, -0.95]]);
    expect(feed(tracker, Array.from({ length: 30 }, () => [0, -0.1]), 100)).toBe('done');
    expect(tracker.result()).toMatchObject({ axis: 1, sign: -1 });
  });
});

describe('analyzeGesture', () => {
  it('detecta el eje dominante, su sentido y su máximo', () => {
    const samples = [
      [0, 0, 0],
      [0.05, 0, -0.4],
      [0.1, 0.02, -0.9],
      [0.02, 0, -0.3],
      [0, 0, 0],
    ];
    const result = analyzeGesture(samples, 0.3);
    expect(result).not.toBeNull();
    expect(result?.axis).toBe(2);
    expect(result?.sign).toBe(-1);
    expect(result?.max).toBeCloseTo(0.9);
  });

  it('calcula el acoplamiento relativo al eje dominante', () => {
    const result = analyzeGesture([[0.1, 0.5, -0.2]], 0.3);
    expect(result?.coupling[0]).toBeCloseTo(0.2);
    expect(result?.coupling[1]).toBe(1);
    expect(result?.coupling[2]).toBeCloseTo(0.4);
  });

  it('devuelve null si ningún eje supera el pico mínimo (solo ruido)', () => {
    expect(analyzeGesture([[0.02, -0.1], [0.05, 0.1]], 0.3)).toBeNull();
    expect(analyzeGesture([], 0.3)).toBeNull();
  });
});

describe('strongestCoupling', () => {
  it('devuelve el eje secundario más acoplado', () => {
    const result = analyzeGesture([[0.1, 0.5, -0.2]], 0.3);
    expect(result && strongestCoupling(result)).toEqual({ axis: 2, ratio: expect.closeTo(0.4) });
  });
});
