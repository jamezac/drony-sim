// Estado físico del dron. Convenciones:
// - Mundo: el de Three.js, Y hacia arriba. El home está en el origen.
// - Cuerpo: x = derecha, y = arriba, −z = morro (adelante).
// - `orientation` rota del cuerpo al mundo. `angularVelocity` va en ejes del cuerpo.
// - Motores en X: 0 delantero-izq, 1 delantero-der, 2 trasero-izq, 3 trasero-der.

import { Quaternion, Vector3 } from 'three';
import { droneConfig } from '../core/config';

export const MOTOR_COUNT = 4;

export interface DroneState {
  position: Vector3; // m, centro de masas en el mundo
  velocity: Vector3; // m/s, en el mundo
  orientation: Quaternion; // cuerpo → mundo
  angularVelocity: Vector3; // rad/s, en ejes del cuerpo
  motorThrust: number[]; // N, empuje real de cada motor (tras el retardo)
  onGround: boolean;
}

export function createDroneState(): DroneState {
  return {
    position: new Vector3(0, droneConfig.restHeight, 0),
    velocity: new Vector3(),
    orientation: new Quaternion(),
    angularVelocity: new Vector3(),
    motorThrust: new Array<number>(MOTOR_COUNT).fill(0),
    onGround: true,
  };
}

export function copyDroneState(target: DroneState, source: DroneState): void {
  target.position.copy(source.position);
  target.velocity.copy(source.velocity);
  target.orientation.copy(source.orientation);
  target.angularVelocity.copy(source.angularVelocity);
  for (let i = 0; i < MOTOR_COUNT; i++) target.motorThrust[i] = source.motorThrust[i];
  target.onGround = source.onGround;
}

/** Posición de cada motor en ejes del cuerpo (configuración en X, brazos a 45°). */
export function motorPositions(armLength: number = droneConfig.armLength): Vector3[] {
  const a = armLength / Math.SQRT2;
  return [
    new Vector3(-a, 0, -a), // delantero-izquierdo
    new Vector3(a, 0, -a), // delantero-derecho
    new Vector3(-a, 0, a), // trasero-izquierdo
    new Vector3(a, 0, a), // trasero-derecho
  ];
}

/**
 * Sentido del par de reacción de cada hélice sobre el cuerpo (+1 = gira el dron en antihorario
 * visto desde arriba). Las hélices de una diagonal giran igual, así los pares se compensan en hover.
 * Las delantera-izq y trasera-der giran en horario, y su par de reacción empuja el cuerpo al revés.
 */
export const MOTOR_YAW_DIRECTION = [1, -1, -1, 1] as const;

const tmpForward = new Vector3();

/**
 * Rumbo (yaw) en radianes: rotación sobre +Y del mundo, positiva en antihorario visto desde arriba.
 * 0 = morro hacia −Z del mundo.
 */
export function headingOf(orientation: Quaternion): number {
  tmpForward.set(0, 0, -1).applyQuaternion(orientation);
  return Math.atan2(-tmpForward.x, -tmpForward.z);
}

/** Inclinación total (rad) respecto a la vertical. */
export function tiltOf(orientation: Quaternion): number {
  tmpForward.set(0, 1, 0).applyQuaternion(orientation);
  return Math.acos(Math.min(1, Math.max(-1, tmpForward.y)));
}
