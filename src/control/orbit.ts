// Órbita alrededor de un punto de interés (POI), como la de DJI: el dron da vueltas al punto con
// el morro (y la cámara) siempre mirándolo. Es la toma clásica de un monumento o una casa.
//
// - Al empezar, el centro se pone delante del morro, a 10 m: lo que tenías en el encuadre.
// - Durante la órbita los sticks no la cancelan, la ajustan: avance/atrás acerca o aleja (radio),
//   lateral cambia la velocidad y el sentido, y el throttle sube o baja como siempre.
//
// Cómo se vuela un círculo: la velocidad objetivo es tangente al círculo, más una corrección
// hacia dentro o hacia fuera si el radio se desvía. Para curvar la trayectoria hace falta además
// una aceleración hacia el centro, v²/R, que se pide directamente (prealimentación) en vez de
// esperar a que el PID de velocidad la descubra yendo por detrás.

import { orbitConfig } from '../core/config';
import type { Sticks } from '../core/controlInput';
import { headingOf, type DroneState } from '../physics/drone';
import type { AutoTargets } from './autoTargets';

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

export class Orbit {
  /** Punto de interés (m, mundo) */
  readonly center = { x: 0, z: 0 };
  /** Radio objetivo (m) */
  radius: number = orbitConfig.startRadius;
  /** Velocidad a lo largo del círculo (m/s): positiva = hacia la derecha del dron */
  speed: number = orbitConfig.startSpeed;
  readonly targets: AutoTargets = { velocityX: 0, velocityZ: 0, accelX: 0, accelZ: 0, altitude: null, heading: null };

  /** Empieza a orbitar un punto delante del morro. */
  start(state: DroneState): void {
    const heading = headingOf(state.orientation);
    const { startRadius, startSpeed } = orbitConfig;
    this.center.x = state.position.x - Math.sin(heading) * startRadius;
    this.center.z = state.position.z - Math.cos(heading) * startRadius;
    this.radius = startRadius;
    this.speed = startSpeed;
  }

  /**
   * @param sticks pitch = radio (adelante acerca), roll = velocidad (derecha suma)
   * @param maxSpeed velocidad máxima del modo de vuelo
   */
  update(state: DroneState, sticks: Sticks, maxSpeed: number, dt: number): AutoTargets {
    const { minRadius, maxRadius, radiusRate, speedRate, maxCentripetal, radiusKp } = orbitConfig;
    this.radius = clamp(this.radius - sticks.pitch * radiusRate * dt, minRadius, maxRadius);
    // Velocidad máxima: la de la órbita, la del modo y la que permite la aceleración centrípeta
    const limit = Math.min(orbitConfig.maxSpeed, maxSpeed, Math.sqrt(maxCentripetal * this.radius));
    this.speed = clamp(this.speed + sticks.roll * speedRate * dt, -limit, limit);

    const dx = state.position.x - this.center.x;
    const dz = state.position.z - this.center.z;
    const distance = Math.max(Math.hypot(dx, dz), 1e-6);
    // Unitario del centro hacia el dron; mirando al centro, la derecha del dron es (rz, −rx)
    const rx = dx / distance;
    const rz = dz / distance;
    const outward = radiusKp * (this.radius - distance);
    const targets = this.targets;
    targets.velocityX = rz * this.speed + rx * outward;
    targets.velocityZ = -rx * this.speed + rz * outward;
    // Aceleración centrípeta: v²/R hacia el centro
    const centripetal = (this.speed * this.speed) / distance;
    targets.accelX = -rx * centripetal;
    targets.accelZ = -rz * centripetal;
    // Morro hacia el centro (mismo convenio que el rumbo hacia casa del RTH)
    targets.heading = Math.atan2(dx, dz);
    return targets;
  }
}
