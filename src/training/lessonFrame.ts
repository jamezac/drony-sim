// Traduce el estado de la simulación al "fotograma" que leen las lecciones.

import type { Sticks } from '../core/controlInput';
import type { Simulation } from '../core/simulation';
import { headingOf } from '../physics/drone';
import type { LessonFrame } from './goals';

export function frameFromSimulation(sim: Simulation, sticks: Sticks): LessonFrame {
  const { position, velocity, orientation, onGround } = sim.state;
  return {
    x: position.x,
    z: position.z,
    altitude: sim.altitude,
    heading: headingOf(orientation),
    verticalSpeed: velocity.y,
    phase: sim.phase,
    onGround,
    sticks,
  };
}
