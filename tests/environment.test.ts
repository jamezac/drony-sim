import { describe, expect, it } from 'vitest';
import { batteryConfig, droneConfig, windConfig } from '../src/core/config';
import { Random } from '../src/core/random';
import { Battery } from '../src/physics/battery';
import { groundEffectFactor, Wind } from '../src/physics/environment';

describe('Random', () => {
  it('con la misma semilla da la misma secuencia', () => {
    const a = new Random(42);
    const b = new Random(42);
    for (let i = 0; i < 10; i++) expect(a.next()).toBe(b.next());
  });

  it('la normal tiene media ~0 y desviación ~1', () => {
    const random = new Random(7);
    const values = Array.from({ length: 20000 }, () => random.gaussian());
    const mean = values.reduce((a, b) => a + b) / values.length;
    const variance = values.reduce((a, v) => a + (v - mean) ** 2, 0) / values.length;
    expect(Math.abs(mean)).toBeLessThan(0.03);
    expect(Math.sqrt(variance)).toBeCloseTo(1, 1);
  });
});

describe('Wind', () => {
  it('en calma no hay viento', () => {
    const wind = new Wind('calm');
    for (let i = 0; i < 100; i++) wind.update(0.1);
    expect(wind.velocity.length()).toBe(0);
  });

  it('de media sopla a la velocidad del nivel, en su dirección, con ráfagas de la desviación indicada', () => {
    const wind = new Wind('moderate', 1);
    const { speed, gustStd } = windConfig.levels.moderate;
    let sumX = 0;
    let sumSq = 0;
    const steps = 200000;
    for (let i = 0; i < steps; i++) {
      wind.update(1 / 60);
      sumX += wind.velocity.x;
      sumSq += (wind.velocity.z) ** 2; // la componente z son solo ráfagas (sopla hacia −X)
    }
    expect(sumX / steps).toBeCloseTo(-speed, 0);
    expect(Math.sqrt(sumSq / steps)).toBeCloseTo(gustStd, 0);
  });

  it('reset repite exactamente las mismas ráfagas', () => {
    const wind = new Wind('strong');
    const first = Array.from({ length: 50 }, () => wind.update(0.1).x);
    wind.reset();
    const second = Array.from({ length: 50 }, () => wind.update(0.1).x);
    expect(second).toEqual(first);
  });
});

describe('groundEffectFactor', () => {
  it('pegado al suelo da el máximo y lejos no hace nada', () => {
    expect(groundEffectFactor(0.01)).toBe(droneConfig.groundEffectMax);
    expect(groundEffectFactor(2)).toBeCloseTo(1, 3);
  });

  it('crece al acercarse al suelo', () => {
    expect(groundEffectFactor(0.1)).toBeGreaterThan(groundEffectFactor(0.2));
    expect(groundEffectFactor(0.2)).toBeGreaterThan(1);
  });
});

describe('Battery', () => {
  const hover = (droneConfig.mass * 9.81) / 4;

  it('un hover gasta la batería en ~29 min reales (dividido por el multiplicador)', () => {
    const battery = new Battery();
    const minutes = 29 / batteryConfig.drainMultiplier;
    for (let i = 0; i < minutes * 60 * 10; i++) battery.update([hover, hover, hover, hover], true, 0.1);
    expect(battery.percent).toBeLessThan(5);
    expect(battery.percent).toBeGreaterThanOrEqual(0);
  });

  it('más empuje gasta más que proporcionalmente (P ∝ T^1,5)', () => {
    const slow = new Battery();
    const fast = new Battery();
    slow.update([hover, hover, hover, hover], true, 10);
    fast.update([2 * hover, 2 * hover, 2 * hover, 2 * hover], true, 10);
    const slowUsed = 100 - slow.percent;
    const fastUsed = 100 - fast.percent;
    expect(fastUsed / slowUsed).toBeGreaterThan(2.5);
  });

  it('con los motores parados solo gasta la electrónica, y la tensión baja al pedir potencia', () => {
    const battery = new Battery();
    battery.update([1, 1, 1, 1], false, 1);
    const idleVoltage = battery.voltage;
    battery.update([1.5, 1.5, 1.5, 1.5], true, 0.01);
    expect(battery.voltage).toBeLessThan(idleVoltage);
  });

  it('nunca baja de 0 y entonces está agotada', () => {
    const battery = new Battery(1);
    battery.update([1.5, 1.5, 1.5, 1.5], true, 3600);
    expect(battery.percent).toBe(0);
    expect(battery.depleted).toBe(true);
  });
});
