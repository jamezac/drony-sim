import { describe, expect, it } from 'vitest';
import { gamepadConfig, spaceMouseGamepadConfig } from '../src/core/config';
import { neutralSticks } from '../src/core/controlInput';
import { rampToward } from '../src/input/keyboard';
import { pickStandardGamepad } from '../src/input/gamepad';
import { applyDeadzone, applyExpo, combineSticks, mapSticks, readAxis } from '../src/input/mapping';

describe('applyDeadzone', () => {
  it('anula lo que cae dentro y reescala sin salto lo de fuera', () => {
    expect(applyDeadzone(0.1, 0.12)).toBe(0);
    expect(applyDeadzone(0.12, 0.12)).toBe(0);
    expect(applyDeadzone(0.13, 0.12)).toBeCloseTo(0.0114, 3);
    expect(applyDeadzone(1, 0.12)).toBe(1);
    expect(applyDeadzone(-1, 0.12)).toBe(-1);
  });
});

describe('applyExpo', () => {
  it('mantiene 0 y ±1 y suaviza el centro', () => {
    expect(applyExpo(0, 0.3)).toBe(0);
    expect(applyExpo(1, 0.3)).toBe(1);
    expect(applyExpo(-1, 0.3)).toBe(-1);
    expect(applyExpo(0.5, 0.3)).toBeLessThan(0.5);
  });
});

describe('readAxis', () => {
  it('escala por fullScale, invierte y recorta a ±1', () => {
    expect(readAxis([0, 0, -1], { axis: 2, invert: true, fullScale: 1 })).toBe(1);
    expect(readAxis([0.85], { axis: 0, invert: false, fullScale: 0.85 })).toBeCloseTo(1);
    expect(readAxis([1], { axis: 0, invert: false, fullScale: 0.5 })).toBe(1);
    expect(readAxis([], { axis: 3, invert: false, fullScale: 1 })).toBe(0);
  });
});

describe('mapSticks con el mapeo medido del SpaceMouse (perfil traslación)', () => {
  const { translation } = spaceMouseGamepadConfig.profiles;
  const shaping = { deadzone: 0, expo: 0 };

  it('subir la tapa (eje 2 negativo) es throttle positivo', () => {
    expect(mapSticks([0, 0, -1, 0, 0, 0], translation, shaping).throttle).toBe(1);
  });

  it('desplazar adelante (eje 1 negativo) es pitch adelante', () => {
    expect(mapSticks([0, -1, 0, 0, 0, 0], translation, shaping).pitch).toBe(1);
  });

  it('desplazar a la derecha (eje 0 positivo) es roll a la derecha', () => {
    expect(mapSticks([1, 0, 0, 0, 0, 0], translation, shaping).roll).toBe(1);
  });

  it('girar en horario (eje 5 positivo, máx ~0,87) da yaw completo', () => {
    expect(mapSticks([0, 0, 0, 0, 0, 0.87], translation, shaping).yaw).toBe(1);
  });

  it('la zona muerta se come el acoplamiento pequeño', () => {
    const sticks = mapSticks([0, 0, -1, 0.1, 0, 0.05], translation, { deadzone: 0.12, expo: 0 });
    expect(sticks).toEqual({ throttle: 1, yaw: 0, pitch: 0, roll: 0 });
  });
});

describe('readAxis con calibración', () => {
  it('usa la calibración del eje en lugar de fullScale', () => {
    const calibration = Array.from({ length: 6 }, () => ({ center: 0, negative: -1, positive: 1 }));
    calibration[5] = { center: 0, negative: -0.87, positive: 0.87 };
    expect(readAxis([0, 0, 0, 0, 0, 0.87], { axis: 5, invert: false, fullScale: 1 }, calibration)).toBeCloseTo(1);
  });
});

describe('mando genérico (mapeo standard)', () => {
  const shaping = { deadzone: 0, expo: 0 };
  // Stick izquierdo arriba (eje 1 = −1) y stick derecho a la derecha (eje 2 = +1)
  const axes = [0, -1, 1, 0];

  it('en Modo 2 el stick izquierdo arriba es altura', () => {
    const sticks = mapSticks(axes, gamepadConfig.modes.mode2, shaping);
    expect(sticks).toEqual({ throttle: 1, yaw: 0, pitch: 0, roll: 1 });
  });

  it('en Modo 1 el stick izquierdo arriba es avance', () => {
    const sticks = mapSticks(axes, gamepadConfig.modes.mode1, shaping);
    expect(sticks).toEqual({ throttle: 0, yaw: 0, pitch: 1, roll: 1 });
  });

  it('elige un mando standard y descarta el SpaceMouse y los mandos sin mapeo', () => {
    const pads = [
      { id: '3Dconnexion Universal Receiver (Vendor: 256f Product: c652)', axes: [0, 0, 0, 0, 0, 0], mapping: 'standard' },
      { id: 'Unknown Gamepad (Vendor: beef Product: 046d)', axes: new Array(10).fill(0), mapping: '' },
      { id: 'Xbox Wireless Controller (STANDARD GAMEPAD)', axes: [0, 0, 0, 0], mapping: 'standard' },
    ];
    expect(pickStandardGamepad(pads)?.id).toContain('Xbox');
    expect(pickStandardGamepad(pads.slice(0, 2))).toBeNull();
  });
});

describe('combineSticks', () => {
  it('en cada stick gana la fuente que más se aparta del centro', () => {
    const keyboard = { ...neutralSticks(), throttle: 1, yaw: 0.2 };
    const spaceMouse = { ...neutralSticks(), yaw: -0.5, pitch: 0.3 };
    expect(combineSticks(keyboard, spaceMouse)).toEqual({ throttle: 1, yaw: -0.5, pitch: 0.3, roll: 0 });
  });

  it('acepta más de dos fuentes (teclado, SpaceMouse y mando)', () => {
    const gamepad = { ...neutralSticks(), roll: -0.8 };
    expect(combineSticks(neutralSticks(), neutralSticks(), gamepad).roll).toBe(-0.8);
  });
});

describe('rampToward (teclado)', () => {
  it('sube a 1 en rampUp segundos y vuelve a 0 más rápido', () => {
    let value = 0;
    for (let i = 0; i < 15; i++) value = rampToward(value, 1, 0.01, 0.3, 0.1);
    expect(value).toBeCloseTo(0.5);
    for (let i = 0; i < 15; i++) value = rampToward(value, 1, 0.01, 0.3, 0.1);
    expect(value).toBe(1);
    for (let i = 0; i < 10; i++) value = rampToward(value, 0, 0.01, 0.3, 0.1);
    expect(value).toBeCloseTo(0);
  });
});
