// Modos de vuelo: cada uno respeta sus límites, y ATTI se comporta como un dron sin GPS.

import { describe, expect, it } from 'vitest';
import { modesConfig, type FlightModeName } from '../src/core/config';
import { neutralSticks, noActions, type ControlInput, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { ModeBlender, nextMode, parseModeName } from '../src/control/modes';
import { tiltOf } from '../src/physics/drone';

const DEG = Math.PI / 180;

function input(sticks: Partial<Sticks> = {}, takeoffLand = false): ControlInput {
  return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), takeoffLand } };
}

function hold(sim: Simulation, seconds: number, sticks: Partial<Sticks> = {}): void {
  simulate(sim, seconds, () => input(sticks));
}

function takenOff(mode: FlightModeName): Simulation {
  const sim = new Simulation(mode);
  simulate(sim, 1 / 240, () => input({}, true));
  hold(sim, 6);
  return sim;
}

function speed(sim: Simulation): number {
  return Math.hypot(sim.state.velocity.x, sim.state.velocity.z);
}

/** Vuela con el stick adelante a fondo y devuelve la inclinación máxima alcanzada. */
function flyForward(sim: Simulation, seconds: number): number {
  let maxTilt = 0;
  simulate(sim, seconds, () => {
    maxTilt = Math.max(maxTilt, tiltOf(sim.state.orientation));
    return input({ pitch: 1 });
  });
  return maxTilt;
}

describe('límites de cada modo con GPS', () => {
  it('Cine: va a ~6 m/s sin pasar de 15°', () => {
    const sim = takenOff('cine');
    const maxTilt = flyForward(sim, 10);
    expect(speed(sim)).toBeCloseTo(modesConfig.cine.maxSpeed, 0);
    expect(maxTilt).toBeLessThan(modesConfig.cine.maxTilt + 1 * DEG);
  });

  it('Sport: supera los 15 m/s sin pasar de 35°', () => {
    const sim = takenOff('sport');
    sim.state.position.z = 150; // lejos del límite de distancia (ver el test de cambio de modo)
    const maxTilt = flyForward(sim, 12);
    expect(speed(sim)).toBeGreaterThan(15);
    expect(maxTilt).toBeLessThan(modesConfig.sport.maxTilt + 1 * DEG);
  });

  it('Cine arranca más suave que Sport', () => {
    const cine = takenOff('cine');
    const sport = takenOff('sport');
    hold(cine, 1, { pitch: 1 });
    hold(sport, 1, { pitch: 1 });
    expect(speed(cine)).toBeLessThan(speed(sport) / 2);
  });
});

describe('ATTI (sin GPS)', () => {
  it('con el stick a fondo se inclina a ~25° (pide inclinación, no velocidad)', () => {
    const sim = takenOff('atti');
    const maxTilt = flyForward(sim, 1.5);
    expect(maxTilt).toBeGreaterThan(modesConfig.atti.maxTilt - 2 * DEG);
    expect(maxTilt).toBeLessThan(modesConfig.atti.maxTilt + 1 * DEG);
  });

  it('al soltar el stick se nivela pero sigue deslizándose', () => {
    const sim = takenOff('atti');
    hold(sim, 2, { pitch: 1 });
    const released = speed(sim);
    const position = sim.state.position.clone();
    hold(sim, 2);
    expect(tiltOf(sim.state.orientation)).toBeLessThan(2 * DEG);
    expect(speed(sim)).toBeGreaterThan(released * 0.5); // solo lo frena el aire
    expect(sim.state.position.distanceTo(position)).toBeGreaterThan(5); // no vuelve atrás
  });

  it('mantiene la altura aunque no tenga GPS', () => {
    const sim = takenOff('atti');
    const altitude = sim.altitude;
    hold(sim, 3, { pitch: 0.6, roll: -0.4 });
    hold(sim, 2);
    expect(Math.abs(sim.altitude - altitude)).toBeLessThan(0.3);
  });

  it('sin tocar nada (y sin viento) se queda quieto', () => {
    const sim = takenOff('atti');
    const position = sim.state.position.clone();
    hold(sim, 5);
    expect(sim.state.position.distanceTo(position)).toBeLessThan(0.1);
  });
});

describe('cambio de modo en vuelo', () => {
  it('de ATTI deslizándose a Normal: frena y mantiene el punto', () => {
    const sim = takenOff('atti');
    hold(sim, 2, { pitch: 1 });
    sim.setMode('normal');
    hold(sim, 6);
    expect(speed(sim)).toBeLessThan(0.1);
    const stopped = sim.state.position.clone();
    hold(sim, 3);
    expect(sim.state.position.distanceTo(stopped)).toBeLessThan(0.3);
  });

  it('de Sport a toda velocidad a Cine: la inclinación no se dispara', () => {
    const sim = takenOff('sport');
    // Empieza 150 m detrás del despegue: así el vuelo recto no llega al límite de distancia
    sim.state.position.z = 150;
    flyForward(sim, 8);
    sim.setMode('cine');
    let maxTilt = 0;
    simulate(sim, 4, () => {
      maxTilt = Math.max(maxTilt, tiltOf(sim.state.orientation));
      return input({ pitch: 1 });
    });
    expect(maxTilt).toBeLessThan(modesConfig.sport.maxTilt + 1 * DEG);
    hold(sim, 10, { pitch: 1 });
    expect(speed(sim)).toBeCloseTo(modesConfig.cine.maxSpeed, 0);
  });
});

describe('utilidades de modos', () => {
  it('nextMode recorre Cine → Normal → Sport → ATTI → Cine', () => {
    expect(nextMode('cine')).toBe('normal');
    expect(nextMode('sport')).toBe('atti');
    expect(nextMode('atti')).toBe('cine');
  });

  it('parseModeName acepta solo modos conocidos', () => {
    expect(parseModeName('atti')).toBe('atti');
    expect(parseModeName('manual')).toBeNull();
    expect(parseModeName(null)).toBeNull();
  });

  it('ModeBlender llega a los límites nuevos de forma gradual y cambia el GPS al instante', () => {
    const blender = new ModeBlender(modesConfig.sport);
    const first = blender.update(modesConfig.atti, 0.1);
    expect(first.positionHold).toBe(false);
    expect(first.maxSpeed).toBeLessThan(modesConfig.sport.maxSpeed);
    expect(first.maxSpeed).toBeGreaterThan(modesConfig.atti.maxSpeed);
    for (let i = 0; i < 100; i++) blender.update(modesConfig.atti, 0.1);
    expect(blender.current.maxSpeed).toBeCloseTo(modesConfig.atti.maxSpeed);
  });
});
