// Acro: rates estilo Betaflight, throttle híbrido, sin auto-nivelado, flips y vuelta a Normal.

import { Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { acroConfig, droneConfig, simConfig } from '../src/core/config';
import { neutralSticks, noActions, type ControlInput, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { acroRate, acroThrust, maxAcroRate } from '../src/control/acro';
import { nextMode, parseModeName } from '../src/control/modes';
import { tiltOf } from '../src/physics/drone';

const DEG = Math.PI / 180;
const DT = 1 / simConfig.physicsHz;

function input(sticks: Partial<Sticks> = {}, takeoffLand = false): ControlInput {
  return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), takeoffLand } };
}

/** Componente vertical del "arriba" del dron: 1 nivelado, −1 boca abajo */
function upright(sim: Simulation): number {
  return new Vector3(0, 1, 0).applyQuaternion(sim.state.orientation).y;
}

/** Dron en Acro, en el aire y quieto */
function flyingAcro(altitude = 15): Simulation {
  const sim = new Simulation('acro');
  sim.spawnFlying({ x: 0, altitude, z: 0, heading: 0 });
  return sim;
}

/** Paso a paso con unos sticks mientras se cumpla la condición (con un límite de tiempo) */
function stepWhile(sim: Simulation, sticks: Partial<Sticks>, condition: () => boolean, maxSeconds = 3): void {
  for (let t = 0; t < maxSeconds && condition(); t += DT) sim.step(DT, input(sticks));
}

/** Flip hacia delante como lo haría un piloto: gas cortado y stick a fondo hasta volver a estar nivelado */
function frontFlip(sim: Simulation): void {
  stepWhile(sim, { pitch: 1, throttle: -1 }, () => upright(sim) > -0.9); // hasta boca abajo
  stepWhile(sim, { pitch: 1, throttle: -1 }, () => upright(sim) < 0.97); // y de vuelta arriba
}

describe('rates de Acro (Betaflight)', () => {
  const rates = { rcRate: 1, superRate: 0.6, expo: 0 };

  it('centro: 0; cerca del centro, 200 °/s por unidad de stick (RC rate 1)', () => {
    expect(acroRate(0, rates)).toBe(0);
    expect(acroRate(0.01, rates) / 0.01).toBeCloseTo(200 * DEG, 0);
  });

  it('a fondo: 200 · RC rate / (1 − super rate) °/s, simétrico', () => {
    expect(maxAcroRate(rates) / DEG).toBeCloseTo(500);
    expect(acroRate(-1, rates)).toBeCloseTo(-acroRate(1, rates));
  });

  it('la expo suaviza el centro sin cambiar el máximo', () => {
    const withExpo = { ...rates, expo: 0.5 };
    expect(acroRate(0.3, withExpo)).toBeLessThan(acroRate(0.3, rates));
    expect(maxAcroRate(withExpo)).toBeCloseTo(maxAcroRate(rates));
  });
});

describe('throttle híbrido', () => {
  it('centro = hover; arriba hasta el máximo de los motores; abajo hasta 0', () => {
    expect(acroThrust(0)).toBeCloseTo(droneConfig.mass * simConfig.gravity);
    expect(acroThrust(1)).toBeCloseTo(4 * droneConfig.maxThrustPerMotor);
    expect(acroThrust(-1)).toBe(0);
  });
});

describe('vuelo en Acro', () => {
  it('modo elegible por URL, y el botón de modo vuelve a Normal', () => {
    expect(parseModeName('acro')).toBe('acro');
    expect(nextMode('acro')).toBe('normal');
  });

  it('el despegue automático funciona (se nivela) y con los sticks centrados se queda casi quieto', () => {
    const sim = new Simulation('acro');
    simulate(sim, DT, () => input({}, true));
    simulate(sim, 5, () => input());
    expect(sim.phase).toBe('flying');
    expect(sim.altitude).toBeGreaterThan(1);
    simulate(sim, 2, () => input());
    expect(Math.abs(sim.state.velocity.y)).toBeLessThan(0.3);
    expect(tiltOf(sim.state.orientation)).toBeLessThan(2 * DEG);
  });

  it('sin auto-nivelado: tras un toque de stick adelante se queda inclinado y acelera', () => {
    const sim = flyingAcro();
    simulate(sim, 0.2, () => input({ pitch: 0.3 }));
    const tilt = tiltOf(sim.state.orientation);
    expect(tilt).toBeGreaterThan(5 * DEG);
    simulate(sim, 1, () => input());
    // Con los sticks soltados sigue igual de inclinado, avanzando hacia el morro (−Z)
    expect(tiltOf(sim.state.orientation)).toBeCloseTo(tilt, 1);
    expect(sim.state.velocity.z).toBeLessThan(-1);
  });

  it('inclinado, con el throttle en el centro, pierde altura (hay que dar gas en los giros)', () => {
    const sim = flyingAcro();
    simulate(sim, 0.15, () => input({ roll: 0.5 }));
    simulate(sim, 1.5, () => input());
    expect(sim.state.velocity.y).toBeLessThan(-0.5);
  });

  it('flip hacia delante: da la vuelta en menos de un segundo y acaba nivelado', () => {
    const sim = flyingAcro();
    const start = sim.time;
    frontFlip(sim);
    expect(sim.time - start).toBeLessThan(1);
    expect(upright(sim)).toBeGreaterThan(0.95);
    expect(sim.altitude).toBeGreaterThan(10);
    expect(sim.crash).toBeNull();
  });

  it('el giro es el de los rates: a fondo, ~500 °/s', () => {
    const sim = flyingAcro();
    simulate(sim, 0.3, () => input({ roll: 1 }));
    // El lazo de velocidad angular es solo P (ki = 0): se queda ~1 % por debajo del objetivo
    const ratio = sim.state.angularVelocity.length() / maxAcroRate(acroConfig.rollPitch);
    expect(ratio).toBeGreaterThan(0.97);
    expect(ratio).toBeLessThan(1.01);
  });

  it('botón de pánico: boca abajo, pasar a Normal lo endereza y mantiene la altura', () => {
    const sim = flyingAcro(20);
    stepWhile(sim, { roll: 1, throttle: -1 }, () => upright(sim) > -0.9);
    sim.setMode('normal');
    simulate(sim, 1.5, () => input());
    expect(tiltOf(sim.state.orientation)).toBeLessThan(10 * DEG);
    simulate(sim, 4, () => input());
    expect(tiltOf(sim.state.orientation)).toBeLessThan(2 * DEG);
    expect(Math.abs(sim.state.velocity.y)).toBeLessThan(0.2);
    expect(sim.crash).toBeNull();
  });

  it('tocar el suelo boca abajo es crash aunque sea despacio', () => {
    const sim = flyingAcro(1.5);
    stepWhile(sim, { roll: 1, throttle: -1 }, () => upright(sim) > -0.5);
    simulate(sim, 2, () => input({ throttle: -1 }));
    expect(sim.crash?.target).toBe('vuelco');
  });
});
