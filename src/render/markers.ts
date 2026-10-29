// Marcadores de las lecciones en la escena: cubos, columnas-puerta, recorridos en el suelo, postes...
// Se reconstruyen solo cuando cambian (al pasar de objetivo, al cruzar una puerta, al entrar en el
// cubo), no en cada frame.

import * as THREE from 'three';
import { droneConfig } from '../core/config';
import type { MarkerSpec } from '../training/goals';

const COLORS = {
  target: 0x3fb6ff,
  inside: 0x3fcf8e,
  next: 0xffb74d,
  pending: 0xffffff,
  done: 0x3fcf8e,
  ground: 0xffcf5c,
  pole: 0xff7a1a,
};
const GATE_HEIGHT = 5; // m: columnas altas, visibles desde lejos
const GROUND_LIFT = 0.04; // m: para que las líneas del suelo no parpadeen con él

function translucent(color: number, opacity: number): THREE.MeshBasicMaterial {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, side: THREE.DoubleSide });
}

function circlePoints(x: number, z: number, radius: number, y: number): THREE.Vector3[] {
  return Array.from({ length: 65 }, (_, i) => {
    const angle = (i / 64) * Math.PI * 2;
    return new THREE.Vector3(x + Math.cos(angle) * radius, y, z + Math.sin(angle) * radius);
  });
}

function line(points: THREE.Vector3[], color: number, dashed = false): THREE.Line {
  const geometry = new THREE.BufferGeometry().setFromPoints(points);
  const material = dashed
    ? new THREE.LineDashedMaterial({ color, dashSize: 0.6, gapSize: 0.4, transparent: true, opacity: 0.8 })
    : new THREE.LineBasicMaterial({ color, transparent: true, opacity: 0.9 });
  const result = new THREE.Line(geometry, material);
  if (dashed) result.computeLineDistances();
  return result;
}

function build(spec: MarkerSpec): THREE.Object3D {
  const rest = droneConfig.restHeight;
  switch (spec.kind) {
    case 'box': {
      const size = spec.halfSize * 2;
      const color = spec.active ? COLORS.inside : COLORS.target;
      const group = new THREE.Group();
      const geometry = new THREE.BoxGeometry(size, size, size);
      group.add(new THREE.Mesh(geometry, translucent(color, 0.12)));
      group.add(new THREE.LineSegments(new THREE.EdgesGeometry(geometry), new THREE.LineBasicMaterial({ color })));
      group.position.set(spec.x, rest + spec.y, spec.z);
      return group;
    }
    case 'gate': {
      const color = COLORS[spec.state];
      // Solo la siguiente destaca; las demás, casi transparentes para no tapar el dron
      const opacity = spec.state === 'next' ? 0.3 : 0.06;
      // Con franja de altura (puerta real), la columna ocupa solo la abertura
      const bottom = spec.minAltitude ?? 0;
      const height = spec.maxAltitude !== undefined ? spec.maxAltitude - bottom : GATE_HEIGHT;
      const column = new THREE.Mesh(
        new THREE.CylinderGeometry(spec.radius, spec.radius, height, 32, 1, true),
        translucent(color, opacity),
      );
      column.position.set(spec.x, rest + bottom + height / 2, spec.z);
      return column;
    }
    case 'path': {
      const points = spec.points.map((p) => new THREE.Vector3(p.x, GROUND_LIFT, p.z));
      return line(points, COLORS.pending, true);
    }
    case 'altitude': {
      // Anillo horizontal a la altura objetivo; sigue al dron en horizontal (ver follow)
      const ring = new THREE.Mesh(new THREE.RingGeometry(0.7, 0.9, 48), translucent(COLORS.target, 0.5));
      ring.rotation.x = -Math.PI / 2;
      ring.position.y = rest + spec.y;
      ring.userData.followDrone = true;
      return ring;
    }
    case 'groundCircle':
      return line(circlePoints(spec.x, spec.z, spec.radius, GROUND_LIFT), COLORS.ground);
    case 'pole': {
      const pole = new THREE.Mesh(
        new THREE.CylinderGeometry(0.08, 0.08, spec.height, 12),
        new THREE.MeshStandardMaterial({ color: COLORS.pole }),
      );
      pole.position.set(spec.x, spec.height / 2, spec.z);
      pole.castShadow = true;
      return pole;
    }
    case 'landing': {
      const group = new THREE.Group();
      group.add(line(circlePoints(spec.x, spec.z, spec.radius, GROUND_LIFT), COLORS.ground));
      group.add(line(circlePoints(spec.x, spec.z, 0.15, GROUND_LIFT), COLORS.ground));
      return group;
    }
  }
}

function dispose(object: THREE.Object3D): void {
  object.traverse((child) => {
    if (child instanceof THREE.Mesh || child instanceof THREE.Line) {
      child.geometry.dispose();
      (Array.isArray(child.material) ? child.material : [child.material]).forEach((m) => m.dispose());
    }
  });
}

export class MarkerLayer {
  readonly group = new THREE.Group();
  private key = '';

  /** Muestra exactamente estos marcadores (no hace nada si no han cambiado). */
  sync(specs: MarkerSpec[]): void {
    const key = JSON.stringify(specs);
    if (key === this.key) return;
    this.key = key;
    for (const child of [...this.group.children]) {
      dispose(child);
      this.group.remove(child);
    }
    for (const spec of specs) this.group.add(build(spec));
  }

  /** Mueve los marcadores que acompañan al dron (el anillo de altura) */
  follow(x: number, z: number): void {
    for (const child of this.group.children) {
      if (child.userData.followDrone) child.position.set(x, child.position.y, z);
    }
  }

  clear(): void {
    this.sync([]);
  }
}
