// Mezclador de un cuadricóptero en X: convierte "empuje total + torques" en el empuje de cada motor.
// Es la inversa exacta de computeBodyTorque (physics/dynamics.ts).
//
// Saturación: si los motores no dan para todo, se prioriza la ACTITUD sobre el empuje total.
// Mantener el dron nivelado es más importante que subir o bajar exactamente lo pedido.

import type { Vector3 } from 'three';
import { droneConfig } from '../core/config';
import { MOTOR_COUNT, MOTOR_YAW_DIRECTION, motorPositions } from '../physics/drone';

const MOTORS = motorPositions();
const differential = new Array<number>(MOTOR_COUNT).fill(0);

/**
 * @param collective empuje total deseado (N)
 * @param torque torque deseado en ejes del cuerpo (N·m)
 * @param out array de 4 empujes (N) donde se escribe el resultado
 */
export function mixMotors(collective: number, torque: Vector3, out: number[]): number[] {
  const { armLength, yawTorquePerThrust: k, maxThrustPerMotor: max } = droneConfig;
  const a2 = (armLength * armLength) / 2; // (brazo/√2)²: cada coordenada del motor al cuadrado

  // Parte de cada motor que genera los torques (suma cero entre los cuatro)
  let low = Infinity;
  let high = -Infinity;
  for (let i = 0; i < MOTOR_COUNT; i++) {
    const r = MOTORS[i];
    const d =
      (torque.x * -r.z) / (4 * a2) + (torque.z * r.x) / (4 * a2) + (torque.y * MOTOR_YAW_DIRECTION[i]) / (4 * k);
    differential[i] = d;
    low = Math.min(low, d);
    high = Math.max(high, d);
  }

  // Si la diferencia entre motores no cabe en su rango, se reducen los torques proporcionalmente
  const spread = high - low;
  const scale = spread > max ? max / spread : 1;

  // El empuje común se desplaza lo justo para que ningún motor se salga de [0, max]
  const base = Math.min(Math.max(collective / MOTOR_COUNT, -low * scale), max - high * scale);
  for (let i = 0; i < MOTOR_COUNT; i++) {
    out[i] = Math.min(max, Math.max(0, base + differential[i] * scale));
  }
  return out;
}
