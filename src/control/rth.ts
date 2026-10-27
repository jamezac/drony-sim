// Vuelta a casa (RTH, Return To Home), como en un DJI:
//   1. Subir: hasta la altura de RTH (30 m) para librar obstáculos. Si ya está más alto, no baja.
//      Si está muy cerca de casa (< 20 m), no sube.
//   2. Girar: apunta el morro hacia casa (así la cámara ve hacia dónde va).
//   3. Volar: va hacia casa a velocidad constante y frena al llegar.
//   4. Llegar: sobre el punto de despegue y casi parado → la máquina de estados pasa a aterrizar.
//
// Necesita GPS: en ATTI no sabe dónde está, así que no hay RTH (igual que en un dron real).

import { controlConfig, droneConfig, rthConfig } from '../core/config';
import { headingOf, type DroneState } from '../physics/drone';

export type RthStage = 'climb' | 'turn' | 'cruise' | 'arrived';

export const RTH_STAGE_LABELS: Record<RthStage, string> = {
  climb: 'subiendo',
  turn: 'girando hacia casa',
  cruise: 'volviendo',
  arrived: 'llegando',
};

/** Lo que el RTH le pide al controlador en cada paso */
export interface RthTargets {
  /** Velocidad horizontal objetivo (m/s, mundo) */
  velocityX: number;
  velocityZ: number;
  /** Altura objetivo (y del mundo, m) */
  altitude: number;
  /** Rumbo objetivo (rad), o null para mantener el actual */
  heading: number | null;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

export class ReturnToHome {
  stage: RthStage = 'climb';
  private cruiseAltitude = 0;
  readonly targets: RthTargets = { velocityX: 0, velocityZ: 0, altitude: 0, heading: null };

  start(state: DroneState): void {
    const distance = Math.hypot(state.position.x, state.position.z);
    const y = state.position.y;
    const rthY = droneConfig.restHeight + rthConfig.altitude;
    this.cruiseAltitude = distance > rthConfig.nearHomeDistance ? Math.max(y, rthY) : y;
    this.stage = 'climb';
  }

  update(state: DroneState): RthTargets {
    const { x, y, z } = state.position;
    const distance = Math.hypot(x, z);
    const speed = Math.hypot(state.velocity.x, state.velocity.z);
    // Rumbo hacia casa: el morro apuntando al origen
    const homeHeading = Math.atan2(x, z);
    const headingError = Math.abs(wrapAngle(homeHeading - headingOf(state.orientation)));
    const targets = this.targets;
    targets.altitude = this.cruiseAltitude;
    targets.velocityX = 0;
    targets.velocityZ = 0;
    targets.heading = null;

    if (this.stage === 'climb' && y >= this.cruiseAltitude - 0.3) this.stage = 'turn';
    if (this.stage === 'turn' && (headingError < rthConfig.headingTolerance || distance < 2)) this.stage = 'cruise';
    if (this.stage === 'cruise' && distance < rthConfig.arriveRadius && speed < rthConfig.arriveSpeed) {
      this.stage = 'arrived';
    }

    if (this.stage === 'turn') targets.heading = homeHeading;
    if (this.stage === 'cruise') {
      // Velocidad hacia casa, frenando al acercarse (con la misma ganancia que el P de posición)
      const approach = Math.min(rthConfig.speed, distance * controlConfig.position.kp);
      if (distance > 1e-6) {
        targets.velocityX = (-x / distance) * approach;
        targets.velocityZ = (-z / distance) * approach;
      }
      // Cerca de casa ya no se corrige el rumbo: evita que gire sobre sí mismo al pasar por encima
      if (distance > 2) targets.heading = homeHeading;
    }
    return targets;
  }
}
