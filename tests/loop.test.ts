import { describe, expect, it } from 'vitest';
import { FixedStepLoop } from '../src/core/loop';

describe('FixedStepLoop', () => {
  it('da tantos pasos como caben y guarda el sobrante para el siguiente frame', () => {
    const loop = new FixedStepLoop(0.01, 0.1);
    let steps = 0;
    const alpha = loop.advance(0.035, () => steps++);
    expect(steps).toBe(3);
    expect(alpha).toBeCloseTo(0.5);
    loop.advance(0.005, () => steps++);
    expect(steps).toBe(4);
  });

  it('a 60 fps con física a 240 Hz da 4 pasos por frame de media', () => {
    const loop = new FixedStepLoop(1 / 240, 0.1);
    let steps = 0;
    for (let i = 0; i < 60; i++) loop.advance(1 / 60, () => steps++);
    expect(steps).toBeGreaterThanOrEqual(239);
    expect(steps).toBeLessThanOrEqual(240);
  });

  it('recorta los frames larguísimos para no congelar la página', () => {
    const loop = new FixedStepLoop(0.01, 0.1);
    let steps = 0;
    loop.advance(5, () => steps++);
    expect(steps).toBe(10);
  });

  it('ignora tiempos negativos', () => {
    const loop = new FixedStepLoop(0.01, 0.1);
    let steps = 0;
    loop.advance(-1, () => steps++);
    expect(steps).toBe(0);
  });
});
