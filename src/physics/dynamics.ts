// Dinámica del cuadricóptero: motores → fuerzas y torques → integración del estado.
//
// Por qué así:
// - Los motores tienen un retardo de primer orden: un dron real no cambia de empuje al instante,
//   y ese retardo es lo que limita lo agresivos que pueden ser los PID.
// - Euler semi-implícito: primero la velocidad y luego la posición con la velocidad nueva.
//   Es igual de barato que Euler explícito pero mucho más estable.
// - La orientación se integra componiendo una rotación exacta (eje-ángulo), sin ángulos de Euler,
//   así no hay gimbal lock, y se normaliza el cuaternión para que no acumule error.

import { Quaternion, Vector3 } from 'three';
import { droneConfig, simConfig } from '../core/config';
import { MOTOR_COUNT, MOTOR_YAW_DIRECTION, motorPositions, type DroneState } from './drone';

const MOTORS = motorPositions();

// Temporales reutilizados: a 240 Hz crear objetos en cada paso provocaría tirones del GC
const force = new Vector3();
const torque = new Vector3();
const inertiaOmega = new Vector3();
const gyroscopic = new Vector3();
const rotationAxis = new Vector3();
const deltaRotation = new Quaternion();

/** Acerca el empuje real de cada motor al pedido (retardo de primer orden, exacto para dt fijo). */
export function updateMotors(state: DroneState, commands: readonly number[], dt: number): void {
  const blend = 1 - Math.exp(-dt / droneConfig.motorTimeConstant);
  for (let i = 0; i < MOTOR_COUNT; i++) {
    const command = Math.min(droneConfig.maxThrustPerMotor, Math.max(0, commands[i] ?? 0));
    state.motorThrust[i] += (command - state.motorThrust[i]) * blend;
  }
}

/**
 * Torque sobre el cuerpo (ejes del cuerpo) que producen unos empujes:
 * - roll/pitch: cada empuje vertical aplicado en la posición de su motor (r × F)
 * - yaw: par de reacción de las hélices, proporcional al empuje
 */
export function computeBodyTorque(thrusts: readonly number[], out: Vector3): Vector3 {
  out.set(0, 0, 0);
  for (let i = 0; i < MOTOR_COUNT; i++) {
    const r = MOTORS[i];
    const thrust = thrusts[i];
    // r × (0, T, 0) = (−r.z·T, 0, r.x·T)
    out.x += -r.z * thrust;
    out.z += r.x * thrust;
    out.y += MOTOR_YAW_DIRECTION[i] * droneConfig.yawTorquePerThrust * thrust;
  }
  return out;
}

/** Integra un paso con los empujes actuales de los motores. */
export function integrate(state: DroneState, dt: number): void {
  const { mass, inertia, linearDrag, angularDrag } = droneConfig;

  // --- Traslación (mundo) ---
  let totalThrust = 0;
  for (let i = 0; i < MOTOR_COUNT; i++) totalThrust += state.motorThrust[i];
  force.set(0, totalThrust, 0).applyQuaternion(state.orientation); // el empuje va en el "arriba" del cuerpo
  force.y -= mass * simConfig.gravity;
  force.addScaledVector(state.velocity, -linearDrag * state.velocity.length());

  state.velocity.addScaledVector(force, dt / mass);
  state.position.addScaledVector(state.velocity, dt);

  // --- Rotación (cuerpo): I·ω̇ = τ − ω × (I·ω) ---
  const omega = state.angularVelocity;
  computeBodyTorque(state.motorThrust, torque).addScaledVector(omega, -angularDrag);
  inertiaOmega.set(inertia.x * omega.x, inertia.y * omega.y, inertia.z * omega.z);
  gyroscopic.crossVectors(omega, inertiaOmega);
  torque.sub(gyroscopic);
  omega.x += (torque.x / inertia.x) * dt;
  omega.y += (torque.y / inertia.y) * dt;
  omega.z += (torque.z / inertia.z) * dt;

  // q ← q ⊗ rotación(ω·dt): ω está en ejes del cuerpo, por eso se multiplica por la derecha
  const angle = omega.length() * dt;
  if (angle > 0) {
    rotationAxis.copy(omega).normalize();
    deltaRotation.setFromAxisAngle(rotationAxis, angle);
    state.orientation.multiply(deltaRotation).normalize();
  }
}

/** Un paso completo de física: motores y luego integración. */
export function stepDynamics(state: DroneState, commands: readonly number[], dt: number): void {
  updateMotors(state, commands, dt);
  integrate(state, dt);
}
