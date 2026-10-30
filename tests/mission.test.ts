// Misión de waypoints: recorre los puntos en orden, sin salirse de las líneas, y al acabar hace
// lo que dice el plan. Los sticks, H y Espacio la interrumpen.

import { describe, expect, it } from 'vitest';
import { missionConfig, modesConfig, type FlightModeName } from '../src/core/config';
import { neutralSticks, noActions, type ControlActions, type ControlInput, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import { missionLength, type MissionFinish, type MissionPlan, type MissionWaypoint } from '../src/control/mission';
import { headingOf } from '../src/physics/drone';

const DEG = Math.PI / 180;

interface Point {
  x: number;
  z: number;
}

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

// Un cuadrado de 20 m delante del despegue, a 10 m de altura (el dron despega mirando a −Z)
const SQUARE: MissionWaypoint[] = [
  { x: 0, z: -20, altitude: 10 },
  { x: 20, z: -20, altitude: 10 },
  { x: 20, z: 0, altitude: 10 },
  { x: 0, z: 0, altitude: 10 },
];

function plan(waypoints: MissionWaypoint[], finish: MissionFinish = 'hover', speed = 5): MissionPlan {
  return { waypoints, speed, finish };
}

function flying(missionPlan: MissionPlan, mode: FlightModeName = 'normal'): Simulation {
  const sim = takenOff(mode);
  sim.setMissionPlan(missionPlan);
  press(sim, { mission: true });
  return sim;
}

/** Distancia horizontal del punto p al segmento a-b */
function distanceToSegment(p: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dz = b.z - a.z;
  const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.z - a.z) * dz) / (dx * dx + dz * dz)));
  return Math.hypot(p.x - (a.x + t * dx), p.z - (a.z + t * dz));
}

/** Distancia al recorrido: a la línea quebrada que une los puntos */
function distanceToRoute(p: Point, route: Point[]): number {
  let best = Infinity;
  for (let i = 1; i < route.length; i++) best = Math.min(best, distanceToSegment(p, route[i - 1], route[i]));
  return best;
}

/**
 * Vuela hasta que termina (o se acaba el tiempo) y devuelve el orden de los puntos y el peor
 * desvío del recorrido, que empieza donde estaba el dron. Al empezar cada giro un poco antes del
 * punto, el dron recorta la esquina: el desvío se mide respecto a toda la línea quebrada.
 */
function flyMission(sim: Simulation, waypoints: MissionWaypoint[], maxSeconds = 120) {
  const route: Point[] = [{ x: sim.state.position.x, z: sim.state.position.z }, ...waypoints];
  const visited: number[] = [];
  let worstOffset = 0;
  const { mission } = sim.controller;
  for (let t = 0; t < maxSeconds && sim.phase === 'mission'; t += 1 / 240) {
    sim.step(1 / 240, input());
    if (visited[visited.length - 1] !== mission.index) visited.push(mission.index);
    worstOffset = Math.max(worstOffset, distanceToRoute(sim.state.position, route));
  }
  return { visited, worstOffset };
}

describe('misión de waypoints', () => {
  it('en vuelo con un plan, el botón la empieza hacia el primer punto', () => {
    const sim = flying(plan(SQUARE));
    expect(sim.phase).toBe('mission');
    expect(sim.controller.mission.index).toBe(0);
  });

  it('sin puntos, sin GPS o en el suelo no empieza', () => {
    const empty = takenOff();
    press(empty, { mission: true });
    expect(empty.phase).toBe('flying');

    const atti = takenOff('atti');
    atti.setMissionPlan(plan(SQUARE));
    press(atti, { mission: true });
    expect(atti.phase).toBe('flying');

    const ground = new Simulation();
    ground.setMissionPlan(plan(SQUARE));
    press(ground, { mission: true });
    expect(ground.phase).toBe('disarmed');
  });

  it('recorre el cuadrado en orden, sin salirse de las líneas, y se queda en el último punto', () => {
    const sim = flying(plan(SQUARE));
    const { visited, worstOffset } = flyMission(sim, SQUARE);
    expect(visited).toEqual([0, 1, 2, 3]);
    expect(worstOffset).toBeLessThan(0.8);
    expect(sim.phase).toBe('flying');
    hold(sim, 3);
    const { x, z } = sim.state.position;
    expect(Math.hypot(x - 0, z - 0)).toBeLessThan(missionConfig.arriveRadius);
    expect(Math.abs(sim.altitude - 10)).toBeLessThan(0.3);
  });

  it('en un tramo largo va a la velocidad de la misión, con el morro hacia donde va', () => {
    const sim = flying(plan([{ x: 0, z: -80, altitude: 1.2 }], 'hover', 6));
    hold(sim, 7);
    const speed = Math.hypot(sim.state.velocity.x, sim.state.velocity.z);
    expect(speed).toBeGreaterThan(5.7);
    expect(speed).toBeLessThan(6.3);
    // Rumbo 0 = mirando a −Z
    expect(Math.abs(headingOf(sim.state.orientation))).toBeLessThan(2 * DEG);
  });

  it('la velocidad nunca pasa de la del modo (Cine)', () => {
    const sim = flying(plan([{ x: 0, z: -80, altitude: 1.2 }], 'hover', 10), 'cine');
    let maxSpeed = 0;
    simulate(sim, 15, () => {
      maxSpeed = Math.max(maxSpeed, Math.hypot(sim.state.velocity.x, sim.state.velocity.z));
      return input();
    });
    expect(maxSpeed).toBeLessThan(modesConfig.cine.maxSpeed + 0.3);
  });

  it('cambia de altura a lo largo del tramo y sube en vertical si el punto está encima', () => {
    const waypoints: MissionWaypoint[] = [
      { x: 0, z: -30, altitude: 15 },
      { x: 0, z: -30, altitude: 25 },
    ];
    const sim = flying(plan(waypoints));
    let midLegAltitude = 0;
    simulate(sim, 60, () => {
      const p = sim.state.position;
      if (sim.controller.mission.index === 0 && Math.abs(p.z + 15) < 0.1) midLegAltitude = sim.altitude;
      return input();
    });
    // A mitad del primer tramo, a mitad de camino entre 1,2 m y 15 m
    expect(midLegAltitude).toBeGreaterThan(6);
    expect(midLegAltitude).toBeLessThan(10);
    expect(sim.phase).toBe('flying');
    expect(Math.abs(sim.altitude - 25)).toBeLessThan(0.3);
    expect(Math.hypot(sim.state.position.x, sim.state.position.z + 30)).toBeLessThan(0.5);
  });

  it('al acabar: vuelve a casa o aterriza en el último punto, según el plan', () => {
    const home = flying(plan(SQUARE.slice(0, 2), 'home'));
    flyMission(home, SQUARE);
    expect(home.phase).toBe('returning');

    const land = flying(plan(SQUARE.slice(0, 2), 'land'));
    flyMission(land, SQUARE);
    expect(land.phase).toBe('landing');
    hold(land, 15);
    expect(land.phase).toBe('disarmed');
    const { x, z } = land.state.position;
    expect(Math.hypot(x - 20, z + 20)).toBeLessThan(0.5);
  });

  it('mover los sticks toma el control; H vuelve a casa y Espacio aterriza', () => {
    const sticks = flying(plan(SQUARE));
    hold(sticks, 2);
    hold(sticks, 0.2, { yaw: 1 });
    expect(sticks.phase).toBe('flying');

    const rth = flying(plan(SQUARE));
    hold(rth, 2);
    press(rth, { returnHome: true });
    expect(rth.phase).toBe('returning');

    const land = flying(plan(SQUARE));
    hold(land, 2);
    press(land, { takeoffLand: true });
    expect(land.phase).toBe('landing');
  });

  it('el botón otra vez la detiene: frena y se queda en el sitio', () => {
    const sim = flying(plan(SQUARE));
    hold(sim, 5);
    press(sim, { mission: true });
    expect(sim.phase).toBe('flying');
    hold(sim, 4);
    expect(Math.hypot(sim.state.velocity.x, sim.state.velocity.z)).toBeLessThan(0.3);
  });

  it('con viento moderado sigue sin salirse de las líneas', () => {
    const sim = new Simulation({ wind: 'moderate' });
    press(sim, { takeoffLand: true });
    hold(sim, 6);
    sim.setMissionPlan(plan(SQUARE));
    press(sim, { mission: true });
    const { visited, worstOffset } = flyMission(sim, SQUARE);
    expect(visited).toEqual([0, 1, 2, 3]);
    expect(worstOffset).toBeLessThan(1);
  });

  it('longitud del recorrido (para el resumen del mapa)', () => {
    expect(missionLength(SQUARE)).toBeCloseTo(60);
    expect(missionLength(SQUARE, { x: 0, z: 0 })).toBeCloseTo(80);
    expect(missionLength([])).toBe(0);
  });
});
