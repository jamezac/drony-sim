// Máquina de estados del vuelo, inspirada en un DJI:
//
//   parado ──E──▶ motores en marcha ──throttle arriba──▶ en vuelo
//     │                 │  ▲                               │  │
//     │              Espacio └──── se posa (aterrizaje a mano)┘  │
//     └──Espacio──▶ despegando (sube a 1,2 m) ──▶ en vuelo ──Espacio──▶ aterrizando ──▶ parado
//
// - Con los motores en marcha en el suelo, mantener el throttle abajo ~1,5 s los para.
// - Mover los sticks cancela el despegue automático; subir el throttle cancela el aterrizaje.

import { flightConfig } from '../core/config';
import type { ControlActions, Sticks } from '../core/controlInput';

export type FlightPhase = 'disarmed' | 'armed' | 'takingOff' | 'flying' | 'landing';

export const FLIGHT_PHASE_LABELS: Record<FlightPhase, string> = {
  disarmed: 'Motores parados',
  armed: 'Motores en marcha',
  takingOff: 'Despegando',
  flying: 'En vuelo',
  landing: 'Aterrizando',
};

export interface FlightStateInput {
  sticks: Sticks;
  actions: ControlActions;
  onGround: boolean;
  /** Altura sobre la posición de reposo (m) */
  altitude: number;
}

export class FlightStateMachine {
  phase: FlightPhase = 'disarmed';
  /** Si ya ha despegado en este vuelo: distingue "aún en el suelo" de "se ha posado" */
  private airborne = false;
  private disarmTimer = 0;

  update(input: FlightStateInput, dt: number): FlightPhase {
    const { sticks, actions, onGround, altitude } = input;
    const { airborneHeight, overrideStick, manualTakeoffThrottle, disarmThrottle, disarmHoldSeconds } =
      flightConfig;
    if (altitude > airborneHeight) this.airborne = true;
    const sticksMoved = Math.max(...Object.values(sticks).map(Math.abs)) > overrideStick;

    switch (this.phase) {
      case 'disarmed':
        if (actions.toggleMotors) this.enter('armed');
        else if (actions.takeoffLand) this.enter('takingOff');
        break;

      case 'armed':
        this.disarmTimer = sticks.throttle < disarmThrottle ? this.disarmTimer + dt : 0;
        if (actions.toggleMotors || this.disarmTimer >= disarmHoldSeconds) this.enter('disarmed');
        else if (actions.takeoffLand) this.enter('takingOff');
        else if (sticks.throttle > manualTakeoffThrottle) this.enter('flying');
        break;

      case 'takingOff':
        if (actions.takeoffLand) this.enter('landing');
        else if (sticksMoved || altitude >= flightConfig.takeoffAltitude - 0.05) this.enter('flying');
        break;

      case 'flying':
        if (actions.takeoffLand) this.enter('landing');
        // Se ha posado tras volar, o soltó el throttle antes de llegar a despegar
        else if (onGround && (this.airborne || sticks.throttle <= 0)) this.enter('armed');
        break;

      case 'landing':
        if (sticks.throttle > overrideStick) this.enter('flying');
        // Como DJI: al tocar suelo en el aterrizaje automático, los motores se paran solos
        else if (onGround) this.enter('disarmed');
        break;
    }
    return this.phase;
  }

  private enter(phase: FlightPhase): void {
    this.phase = phase;
    this.disarmTimer = 0;
    if (phase === 'armed' || phase === 'disarmed') this.airborne = false;
  }
}
