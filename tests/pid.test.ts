import { describe, expect, it } from 'vitest';
import { Pid } from '../src/control/pid';

const dt = 0.01;

describe('Pid', () => {
  it('con solo P, la salida es proporcional al error', () => {
    const pid = new Pid({ kp: 2, ki: 0, kd: 0, maxOutput: 100 });
    expect(pid.update(5, 2, dt)).toBeCloseTo(6);
  });

  it('limita la salida a ±maxOutput', () => {
    const pid = new Pid({ kp: 10, ki: 0, kd: 0, maxOutput: 3 });
    expect(pid.update(10, 0, dt)).toBe(3);
    expect(pid.update(-10, 0, dt)).toBe(-3);
  });

  it('el integral elimina el error fijo de una planta con perturbación constante', () => {
    // Planta: x' = u − 1 (una fuerza constante que empuja hacia abajo)
    const pid = new Pid({ kp: 2, ki: 1, kd: 0, maxOutput: 10 });
    let x = 0;
    for (let i = 0; i < 3000; i++) x += (pid.update(1, x, dt) - 1) * dt;
    expect(x).toBeCloseTo(1, 2);
  });

  it('anti-windup: saturado, el integral no se carga y no hay gran sobrepaso', () => {
    const pid = new Pid({ kp: 1, ki: 5, kd: 0, maxOutput: 0.5 });
    let x = 0;
    let max = 0;
    for (let i = 0; i < 4000; i++) {
      x += pid.update(10, x, dt) * dt;
      max = Math.max(max, x);
    }
    expect(x).toBeCloseTo(10, 1);
    expect(max).toBeLessThan(10.5);
  });

  it('derivada sobre la medida: un cambio brusco de objetivo no produce pico de D', () => {
    const pid = new Pid({ kp: 0, ki: 0, kd: 1, maxOutput: 1000 });
    pid.update(0, 0, dt);
    expect(pid.update(100, 0, dt)).toBe(0);
    expect(pid.update(100, 1, dt)).toBeCloseTo(-100);
  });

  it('reset borra el integral y la medida anterior', () => {
    const pid = new Pid({ kp: 0, ki: 1, kd: 0, maxOutput: 100 });
    pid.update(1, 0, 1);
    pid.reset();
    expect(pid.update(0, 0, 1)).toBe(0);
  });
});
