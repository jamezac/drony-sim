// Vuelos completos con viento, batería, RTH y límites.

import { describe, expect, it } from 'vitest';
import { batteryConfig, droneConfig, limitsConfig, rthConfig, type FlightModeName, type WindLevel } from '../src/core/config';
import { neutralSticks, noActions, type ControlActions, type ControlInput, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { tiltOf } from '../src/physics/drone';

function input(sticks: Partial<Sticks> = {}, actions: Partial<ControlActions> = {}): ControlInput {
  return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), ...actions } };
}

function press(sim: Simulation, actions: Partial<ControlActions>): void {
  simulate(sim, 1 / 240, () => input({}, actions));
}

function hold(sim: Simulation, seconds: number, sticks: Partial<Sticks> = {}): void {
  simulate(sim, seconds, () => input(sticks));
}

function takenOff(mode: FlightModeName = 'normal', wind: WindLevel = 'calm', batteryPercent = 100): Simulation {
  const sim = new Simulation({ mode, wind, batteryPercent });
  press(sim, { takeoffLand: true });
  hold(sim, 6);
  return sim;
}

function horizontalDistance(sim: Simulation): number {
  return Math.hypot(sim.state.position.x, sim.state.position.z);
}

describe('viento', () => {
  it('en Normal mantiene el punto con viento moderado inclinándose contra el viento', () => {
    const sim = takenOff('normal', 'moderate');
    const start = sim.state.position.clone();
    let maxDrift = 0;
    let tiltSum = 0;
    let samples = 0;
    simulate(sim, 20, () => {
      maxDrift = Math.max(maxDrift, Math.hypot(sim.state.position.x - start.x, sim.state.position.z - start.z));
      tiltSum += tiltOf(sim.state.orientation);
      samples++;
      return input();
    });
    expect(maxDrift).toBeLessThan(1);
    expect(tiltSum / samples).toBeGreaterThan(0.05); // inclinado de media: está luchando contra el viento
  });

  it('en ATTI el viento lo arrastra en su dirección (hacia −X)', () => {
    const sim = takenOff('atti', 'moderate');
    const startX = sim.state.position.x;
    hold(sim, 6);
    expect(sim.state.position.x - startX).toBeLessThan(-5);
  });
});

describe('vuelta a casa (RTH)', () => {
  function farAway(): Simulation {
    const sim = takenOff();
    hold(sim, 5, { pitch: 1 }); // ~40 m hacia delante
    hold(sim, 4);
    expect(horizontalDistance(sim)).toBeGreaterThan(rthConfig.nearHomeDistance);
    return sim;
  }

  it('desde lejos: sube a 30 m, vuelve, aterriza en el despegue y para los motores', () => {
    const sim = farAway();
    press(sim, { returnHome: true });
    expect(sim.phase).toBe('returning');
    let maxAltitude = 0;
    simulate(sim, 70, () => {
      maxAltitude = Math.max(maxAltitude, sim.altitude);
      return input();
    });
    expect(maxAltitude).toBeGreaterThan(rthConfig.altitude - 1);
    expect(sim.phase).toBe('disarmed');
    expect(horizontalDistance(sim)).toBeLessThan(1);
    expect(sim.state.position.y).toBeCloseTo(droneConfig.restHeight);
  });

  it('mover los sticks lo cancela', () => {
    const sim = farAway();
    press(sim, { returnHome: true });
    hold(sim, 1);
    hold(sim, 0.1, { roll: 1 });
    expect(sim.phase).toBe('flying');
  });

  it('en ATTI (sin GPS) no hay RTH', () => {
    const sim = takenOff('atti');
    press(sim, { returnHome: true });
    expect(sim.phase).toBe('flying');
  });

  it('con batería al 15 % vuelve sola a casa, aunque salte con un stick pulsado', () => {
    // El despegue gasta ~2 %: empieza con margen para que el RTH salte ya en vuelo
    const sim = takenOff('normal', 'calm', batteryConfig.rthPercent + 5);
    let returned = false;
    simulate(sim, 20, () => {
      returned ||= sim.phase === 'returning';
      return input({ pitch: 0.5 }); // el piloto sigue con el stick adelante
    });
    expect(returned).toBe(true);
    expect(sim.phase).toBe('returning');
  });

  it('el RTH se cancela moviendo los sticks después de soltarlos', () => {
    const sim = takenOff('normal', 'calm', batteryConfig.rthPercent + 5);
    simulate(sim, 20, () => input({ pitch: 0.5 }));
    expect(sim.phase).toBe('returning');
    hold(sim, 0.5);
    hold(sim, 0.1, { pitch: 0.5 });
    expect(sim.phase).toBe('flying');
  });

  it('con batería al 10 % aterriza donde esté y no deja cancelarlo', () => {
    const sim = takenOff('normal', 'calm', batteryConfig.criticalPercent + 0.2);
    hold(sim, 1, { throttle: 1 });
    simulate(sim, 5, () => input({ throttle: 1 })); // intenta subir: no puede cancelar
    expect(sim.forcedLanding || sim.phase === 'disarmed').toBe(true);
    hold(sim, 15, { throttle: 1 });
    expect(sim.phase).toBe('disarmed');
    expect(sim.state.onGround).toBe(true);
  });
});

describe('límites', () => {
  it('no sube de 120 m aunque se mantenga el throttle', () => {
    const sim = takenOff('sport');
    hold(sim, 35, { throttle: 1 });
    expect(sim.altitude).toBeLessThan(limitsConfig.maxAltitude + 0.5);
    expect(sim.altitude).toBeGreaterThan(limitsConfig.maxAltitude - 2);
  });

  it('no se aleja más allá del límite de distancia', () => {
    const sim = takenOff('sport');
    hold(sim, 25, { pitch: 1 });
    expect(horizontalDistance(sim)).toBeLessThan(limitsConfig.maxDistance + 3);
  });

  it('sin batería los motores se paran y el dron cae', () => {
    const sim = takenOff('normal', 'calm', 0.05);
    hold(sim, 4, { throttle: 1 });
    expect(sim.battery.depleted).toBe(true);
    expect(sim.phase).toBe('disarmed');
    expect(sim.state.onGround).toBe(true);
  });
});
