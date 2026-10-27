// Cámaras. Fase 1: tercera persona (detrás y algo por encima del dron).
// FPV y vista desde el piloto llegan en la fase 6.
//
// La cámara sigue al dron con un "muelle" exponencial: se acerca a su posición ideal una
// fracción cada frame (1 − e^(−k·dt)), que no depende de los fps. Gira con el rumbo del dron
// pero con algo de retraso, así se nota el giro y no marea.

import * as THREE from 'three';
import { renderConfig } from '../core/config';

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const desired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(renderConfig.chaseFov, 1, 0.05, 500);
  private yaw = 0;
  private initialized = false;

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Coloca la cámara de golpe (al empezar o al reiniciar), sin suavizado. */
  snap(target: THREE.Vector3, heading: number): void {
    this.initialized = false;
    this.update(target, heading, 0);
  }

  update(target: THREE.Vector3, heading: number, dt: number): void {
    const { chaseDistance, chaseHeight, chasePositionStiffness, chaseYawStiffness } = renderConfig;
    if (!this.initialized) this.yaw = heading;
    else this.yaw += wrapAngle(heading - this.yaw) * (1 - Math.exp(-chaseYawStiffness * dt));

    // Detrás del dron = opuesto a su morro: (sin ψ, 0, cos ψ)
    desired.set(Math.sin(this.yaw) * chaseDistance, chaseHeight, Math.cos(this.yaw) * chaseDistance).add(target);
    desired.y = Math.max(desired.y, 0.15); // nunca bajo tierra
    if (!this.initialized) this.camera.position.copy(desired);
    else this.camera.position.lerp(desired, 1 - Math.exp(-chasePositionStiffness * dt));
    this.initialized = true;

    lookTarget.copy(target).y += renderConfig.chaseLookOffset;
    this.camera.lookAt(lookTarget);
  }
}
