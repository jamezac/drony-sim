import { describe, expect, it } from 'vitest';
import { axisDeviation, axisMagnitude, mostActivePad, pickSpaceMousePad } from '../src/input/spaceMouseGamepad';

// Gamepads reales que ve Chrome en el equipo del usuario (asistente de mapeo, fase 0)
const RECEIVER = '3Dconnexion Universal Receiver (Vendor: 256f Product: c652)';
const realPads = [
  { index: 0, id: RECEIVER, axes: [] },
  { index: 1, id: RECEIVER, axes: [0, 0, 0, 0, 0, 0] },
  { index: 2, id: 'Unknown Gamepad (Vendor: beef Product: 046d)', axes: [0, 0, 0, 0, 0, 0, 0, 0, 0, 1.2857] },
];

describe('pickSpaceMousePad', () => {
  it('elige la interfaz del receptor que tiene los 6 ejes, no la del ratón ni el mando virtual', () => {
    expect(pickSpaceMousePad(realPads)?.index).toBe(1);
  });

  it('devuelve null si no hay SpaceMouse en vez de elegir otro mando', () => {
    expect(pickSpaceMousePad([realPads[0], realPads[2]])).toBeNull();
  });
});

describe('axisDeviation', () => {
  it('resta el valor de reposo: un hat switch quieto (≈1,286) no cuenta como movimiento', () => {
    const rest = [0, 0, 1.2857];
    const deviation = axisDeviation([0, -0.5, 1.2857], rest);
    expect(deviation[0]).toBe(0);
    expect(deviation[1]).toBe(-0.5);
    expect(deviation[2]).toBeCloseTo(0);
    expect(axisMagnitude(deviation)).toBeCloseTo(0.5);
  });

  it('trata como 0 el reposo de los ejes que no lo tienen', () => {
    expect(axisDeviation([0.2, 0.3], [0.1])).toEqual([expect.closeTo(0.1), 0.3]);
  });
});

describe('axisMagnitude', () => {
  it('devuelve el mayor valor absoluto, o 0 sin ejes', () => {
    expect(axisMagnitude([0.1, -0.7, 0.3])).toBeCloseTo(0.7);
    expect(axisMagnitude([])).toBe(0);
  });
});

describe('mostActivePad', () => {
  it('elige el gamepad que se mueve aunque no sea el primero', () => {
    const pads = [
      { index: 0, axes: [] },
      { index: 1, axes: [0, 0, 0, 0, 0, 0] },
      { index: 2, axes: [0, 0, 0.4, 0, 0, 0] },
    ];
    expect(mostActivePad(pads)?.pad.index).toBe(2);
  });

  it('en reposo devuelve el primero con magnitud 0', () => {
    expect(mostActivePad([{ index: 3, axes: [0] }, { index: 4, axes: [0] }])).toEqual({
      pad: { index: 3, axes: [0] },
      magnitude: 0,
    });
  });

  it('sin gamepads devuelve null', () => {
    expect(mostActivePad([])).toBeNull();
  });
});
