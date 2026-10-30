// Traduce el estado de la simulación al "fotograma" que leen las lecciones.

import { Vector3 } from 'three';
import type { Sticks } from '../core/controlInput';
import type { Simulation } from '../core/simulation';
import { describeCrash } from '../physics/collisions';
import { headingOf } from '../physics/drone';
import type { LessonFrame } from './goals';

const up = new Vector3();

export function frameFromSimulation(sim: Simulation, sticks: Sticks): LessonFrame {
  const { position, velocity, orientation, onGround } = sim.state;
  return {
    x: position.x,
    z: position.z,
    altitude: sim.altitude,
    heading: headingOf(orientation),
    upright: up.set(0, 1, 0).applyQuaternion(orientation).y,
    verticalSpeed: velocity.y,
    phase: sim.phase,
    onGround,
    sticks,
    crash: sim.crash ? describeCrash(sim.crash.target, sim.crash.speed) : null,
  };
}
