// Vuelos completos sin navegador: comprueban que el controlador se comporta como un DJI en Normal.

import { describe, expect, it } from 'vitest';
import { droneConfig, flightConfig, modesConfig } from '../src/core/config';
import { neutralSticks, noActions, type ControlActions, type ControlInput, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { headingOf, tiltOf } from '../src/physics/drone';

const DEG = Math.PI / 180;

function input(sticks: Partial<Sticks> = {}, actions: Partial<ControlActions> = {}): ControlInput {
  return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), ...actions } };
}

/** Pulsa una acción durante un único paso (como un botón). */
function press(sim: Simulation, actions: Partial<ControlActions>): void {
  simulate(sim, 1 / 240, () => input({}, actions));
}

function hold(sim: Simulation, seconds: number, sticks: Partial<Sticks> = {}): void {
  simulate(sim, seconds, () => input(sticks));
}

function horizontalSpeed(sim: Simulation): number {
  return Math.hypot(sim.state.velocity.x, sim.state.velocity.z);
}

function takenOff(): Simulation {
  const sim = new Simulation();
  press(sim, { takeoffLand: true });
  hold(sim, 6);
  return sim;
}

describe('despegue y hover', () => {
  it('el despegue automático sube a 1,2 m y queda en vuelo', () => {
    const sim = takenOff();
    expect(sim.phase).toBe('flying');
    expect(sim.altitude).toBeCloseTo(flightConfig.takeoffAltitude, 1);
  });

  it('en hover mantiene la altura (±5 cm) y el punto (±0,3 m) durante 10 s', () => {
    const sim = takenOff();
    const start = sim.state.position.clone();
    let maxAltitudeError = 0;
    let maxDrift = 0;
    simulate(sim, 10, () => {
      maxAltitudeError = Math.max(maxAltitudeError, Math.abs(sim.state.position.y - start.y));
      maxDrift = Math.max(maxDrift, Math.hypot(sim.state.position.x - start.x, sim.state.position.z - start.z));
      return input();
    });
    expect(maxAltitudeError).toBeLessThan(0.05);
    expect(maxDrift).toBeLessThan(0.3);
  });
});

describe('movimiento en modo Normal', () => {
  it('con el stick adelante a fondo alcanza ~10 m/s hacia el morro sin pasar de 25°', () => {
    const sim = takenOff();
    let maxTilt = 0;
    simulate(sim, 8, () => {
      maxTilt = Math.max(maxTilt, tiltOf(sim.state.orientation));
      return input({ pitch: 1 });
    });
    expect(horizontalSpeed(sim)).toBeCloseTo(modesConfig.normal.maxSpeed, 0);
    expect(sim.state.velocity.z).toBeLessThan(-9); // rumbo 0 = morro hacia −Z
    expect(maxTilt).toBeLessThan(modesConfig.normal.maxTilt + 1 * DEG);
    expect(Math.abs(sim.altitude - flightConfig.takeoffAltitude)).toBeLessThan(0.3);
  });

  it('al soltar frena, se para y mantiene el punto', () => {
    const sim = takenOff();
    hold(sim, 6, { pitch: 1 });
    hold(sim, 6);
    expect(horizontalSpeed(sim)).toBeLessThan(0.1);
    const stopped = sim.state.position.clone();
    hold(sim, 5);
    expect(sim.state.position.distanceTo(stopped)).toBeLessThan(0.3);
  });

  it('el roll a la derecha mueve el dron a su derecha (+X con rumbo 0)', () => {
    const sim = takenOff();
    hold(sim, 3, { roll: 1 });
    expect(sim.state.velocity.x).toBeGreaterThan(5);
    expect(Math.abs(sim.state.velocity.z)).toBeLessThan(0.5);
  });

  it('el yaw a la derecha gira en horario a ~60°/s sin desplazarse', () => {
    const sim = takenOff();
    const start = sim.state.position.clone();
    hold(sim, 1, { yaw: 1 });
    hold(sim, 1);
    const turned = -headingOf(sim.state.orientation); // horario = rumbo decreciente
    expect(turned).toBeGreaterThan(50 * DEG);
    expect(turned).toBeLessThan(70 * DEG);
    expect(sim.state.position.distanceTo(start)).toBeLessThan(0.3);
  });

  it('el throttle sube a ~3 m/s y al soltarlo mantiene la nueva altura', () => {
    const sim = takenOff();
    hold(sim, 1.5, { throttle: 1 });
    expect(sim.state.velocity.y).toBeGreaterThan(2.5);
    hold(sim, 3);
    const altitude = sim.altitude;
    hold(sim, 3);
    expect(Math.abs(sim.state.velocity.y)).toBeLessThan(0.05);
    expect(Math.abs(sim.altitude - altitude)).toBeLessThan(0.1);
  });
});

describe('aterrizaje y motores', () => {
  it('el aterrizaje automático baja, se posa y para los motores', () => {
    const sim = takenOff();
    press(sim, { takeoffLand: true });
    hold(sim, 8);
    expect(sim.phase).toBe('disarmed');
    expect(sim.state.onGround).toBe(true);
    expect(sim.state.position.y).toBeCloseTo(droneConfig.restHeight);
  });

  it('a mano: E arranca, throttle despega, throttle abajo posa y lo mantiene abajo para', () => {
    const sim = new Simulation();
    press(sim, { toggleMotors: true });
    expect(sim.phase).toBe('armed');

    hold(sim, 1.5, { throttle: 0.6 });
    expect(sim.phase).toBe('flying');
    expect(sim.altitude).toBeGreaterThan(0.5);

    // Con el throttle abajo: se posa (motores al ralentí) y, si se sigue manteniendo, se paran
    const phases: string[] = [];
    let landedAt = 0;
    simulate(sim, 6, () => {
      if (phases.at(-1) !== sim.phase) {
        phases.push(sim.phase);
        if (sim.phase === 'armed') landedAt = sim.time;
      }
      return input({ throttle: -1 });
    });
    expect(phases).toEqual(['flying', 'armed', 'disarmed']);
    expect(sim.time - landedAt).toBeGreaterThan(flightConfig.disarmHoldSeconds);
  });

  it('parado no se mueve aunque se toquen los sticks', () => {
    const sim = new Simulation();
    hold(sim, 2, { throttle: 1, pitch: 1 });
    expect(sim.phase).toBe('disarmed');
    expect(sim.altitude).toBe(0);
  });
});
