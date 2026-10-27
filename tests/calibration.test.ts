import { describe, expect, it } from 'vitest';
import { applyCalibration, CalibrationRecorder } from '../src/input/calibration';

describe('applyCalibration', () => {
  const calibration = { center: 0.1, negative: -0.7, positive: 0.9 };

  it('el centro da 0 y cada extremo da ±1, aunque los lados sean asimétricos', () => {
    expect(applyCalibration(0.1, calibration)).toBeCloseTo(0);
    expect(applyCalibration(0.9, calibration)).toBeCloseTo(1);
    expect(applyCalibration(-0.7, calibration)).toBeCloseTo(-1);
    expect(applyCalibration(0.5, calibration)).toBeCloseTo(0.5);
  });

  it('un eje que solo llega a 0,87 (el giro del SpaceMouse) da 1 a fondo', () => {
    expect(applyCalibration(0.87, { center: 0, negative: -0.87, positive: 0.87 })).toBeCloseTo(1);
  });

  it('sin recorrido útil no amplifica el ruido', () => {
    expect(applyCalibration(0.02, { center: 0, negative: -0.01, positive: 0.01 })).toBeCloseTo(0.02);
  });
});

describe('CalibrationRecorder', () => {
  it('el centro es la media de las muestras en reposo', () => {
    const recorder = new CalibrationRecorder();
    recorder.addRestSample([0.02, -0.01]);
    recorder.addRestSample([0.04, -0.03]);
    expect(recorder.center[0]).toBeCloseTo(0.03);
    expect(recorder.center[1]).toBeCloseTo(-0.02);
  });

  it('solo está completa cuando todos los ejes llegan lejos hacia los dos lados', () => {
    const recorder = new CalibrationRecorder();
    recorder.addRestSample([0, 0]);
    recorder.addMotionSample([1, 0.9]);
    recorder.addMotionSample([-0.95, 0]);
    expect(recorder.isComplete(2)).toBe(false); // el eje 1 no ha ido hacia el lado negativo
    recorder.addMotionSample([0, -0.8]);
    expect(recorder.isComplete(2)).toBe(true);
    expect(recorder.result(2)).toEqual([
      { center: 0, negative: -0.95, positive: 1 },
      { center: 0, negative: -0.8, positive: 0.9 },
    ]);
  });

  it('sin muestras de movimiento no está completa', () => {
    const recorder = new CalibrationRecorder();
    recorder.addRestSample([0, 0, 0, 0, 0, 0]);
    expect(recorder.isComplete(6)).toBe(false);
  });
});
