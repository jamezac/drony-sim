import { describe, expect, it } from 'vitest';
import {
  applyReport,
  createSpaceMouseState,
  normalizeAxis,
  REPORT_BUTTONS,
  REPORT_ROTATION,
  REPORT_TRANSLATION,
} from '../src/input/spaceMouseReport';

function int16Report(...values: number[]): DataView {
  const view = new DataView(new ArrayBuffer(values.length * 2));
  values.forEach((v, i) => view.setInt16(i * 2, v, true));
  return view;
}

describe('applyReport', () => {
  it('lee los 6 ejes de un report combinado de 12 bytes', () => {
    const state = applyReport(createSpaceMouseState(), REPORT_TRANSLATION, int16Report(10, -20, 30, -40, 50, -60));
    expect(state.axes).toEqual({ tx: 10, ty: -20, tz: 30, rx: -40, ry: 50, rz: -60 });
  });

  it('con un report de traslación de 6 bytes conserva la rotación anterior', () => {
    let state = applyReport(createSpaceMouseState(), REPORT_ROTATION, int16Report(1, 2, 3));
    state = applyReport(state, REPORT_TRANSLATION, int16Report(-350, 0, 350));
    expect(state.axes).toEqual({ tx: -350, ty: 0, tz: 350, rx: 1, ry: 2, rz: 3 });
  });

  it('lee la máscara de botones', () => {
    const data = new DataView(new Uint8Array([0b01, 0b10]).buffer);
    const state = applyReport(createSpaceMouseState(), REPORT_BUTTONS, data);
    expect(state.buttons).toBe(0b10_0000_0001);
  });

  it('no muta el estado original', () => {
    const original = createSpaceMouseState();
    applyReport(original, REPORT_TRANSLATION, int16Report(5, 5, 5));
    expect(original.axes.tx).toBe(0);
  });
});

describe('normalizeAxis', () => {
  it('escala y recorta a -1..1', () => {
    expect(normalizeAxis(175, 350)).toBe(0.5);
    expect(normalizeAxis(-700, 350)).toBe(-1);
    expect(normalizeAxis(700, 350)).toBe(1);
  });
});
