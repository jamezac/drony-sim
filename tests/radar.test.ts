import { describe, expect, it } from 'vitest';
import { orientationToPilot } from '../src/ui/radar';

// El piloto está en el origen. Rumbo 0 = morro hacia −Z; π = morro hacia +Z.
describe('orientationToPilot', () => {
  it('dron delante del piloto mirando hacia fuera: cola hacia ti', () => {
    expect(orientationToPilot(0, -20, 0)).toBe('tailIn');
  });

  it('dron delante del piloto mirando hacia él: morro hacia ti (nose-in)', () => {
    expect(orientationToPilot(0, -20, Math.PI)).toBe('noseIn');
  });

  it('girado 90°: de lado', () => {
    expect(orientationToPilot(0, -20, Math.PI / 2)).toBe('side');
  });

  it('a la derecha del piloto mirando hacia él (rumbo +90° = morro hacia −X): nose-in', () => {
    expect(orientationToPilot(20, 0, Math.PI / 2)).toBe('noseIn');
  });

  it('muy cerca del piloto no se clasifica', () => {
    expect(orientationToPilot(0.5, 0.5, 0)).toBe('near');
  });
});
