// Colisiones del dron con los obstáculos del escenario. Sin motor de física externo: el dron es
// una esfera y los obstáculos son formas simples, y para cada pareja basta con encontrar el punto
// del obstáculo más cercano al centro de la esfera.
//
// - Caja alineada con los ejes (AABB): edificios, bancos, muros, travesaños de las puertas.
// - Cilindro vertical: troncos, postes, farolas.
// - Esfera: copas de los árboles.
//
// Respuesta al choque: se saca el dron del obstáculo, se le quita la velocidad hacia la superficie
// (con un pequeño rebote) y se frena la que va a lo largo de ella. Si el impacto es fuerte, crash.

import { Quaternion, Vector3 } from 'three';
import { collisionConfig, droneConfig } from '../core/config';
import type { DroneState } from './drone';

interface Point {
  x: number;
  y: number;
  z: number;
}

/** Qué es cada obstáculo, para explicar el crash ("chocaste contra un árbol") */
export type ObstacleKind = 'árbol' | 'edificio' | 'banco' | 'farola' | 'poste' | 'puerta' | 'muro' | 'fuente';

export type Collider = { label: ObstacleKind } & (
  | { kind: 'box'; min: Point; max: Point }
  | { kind: 'cylinder'; x: number; z: number; radius: number; bottom: number; top: number }
  | { kind: 'sphere'; x: number; y: number; z: number; radius: number }
);

export interface Contact {
  /** Dirección para sacar la esfera del obstáculo (unitaria) */
  normal: Vector3;
  /** Cuánto se ha metido la esfera dentro del obstáculo (m) */
  depth: number;
}

function clamp(value: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, value));
}

/** Contacto a partir del punto del obstáculo más cercano al centro (si el centro está fuera). */
function contactFromClosest(center: Point, radius: number, cx: number, cy: number, cz: number): Contact | null {
  const dx = center.x - cx;
  const dy = center.y - cy;
  const dz = center.z - cz;
  const distanceSq = dx * dx + dy * dy + dz * dz;
  if (distanceSq >= radius * radius) return null;
  const distance = Math.sqrt(distanceSq);
  return { normal: new Vector3(dx, dy, dz).divideScalar(distance), depth: radius - distance };
}

function collideBox(center: Point, radius: number, min: Point, max: Point): Contact | null {
  const inside =
    center.x > min.x && center.x < max.x && center.y > min.y && center.y < max.y && center.z > min.z && center.z < max.z;
  if (!inside) {
    return contactFromClosest(
      center,
      radius,
      clamp(center.x, min.x, max.x),
      clamp(center.y, min.y, max.y),
      clamp(center.z, min.z, max.z),
    );
  }
  // Centro dentro de la caja (impacto muy rápido): se saca por la cara más cercana
  const exits: [number, Vector3][] = [
    [center.x - min.x, new Vector3(-1, 0, 0)],
    [max.x - center.x, new Vector3(1, 0, 0)],
    [center.y - min.y, new Vector3(0, -1, 0)],
    [max.y - center.y, new Vector3(0, 1, 0)],
    [center.z - min.z, new Vector3(0, 0, -1)],
    [max.z - center.z, new Vector3(0, 0, 1)],
  ];
  const [distance, normal] = exits.reduce((best, exit) => (exit[0] < best[0] ? exit : best));
  return { normal, depth: distance + radius };
}

function collideCylinder(
  center: Point,
  radius: number,
  cylinder: { x: number; z: number; radius: number; bottom: number; top: number },
): Contact | null {
  const dx = center.x - cylinder.x;
  const dz = center.z - cylinder.z;
  const radial = Math.hypot(dx, dz);
  const withinHeight = center.y > cylinder.bottom && center.y < cylinder.top;
  if (radial >= cylinder.radius || !withinHeight) {
    // Punto más cercano: en el borde (o dentro, si está encima/debajo) y a la altura recortada
    const scale = radial > cylinder.radius ? cylinder.radius / radial : 1;
    return contactFromClosest(
      center,
      radius,
      cylinder.x + dx * scale,
      clamp(center.y, cylinder.bottom, cylinder.top),
      cylinder.z + dz * scale,
    );
  }
  // Centro dentro del cilindro: se saca por el lado o por la tapa de arriba, lo que esté más cerca
  const side = cylinder.radius - radial;
  const above = cylinder.top - center.y;
  if (above < side) return { normal: new Vector3(0, 1, 0), depth: above + radius };
  const normal = radial > 1e-9 ? new Vector3(dx / radial, 0, dz / radial) : new Vector3(1, 0, 0);
  return { normal, depth: side + radius };
}

/** Contacto entre una esfera y un obstáculo, o null si no se tocan. */
export function collideSphere(center: Point, radius: number, collider: Collider): Contact | null {
  switch (collider.kind) {
    case 'box':
      return collideBox(center, radius, collider.min, collider.max);
    case 'cylinder':
      return collideCylinder(center, radius, collider);
    case 'sphere':
      return contactFromClosest(center, radius + collider.radius, collider.x, collider.y, collider.z);
  }
}

/** Contra qué se ha estrellado el dron: un obstáculo, el suelo, o el suelo tocado boca abajo (vuelco) */
export type CrashTarget = ObstacleKind | 'suelo' | 'vuelco';

const CRASH_TARGETS: Record<Exclude<CrashTarget, 'vuelco'>, string> = {
  árbol: 'un árbol',
  edificio: 'un edificio',
  banco: 'un banco',
  farola: 'una farola',
  poste: 'un poste',
  puerta: 'una puerta',
  muro: 'un muro',
  fuente: 'la fuente',
  suelo: 'el suelo',
};

export function describeCrash(target: CrashTarget, speed: number): string {
  if (target === 'vuelco') return 'Tocaste el suelo boca abajo: las hélices golpearon el suelo';
  return `Chocaste contra ${CRASH_TARGETS[target]} a ${speed.toFixed(1)} m/s`;
}

export interface Impact {
  /** Velocidad contra la superficie en el peor choque de este paso (m/s); 0 si no hubo choque */
  speed: number;
  /** Con qué se ha chocado más fuerte, o null */
  label: ObstacleKind | null;
}

const UP = new Vector3(0, 1, 0);
const tumbleAxis = new Vector3();
const incoming = new Vector3();
const inverseOrientation = new Quaternion();

/**
 * Resuelve los choques del dron con los obstáculos: lo saca de ellos y corrige su velocidad.
 * @returns el impacto más fuerte del paso, para decidir si es crash
 */
export function resolveCollisions(state: DroneState, colliders: readonly Collider[]): Impact {
  const impact: Impact = { speed: 0, label: null };
  const { restitution, tangentialKeep, tumblePerSpeed } = collisionConfig;
  for (const collider of colliders) {
    const contact = collideSphere(state.position, droneConfig.collisionRadius, collider);
    if (!contact) continue;
    const { normal, depth } = contact;
    state.position.addScaledVector(normal, depth);

    const into = -state.velocity.dot(normal); // velocidad hacia la superficie
    if (into <= 0) continue; // ya se estaba alejando
    if (into > impact.speed) {
      impact.speed = into;
      impact.label = collider.label;
    }
    incoming.copy(state.velocity);
    // Rebote en la normal y rozamiento a lo largo de la superficie
    state.velocity.addScaledVector(normal, into);
    state.velocity.multiplyScalar(tangentialKeep);
    state.velocity.addScaledVector(normal, into * restitution);

    // El golpe hace volcar al dron: contra una pared, sobre un eje horizontal perpendicular al
    // choque (vuelca hacia delante); contra algo horizontal, según la dirección en la que llegaba
    tumbleAxis.crossVectors(UP, normal);
    if (tumbleAxis.lengthSq() < 1e-6) tumbleAxis.crossVectors(normal, incoming);
    if (tumbleAxis.lengthSq() > 1e-9) {
      tumbleAxis.normalize().multiplyScalar(into * tumblePerSpeed);
      inverseOrientation.copy(state.orientation).invert();
      state.angularVelocity.add(tumbleAxis.applyQuaternion(inverseOrientation));
    }
  }
  return impact;
}
