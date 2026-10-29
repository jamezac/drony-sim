// Máquina de estados del vuelo, inspirada en un DJI:
//
//   parado ──E──▶ motores en marcha ──throttle arriba──▶ en vuelo ◀──H / sticks──┐
//     │                 │  ▲                               │  │  └──H──▶ volviendo a casa
//     │              Espacio └──── se posa (aterrizaje a mano)┘  │              │ llega
//     └──Espacio──▶ despegando (sube a 1,2 m) ──▶ en vuelo ──Espacio──▶ aterrizando ◀┘ ──▶ parado
//                                                    ▲  │
//                                                    O  O
//                                                    │  ▼
//                                                  órbita (H: RTH, Espacio: aterrizar)
//
// - Con los motores en marcha en el suelo, mantener el throttle abajo ~1,5 s los para.
// - Mover los sticks cancela el despegue automático y el RTH; subir el throttle cancela el aterrizaje.
//   En la órbita no: los sticks la ajustan (radio, velocidad, altura). Se sale con O.
// - Batería: al 15 % vuelve sola a casa (una vez; se puede cancelar). Al 10 % aterriza donde
//   esté y ya no se puede cancelar. Sin GPS (ATTI, Acro) no hay RTH ni órbita.

import { batteryConfig, flightConfig } from '../core/config';
import type { ControlActions, Sticks } from '../core/controlInput';

export type FlightPhase =
  | 'disarmed'
  | 'armed'
  | 'takingOff'
  | 'flying'
  | 'returning'
  | 'orbiting'
  | 'landing'
  | 'crashed';

export const FLIGHT_PHASE_LABELS: Record<FlightPhase, string> = {
  disarmed: 'Motores parados',
  armed: 'Motores en marcha',
  takingOff: 'Despegando',
  flying: 'En vuelo',
  returning: 'Volviendo a casa (RTH)',
  orbiting: 'Órbita',
  landing: 'Aterrizando',
  crashed: 'Estrellado',
};

export interface FlightStateInput {
  sticks: Sticks;
  actions: ControlActions;
  onGround: boolean;
  /** Altura sobre la posición de reposo (m) */
  altitude: number;
  /** Si hay GPS (modo con mantenimiento de posición): sin él no hay RTH ni órbita */
  gps: boolean;
  batteryPercent: number;
  /** El RTH ha llegado sobre el punto de despegue */
  rthArrived: boolean;
}

export class FlightStateMachine {
  phase: FlightPhase = 'disarmed';
  /** Aterrizaje por batería crítica: no se puede cancelar */
  forcedLanding = false;
  /** Si ya ha despegado en este vuelo: distingue "aún en el suelo" de "se ha posado" */
  private airborne = false;
  private disarmTimer = 0;
  /** Para no relanzar el RTH por batería si el piloto ya lo canceló */
  private lowBatteryRthDone = false;
  /**
   * Los sticks solo cancelan el RTH si se han soltado desde que empezó. Si no, un RTH por batería
   * que salta mientras el piloto mantiene un stick se cancelaría solo en el paso siguiente.
   */
  private sticksReleasedSinceRth = false;

  update(input: FlightStateInput, dt: number): FlightPhase {
    const { sticks, actions, onGround, altitude, gps, batteryPercent, rthArrived } = input;
    const { airborneHeight, overrideStick, manualTakeoffThrottle, disarmThrottle, disarmHoldSeconds } =
      flightConfig;
    if (altitude > airborneHeight) this.airborne = true;
    const sticksMoved = Math.max(...Object.values(sticks).map(Math.abs)) > overrideStick;
    const inAir =
      this.phase === 'flying' || this.phase === 'returning' || this.phase === 'orbiting' || this.phase === 'takingOff';

    // Batería crítica: aterrizaje forzoso desde cualquier fase en el aire (y el que ya estuviera
    // en curso deja de poder cancelarse)
    if (batteryPercent <= batteryConfig.criticalPercent && !onGround && (inAir || this.phase === 'landing')) {
      this.forcedLanding = true;
      if (this.phase !== 'landing') {
        this.enter('landing');
        return this.phase;
      }
    }

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
        else if (gps && actions.returnHome) this.enter('returning');
        else if (this.lowBatteryReturn(gps, batteryPercent)) this.enter('returning');
        else if (gps && actions.orbit && this.airborne && !onGround) this.enter('orbiting');
        // Se ha posado tras volar, o soltó el throttle antes de llegar a despegar
        else if (onGround && (this.airborne || sticks.throttle <= 0)) this.enter('armed');
        break;

      case 'orbiting':
        if (actions.takeoffLand) this.enter('landing');
        else if (gps && actions.returnHome) this.enter('returning');
        else if (this.lowBatteryReturn(gps, batteryPercent)) this.enter('returning');
        // Salir con O, o al pasar a un modo sin GPS (sin él no sabe dónde está el centro)
        else if (actions.orbit || !gps) this.enter('flying');
        // Bajó con el throttle hasta posarse
        else if (onGround) this.enter('armed');
        break;

      case 'returning':
        if (!sticksMoved) this.sticksReleasedSinceRth = true;
        if (actions.takeoffLand) this.enter('landing');
        else if (actions.returnHome || (sticksMoved && this.sticksReleasedSinceRth) || !gps) this.enter('flying');
        else if (rthArrived) this.enter('landing');
        break;

      case 'crashed':
        // Motores parados hasta reiniciar: un dron estrellado no vuelve a despegar solo
        break;

      case 'landing':
        if (!this.forcedLanding && sticks.throttle > overrideStick) this.enter('flying');
        // Como DJI: al tocar suelo en el aterrizaje automático, los motores se paran solos
        else if (onGround) this.enter('disarmed');
        break;
    }
    return this.phase;
  }

  /** Vuelta a casa por batería baja: una sola vez por vuelo (si el piloto la cancela, no insiste). */
  private lowBatteryReturn(gps: boolean, batteryPercent: number): boolean {
    if (!gps || this.lowBatteryRthDone || batteryPercent > batteryConfig.rthPercent || !this.airborne) return false;
    this.lowBatteryRthDone = true;
    return true;
  }

  /** Empieza directamente en vuelo (lecciones que arrancan en el aire). */
  startFlying(): void {
    this.enter('flying');
    this.airborne = true;
  }

  /** Se acabó la batería: los motores se paran estén donde estén. */
  forceDisarm(): void {
    if (this.phase !== 'crashed') this.enter('disarmed');
  }

  /** Choque fuerte: hélices rotas, motores parados, el dron cae. */
  crash(): void {
    this.enter('crashed');
  }

  private enter(phase: FlightPhase): void {
    if (phase === 'returning') this.sticksReleasedSinceRth = false;
    this.phase = phase;
    this.disarmTimer = 0;
    if (phase === 'armed' || phase === 'disarmed') {
      this.airborne = false;
      this.forcedLanding = false;
    }
  }
}
