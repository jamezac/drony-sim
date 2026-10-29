import { describe, expect, it } from 'vitest';
import { droneConfig, type FlightModeName } from '../src/core/config';
import { neutralSticks, noActions, type ControlActions, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { collideSphere, describeCrash } from '../src/physics/collisions';
import { buildScenario, nextScenario, parseScenarioName, scenarioColliders, SCENARIO_ORDER } from '../src/scenarios/scenarios';

function input(sticks: Partial<Sticks> = {}, actions: Partial<ControlActions> = {}) {
  return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), ...actions } };
}

function simIn(scenario: Parameters<typeof buildScenario>[0], mode: FlightModeName = 'normal', batteryPercent = 100) {
  const sim = new Simulation({ mode, batteryPercent });
  sim.setColliders(scenarioColliders(buildScenario(scenario).objects));
  return sim;
}

function takeOff(sim: Simulation): void {
  simulate(sim, 1 / 240, () => input({}, { takeoffLand: true }));
  simulate(sim, 5, () => input());
}

describe('escenarios', () => {
  it('son siempre iguales (semilla) y se recorren con N', () => {
    expect(buildScenario('parque')).toEqual(buildScenario('parque'));
    expect(buildScenario('ciudad')).toEqual(buildScenario('ciudad'));
    expect(nextScenario('obstaculos')).toBe('libre');
    expect(parseScenarioName('ciudad')).toBe('ciudad');
    expect(parseScenarioName('luna')).toBeNull();
  });

  it('en todos, el despegue está despejado hasta 5 m de altura', () => {
    for (const name of SCENARIO_ORDER) {
      const colliders = scenarioColliders(buildScenario(name).objects);
      for (let y = droneConfig.restHeight; y <= 5; y += 0.25) {
        const blocking = colliders.find((c) => collideSphere({ x: 0, y, z: 0 }, droneConfig.collisionRadius + 1, c));
        expect(blocking, `${name} a ${y.toFixed(2)} m`).toBeUndefined();
      }
    }
  });

  it('el parque tiene árboles y un circuito de 4 puertas que se cierra', () => {
    const park = buildScenario('parque');
    expect(park.objects.filter((o) => o.type === 'tree').length).toBeGreaterThan(20);
    expect(park.course).toHaveLength(5);
    expect(park.course[0]).toEqual(park.course[4]);
    expect(park.course[0].maxAltitude).toBeGreaterThan(park.course[0].minAltitude ?? 0);
  });

  it('el campo libre no tiene obstáculos y enseña los conos', () => {
    const free = buildScenario('libre');
    expect(free.objects).toEqual([]);
    expect(free.showReferenceCones).toBe(true);
  });
});

describe('choques', () => {
  it('volar recto a fondo en la pista: pasa la primera puerta y se estrella contra el muro', () => {
    const sim = simIn('obstaculos');
    takeOff(sim);
    simulate(sim, 6, () => input({ pitch: 1 }));
    expect(sim.phase).toBe('crashed');
    expect(sim.crash?.target).toBe('muro');
    expect(sim.crash?.speed).toBeGreaterThan(5);
    expect(describeCrash(sim.crash!.target, sim.crash!.speed)).toContain('un muro');
  });

  it('estrellado: los motores se paran y el dron acaba en el suelo', () => {
    const sim = simIn('obstaculos');
    takeOff(sim);
    simulate(sim, 6, () => input({ pitch: 1 }));
    simulate(sim, 4, () => input({ throttle: 1 })); // aunque se pida subir, no hay motores
    expect(sim.state.onGround).toBe(true);
    expect(Math.max(...sim.state.motorThrust)).toBeLessThan(0.01);
  });

  it('acercarse despacio al muro solo lo roza: rebota pero no se estrella', () => {
    const sim = simIn('obstaculos', 'cine');
    takeOff(sim);
    sim.state.position.z = -19; // pasada la primera puerta, a 3 m del muro
    simulate(sim, 8, () => input({ pitch: 0.2 }));
    expect(sim.phase).toBe('flying');
    expect(sim.crash).toBeNull();
    expect(sim.state.position.z).toBeGreaterThan(-22); // el muro no lo deja pasar
  });

  it('caer desde 10 m sin batería contra el suelo es un crash', () => {
    const sim = simIn('libre', 'normal', 0.02);
    sim.spawnFlying({ x: 0, altitude: 10, z: 0, heading: 0 });
    simulate(sim, 4, () => input());
    expect(sim.crash?.target).toBe('suelo');
  });

  it('aterrizar a la bajada máxima de Normal (3 m/s) no es crash', () => {
    const sim = simIn('libre');
    sim.spawnFlying({ x: 0, altitude: 8, z: 0, heading: 0 });
    simulate(sim, 6, () => input({ throttle: -1 }));
    expect(sim.state.onGround).toBe(true);
    expect(sim.crash).toBeNull();
  });

  it('reiniciar quita el crash', () => {
    const sim = simIn('obstaculos');
    takeOff(sim);
    simulate(sim, 6, () => input({ pitch: 1 }));
    sim.reset();
    expect(sim.crash).toBeNull();
    expect(sim.phase).toBe('disarmed');
  });
});
