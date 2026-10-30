// Modos de vuelo, como en un DJI:
// - Cine, Normal, Sport (con GPS): el stick pide velocidad; al soltarlo frena y mantiene el punto.
// - ATTI (sin GPS): el stick pide inclinación; al soltarlo se nivela pero sigue deslizándose.
//   En un DJI real pasa a ATTI solo cuando pierde el GPS: es la situación en la que de verdad
//   tienes que saber pilotar. Aquí se puede elegir para practicarla.
// - Acro (sin GPS ni auto-nivelado): el stick pide velocidad de giro (ver control/acro.ts). Es el
//   modo M de un DJI Avata o el de un dron FPV. No está en el ciclo del botón, para no entrar sin
//   querer (en DJI hay que desbloquearlo en los ajustes): se elige con la tecla 5.

import { modesConfig, modeTransitionSeconds, type FlightModeName, type FlightModeParams } from '../core/config';

export type { FlightModeName } from '../core/config';

export const FLIGHT_MODE_LABELS: Record<FlightModeName, string> = {
  cine: 'Cine',
  normal: 'Normal',
  sport: 'Sport',
  atti: 'ATTI',
  acro: 'Acro',
};

/** Orden al cambiar de modo con un botón */
export const MODE_CYCLE: FlightModeName[] = ['cine', 'normal', 'sport', 'atti'];

/** Todos los modos (los del ciclo y Acro) */
export const FLIGHT_MODES: FlightModeName[] = [...MODE_CYCLE, 'acro'];

/** Siguiente modo del botón. Desde Acro vuelve a Normal: se nivela solo y frena (el "botón de pánico"). */
export function nextMode(mode: FlightModeName): FlightModeName {
  if (mode === 'acro') return 'normal';
  return MODE_CYCLE[(MODE_CYCLE.indexOf(mode) + 1) % MODE_CYCLE.length];
}

export function parseModeName(value: string | null): FlightModeName | null {
  return FLIGHT_MODES.find((mode) => mode === value) ?? null;
}

export function modeParams(mode: FlightModeName): FlightModeParams {
  return modesConfig[mode];
}

const NUMERIC_PARAMS = ['maxSpeed', 'maxClimb', 'maxDescent', 'maxTilt', 'maxYawRate', 'maxAccel'] as const;

/**
 * Lleva los límites efectivos hacia los del modo elegido de forma exponencial. `positionHold` y
 * `selfLevel` cambian al instante: el GPS se tiene o no se tiene, y el auto-nivelado igual.
 */
export class ModeBlender {
  readonly current: FlightModeParams;

  constructor(initial: FlightModeParams) {
    this.current = { ...initial };
  }

  /** Salta directamente a los límites indicados (al reiniciar). */
  snap(target: FlightModeParams): void {
    Object.assign(this.current, target);
  }

  update(target: FlightModeParams, dt: number): FlightModeParams {
    const blend = 1 - Math.exp(-dt / modeTransitionSeconds);
    for (const key of NUMERIC_PARAMS) this.current[key] += (target[key] - this.current[key]) * blend;
    this.current.positionHold = target.positionHold;
    this.current.selfLevel = target.selfLevel;
    return this.current;
  }
}
