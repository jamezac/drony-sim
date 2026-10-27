// Lo que el piloto pide en cada paso, venga de donde venga (SpaceMouse, teclado, demo).
// Es el punto de unión entre input/ y control/: ninguno de los dos conoce al otro.

import type { StickName } from './config';

/** Sticks virtuales en −1..1 (Modo 2): throttle + = subir, yaw + = horario, pitch + = adelante, roll + = derecha. */
export type Sticks = Record<StickName, number>;

/** Acciones de un solo disparo: valen true solo en el paso en que se pulsan. */
export interface ControlActions {
  /** Arrancar/parar motores (como el CSC de DJI) */
  toggleMotors: boolean;
  /** Despegue o aterrizaje automático */
  takeoffLand: boolean;
}

export interface ControlInput {
  sticks: Sticks;
  actions: ControlActions;
}

export function neutralSticks(): Sticks {
  return { throttle: 0, yaw: 0, pitch: 0, roll: 0 };
}

export function noActions(): ControlActions {
  return { toggleMotors: false, takeoffLand: false };
}

export function neutralInput(): ControlInput {
  return { sticks: neutralSticks(), actions: noActions() };
}
