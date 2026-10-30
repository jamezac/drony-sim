// Órbita (POI): da vueltas al punto de delante mirándolo, los sticks la ajustan y se sale con O.

import { describe, expect, it } from 'vitest';
import { orbitConfig, type FlightModeName } from '../src/core/config';
import { neutralSticks, noActions, type ControlActions, type ControlInput, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { headingOf } from '../src/physics/drone';

const DEG = Math.PI / 180;

function input(sticks: Partial<Sticks> = {}, actions: Partial<ControlActions> = {}): ControlInput {
  return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), ...actions } };
}

function press(sim: Simulation, actions: Partial<ControlActions>): void {
  simulate(sim, 1 / 240, () => input({}, actions));
}

function hold(sim: Simulation, seconds: number, sticks: Partial<Sticks> = {}): void {
  simulate(sim, seconds, () => input(sticks));
}

function takenOff(mode: FlightModeName = 'normal'): Simulation {
  const sim = new Simulation(mode);
  press(sim, { takeoffLand: true });
  hold(sim, 6);
  return sim;
}

function orbiting(): Simulation {
  const sim = takenOff();
  press(sim, { orbit: true });
  return sim;
}

/** Distancia al centro de la órbita */
function radiusOf(sim: Simulation): number {
  const { center } = sim.controller.orbit;
  return Math.hypot(sim.state.position.x - center.x, sim.state.position.z - center.z);
}

/** Error entre el rumbo del dron y la dirección al centro (rad) */
function headingErrorToCenter(sim: Simulation): number {
  const { center } = sim.controller.orbit;
  const toCenter = Math.atan2(sim.state.position.x - center.x, sim.state.position.z - center.z);
  const error = toCenter - headingOf(sim.state.orientation);
  return Math.abs(Math.atan2(Math.sin(error), Math.cos(error)));
}

/** Vuela la órbita y devuelve el peor error de radio y de rumbo, y el ángulo recorrido */
function track(sim: Simulation, seconds: number, sticks: Partial<Sticks> = {}) {
  const { center } = sim.controller.orbit;
  const angleOf = () => Math.atan2(sim.state.position.z - center.z, sim.state.position.x - center.x);
  let last = angleOf();
  let turned = 0;
  let radiusError = 0;
  let headingError = 0;
  simulate(sim, seconds, () => {
    const angle = angleOf();
    turned += Math.atan2(Math.sin(angle - last), Math.cos(angle - last));
    last = angle;
    radiusError = Math.max(radiusError, Math.abs(radiusOf(sim) - sim.controller.orbit.radius));
    headingError = Math.max(headingError, headingErrorToCenter(sim));
    return input(sticks);
  });
  return { radiusError, headingError, turned };
}

describe('órbita (POI)', () => {
  it('O en vuelo: rodea un punto 10 m delante del morro', () => {
    const sim = orbiting();
    expect(sim.phase).toBe('orbiting');
    const { center } = sim.controller.orbit;
    // Despega mirando a −Z: el centro queda 10 m hacia −Z
    expect(center.x).toBeCloseTo(0, 1);
    expect(center.z).toBeCloseTo(-orbitConfig.startRadius, 1);
  });

  it('una vuelta completa sin salirse del círculo, mirando siempre al centro y a la misma altura', () => {
    const sim = orbiting();
    const altitude = sim.altitude;
    hold(sim, 3); // arrancar
    const lap = (2 * Math.PI * orbitConfig.startRadius) / orbitConfig.startSpeed;
    const { radiusError, headingError, turned } = track(sim, lap);
    expect(radiusError).toBeLessThan(0.3);
    expect(headingError).toBeLessThan(1 * DEG);
    expect(Math.abs(turned)).toBeGreaterThan(1.8 * Math.PI);
    expect(Math.abs(sim.altitude - altitude)).toBeLessThan(0.1);
  });

  it('rápida: la aceleración centrípeta pedida de antemano mantiene el radio', () => {
    const sim = orbiting();
    hold(sim, 5, { roll: 1 }); // sube la velocidad hasta el límite √(a·R)
    const limit = Math.sqrt(orbitConfig.maxCentripetal * orbitConfig.startRadius);
    expect(sim.controller.orbit.speed).toBeCloseTo(limit, 1);
    hold(sim, 3);
    expect(track(sim, 10).radiusError).toBeLessThan(0.5);
  });

  it('lateral cambia el sentido; avance acerca hasta el radio mínimo (y allí va más despacio)', () => {
    const sim = orbiting();
    hold(sim, 4, { roll: -1 });
    expect(sim.controller.orbit.speed).toBeLessThan(0);
    hold(sim, 15, { pitch: 1 });
    expect(sim.controller.orbit.radius).toBe(orbitConfig.minRadius);
    expect(Math.abs(sim.controller.orbit.speed)).toBeLessThanOrEqual(Math.sqrt(orbitConfig.maxCentripetal * orbitConfig.minRadius));
    hold(sim, 4);
    expect(Math.abs(radiusOf(sim) - orbitConfig.minRadius)).toBeLessThan(0.3);
  });

  it('el throttle sube y baja durante la órbita sin cancelarla', () => {
    const sim = orbiting();
    const altitude = sim.altitude;
    hold(sim, 2, { throttle: 1 });
    expect(sim.phase).toBe('orbiting');
    expect(sim.altitude).toBeGreaterThan(altitude + 3);
  });

  it('O otra vez: sale de la órbita, frena y se queda en el sitio', () => {
    const sim = orbiting();
    hold(sim, 6);
    press(sim, { orbit: true });
    expect(sim.phase).toBe('flying');
    hold(sim, 4);
    expect(Math.hypot(sim.state.velocity.x, sim.state.velocity.z)).toBeLessThan(0.3);
  });

  it('H vuelve a casa y Espacio aterriza desde la órbita', () => {
    const rth = orbiting();
    hold(rth, 2);
    press(rth, { returnHome: true });
    expect(rth.phase).toBe('returning');
    const land = orbiting();
    hold(land, 2);
    press(land, { takeoffLand: true });
    expect(land.phase).toBe('landing');
  });

  it('sin GPS no hay órbita: en ATTI la O no hace nada, y pasar a ATTI la termina', () => {
    const atti = takenOff('atti');
    press(atti, { orbit: true });
    expect(atti.phase).toBe('flying');
    const sim = orbiting();
    sim.setMode('atti');
    hold(sim, 0.1);
    expect(sim.phase).toBe('flying');
  });
});
