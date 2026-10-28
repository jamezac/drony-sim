// Cámaras:
// - Tercera persona: detrás y algo por encima del dron. Fácil, pero siempre ves el dron "de espaldas".
// - Piloto: desde donde estás tú, a la vista (como se vuela un DJI de verdad). Aquí sí se nota
//   si el dron viene con el morro hacia ti y los controles se ven invertidos.
// - FPV: la cámara del dron, lo que verías en la pantalla del móvil. Con gimbal estabilizado
//   (como DJI) o fija al cuerpo (como un dron FPV de carreras).
//
// La cámara sigue al dron con un "muelle" exponencial: se acerca a su posición ideal una
// fracción cada frame (1 − e^(−k·dt)), que no depende de los fps. Gira con el rumbo del dron
// pero con algo de retraso, así se nota el giro y no marea.

import * as THREE from 'three';
import { fpvSettings, gimbalConfig, renderConfig } from '../core/config';

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

const desired = new THREE.Vector3();
const lookTarget = new THREE.Vector3();

export class ChaseCamera {
  readonly camera = new THREE.PerspectiveCamera(renderConfig.chaseFov, 1, 0.05, 500);
  private yaw = 0;
  private initialized = false;

  constructor() {
    this.camera.layers.enable(renderConfig.droneLayer);
  }

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

export type CameraMode = 'chase' | 'pilot' | 'fpv';

/** Orden al cambiar de cámara con la tecla C */
export const CAMERA_ORDER: CameraMode[] = ['chase', 'pilot', 'fpv'];

export const CAMERA_LABELS: Record<CameraMode, string> = {
  chase: 'Cámara: detrás del dron',
  pilot: 'Cámara: tú (a la vista)',
  fpv: 'Cámara: FPV (la del dron)',
};

export function nextCamera(mode: CameraMode): CameraMode {
  return CAMERA_ORDER[(CAMERA_ORDER.indexOf(mode) + 1) % CAMERA_ORDER.length];
}

export function parseCameraMode(value: string | null): CameraMode | null {
  return CAMERA_ORDER.find((mode) => mode === value) ?? null;
}

/** Vista del piloto: posición fija a la altura de los ojos, la mirada sigue al dron. */
export class PilotCamera {
  readonly camera = new THREE.PerspectiveCamera(renderConfig.pilotFov, 1, 0.05, 800);
  private readonly look = new THREE.Vector3();
  private initialized = false;

  constructor() {
    const { pilotPosition, pilotEyeHeight } = renderConfig;
    this.camera.position.set(pilotPosition.x, pilotEyeHeight, pilotPosition.z);
    this.camera.layers.enable(renderConfig.droneLayer);
  }

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  snap(target: THREE.Vector3): void {
    this.initialized = false;
    this.update(target, 0);
  }

  update(target: THREE.Vector3, dt: number): void {
    if (!this.initialized) this.look.copy(target);
    else this.look.lerp(target, 1 - Math.exp(-renderConfig.pilotLookStiffness * dt));
    this.initialized = true;
    this.camera.lookAt(this.look);
  }
}

// ---------------------------------------------------------------------------
// FPV y gimbal
// ---------------------------------------------------------------------------

const RIGHT = new THREE.Vector3(1, 0, 0);
const UP = new THREE.Vector3(0, 1, 0);
const tilt = new THREE.Quaternion();
const cameraOffset = new THREE.Vector3();

/** Mueve la inclinación del gimbal: input −1..1 (abajo/arriba), limitada a su rango. */
export function gimbalStep(pitch: number, input: number, dt: number): number {
  const { minPitch, maxPitch, pitchRate } = gimbalConfig;
  return Math.max(minPitch, Math.min(maxPitch, pitch + input * pitchRate * dt));
}

/**
 * Orientación de la cámara FPV.
 * - Estabilizada (gimbal de 3 ejes, como DJI): solo el rumbo y la inclinación del gimbal. El
 *   alabeo y el cabeceo del dron no llegan a la imagen: el horizonte siempre está recto.
 * - Fija al cuerpo: la orientación del dron más la inclinación de la cámara. El horizonte se
 *   inclina en cada giro, que es lo que ve un piloto de FPV de carreras.
 * Las cámaras de Three.js miran hacia su −Z, el mismo "adelante" que el cuerpo del dron.
 */
export function fpvOrientation(
  droneOrientation: THREE.Quaternion,
  heading: number,
  gimbalPitch: number,
  stabilized: boolean,
  out: THREE.Quaternion,
): THREE.Quaternion {
  tilt.setFromAxisAngle(RIGHT, gimbalPitch);
  if (stabilized) return out.setFromAxisAngle(UP, heading).multiply(tilt);
  return out.copy(droneOrientation).multiply(tilt);
}

/** Cámara del dron, con gimbal. */
export class FpvCamera {
  readonly camera = new THREE.PerspectiveCamera(gimbalConfig.fov, 16 / 9, 0.02, 800);
  /** Inclinación del gimbal (rad): 0 = al frente, negativo = hacia abajo */
  pitch = 0;
  private yaw = 0;
  private initialized = false;

  setAspect(aspect: number): void {
    this.camera.aspect = aspect;
    this.camera.updateProjectionMatrix();
  }

  /** Vuelve a colocar el gimbal (al reiniciar): al frente y alineado con el dron. */
  snap(): void {
    this.pitch = 0;
    this.initialized = false;
  }

  /**
   * @param input −1..1 para mover el gimbal hacia abajo/arriba (teclas Q/Z o gatillos del mando)
   * @param heading rumbo del dron
   */
  update(position: THREE.Vector3, orientation: THREE.Quaternion, heading: number, input: number, dt: number): void {
    this.pitch = gimbalStep(this.pitch, input, dt);
    // El gimbal sigue el rumbo del dron con un poco de retraso, por el camino corto
    if (!this.initialized) this.yaw = heading;
    else this.yaw += wrapAngle(heading - this.yaw) * (1 - Math.exp(-gimbalConfig.yawStiffness * dt));
    this.initialized = true;

    const { x, y, z } = gimbalConfig.offset;
    cameraOffset.set(x, y, z).applyQuaternion(orientation);
    this.camera.position.copy(position).add(cameraOffset);
    fpvOrientation(orientation, this.yaw, this.pitch, fpvSettings.stabilized, this.camera.quaternion);
  }
}

/** Rectángulo de la imagen en miniatura (px CSS, origen abajo a la izquierda como WebGL). */
export function pipRect(viewportWidth: number, viewportHeight: number): { x: number; y: number; width: number; height: number } {
  const { width, height, right, bottom, maxWidthFraction } = renderConfig.pip;
  const scale = Math.min(1, (viewportWidth * maxWidthFraction) / width);
  const w = Math.round(width * scale);
  const h = Math.round(height * scale);
  return { x: viewportWidth - right - w, y: Math.min(bottom, viewportHeight - h), width: w, height: h };
}
