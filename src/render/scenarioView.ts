// Modelos 3D de los escenarios, a partir de sus datos (scenarios/scenarios.ts). Primitivas simples
// con geometrías y materiales compartidos: un parque entero son unas decenas de mallas.

import * as THREE from 'three';
import {
  GATE_BAR_THICKNESS,
  GATE_POST_RADIUS,
  type GateObject,
  type Scenario,
  type ScenarioObject,
} from '../scenarios/scenarios';

const WINDOW_SPACING = 3; // m entre ventanas de los edificios

function standard(color: number, extra: THREE.MeshStandardMaterialParameters = {}): THREE.MeshStandardMaterial {
  return new THREE.MeshStandardMaterial({ color, roughness: 0.9, ...extra });
}

// Compartidos por todos los objetos del mismo tipo
const shared = {
  unitBox: new THREE.BoxGeometry(1, 1, 1),
  unitCylinder: new THREE.CylinderGeometry(1, 1, 1, 12),
  crown: new THREE.IcosahedronGeometry(1, 1),
  trunk: standard(0x6b4a2b),
  leaves: standard(0x3f7d3a, { flatShading: true }),
  wood: standard(0x9a6b3f),
  metal: standard(0x4a4f55, { roughness: 0.5 }),
  lampLight: standard(0xfff1c2, { emissive: 0xffd27a, emissiveIntensity: 1.2 }),
  gate: standard(0xff7a1a, { roughness: 0.6 }),
  concrete: standard(0xa7a39b),
  stone: standard(0xb9b2a5),
  water: standard(0x3b8fd1, { roughness: 0.2 }),
};

let windowTexture: THREE.CanvasTexture | null = null;

/** Fachada con una ventana por celda: se repite tantas veces como quepan en el edificio */
function facadeTexture(): THREE.CanvasTexture {
  if (windowTexture) return windowTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el canvas 2D');
  ctx.fillStyle = '#ffffff';
  ctx.fillRect(0, 0, 64, 64);
  ctx.fillStyle = '#5b6b7c';
  ctx.fillRect(14, 12, 36, 34);
  windowTexture = new THREE.CanvasTexture(canvas);
  windowTexture.wrapS = windowTexture.wrapT = THREE.RepeatWrapping;
  windowTexture.colorSpace = THREE.SRGBColorSpace;
  return windowTexture;
}

/** Malla con sombra, colocada y escalada */
function mesh(
  geometry: THREE.BufferGeometry,
  material: THREE.Material | THREE.Material[],
  position: [number, number, number],
  scale: [number, number, number] = [1, 1, 1],
): THREE.Mesh {
  const result = new THREE.Mesh(geometry, material);
  result.position.set(...position);
  result.scale.set(...scale);
  result.castShadow = true;
  result.receiveShadow = true;
  return result;
}

function gate(object: GateObject): THREE.Group {
  const { x, z, width, height, bottom, alongX } = object;
  const group = new THREE.Group();
  const half = width / 2 + GATE_POST_RADIUS;
  const postHeight = bottom + height + GATE_BAR_THICKNESS;
  for (const side of [-1, 1]) {
    const px = alongX ? side * half : 0;
    const pz = alongX ? 0 : side * half;
    group.add(
      mesh(shared.unitCylinder, shared.gate, [px, postHeight / 2, pz], [GATE_POST_RADIUS, postHeight, GATE_POST_RADIUS]),
    );
  }
  const barLength = 2 * half;
  const barScale: [number, number, number] = alongX
    ? [barLength, GATE_BAR_THICKNESS, GATE_BAR_THICKNESS]
    : [GATE_BAR_THICKNESS, GATE_BAR_THICKNESS, barLength];
  group.add(mesh(shared.unitBox, shared.gate, [0, bottom + height + GATE_BAR_THICKNESS / 2, 0], barScale));
  if (bottom > 0) group.add(mesh(shared.unitBox, shared.gate, [0, bottom - GATE_BAR_THICKNESS / 2, 0], barScale));
  group.position.set(x, 0, z);
  return group;
}

function build(object: ScenarioObject): THREE.Object3D {
  switch (object.type) {
    case 'tree': {
      const { x, z, height, crownRadius } = object;
      const crownY = height - crownRadius;
      const group = new THREE.Group();
      group.add(mesh(shared.unitCylinder, shared.trunk, [0, crownY / 2, 0], [0.2, crownY, 0.2]));
      group.add(mesh(shared.crown, shared.leaves, [0, crownY, 0], [crownRadius, crownRadius, crownRadius]));
      group.position.set(x, 0, z);
      return group;
    }
    case 'building': {
      const { x, z, width, depth, height, shade } = object;
      // Tonos de gris a beige; ventanas en las fachadas, tejado liso
      const color = new THREE.Color(0x8a8f96).lerp(new THREE.Color(0xc9c2b4), shade);
      const facade = facadeTexture().clone();
      facade.repeat.set(Math.max(width, depth) / WINDOW_SPACING, height / WINDOW_SPACING);
      const side = new THREE.MeshStandardMaterial({ color, map: facade, roughness: 0.85 });
      const roof = new THREE.MeshStandardMaterial({ color: color.clone().multiplyScalar(0.7), roughness: 0.95 });
      // Orden de las caras de BoxGeometry: +x, −x, +y (tejado), −y, +z, −z
      return mesh(shared.unitBox, [side, side, roof, roof, side, side], [x, height / 2, z], [width, height, depth]);
    }
    case 'bench': {
      const { x, z, alongX } = object;
      const group = new THREE.Group();
      const [length, width] = [1.6, 0.5];
      group.add(mesh(shared.unitBox, shared.wood, [0, 0.45, 0], [length, 0.08, width]));
      group.add(mesh(shared.unitBox, shared.wood, [0, 0.7, -width / 2], [length, 0.4, 0.06]));
      group.add(mesh(shared.unitBox, shared.metal, [0, 0.22, 0], [length * 0.9, 0.44, width * 0.8]));
      group.position.set(x, 0, z);
      if (!alongX) group.rotation.y = Math.PI / 2;
      return group;
    }
    case 'lamp': {
      const group = new THREE.Group();
      group.add(mesh(shared.unitCylinder, shared.metal, [0, object.height / 2, 0], [0.08, object.height, 0.08]));
      group.add(mesh(shared.crown, shared.lampLight, [0, object.height, 0], [0.22, 0.22, 0.22]));
      group.position.set(object.x, 0, object.z);
      return group;
    }
    case 'pole':
      return mesh(shared.unitCylinder, shared.gate, [object.x, object.height / 2, object.z], [0.1, object.height, 0.1]);
    case 'wall':
      return mesh(
        shared.unitBox,
        shared.concrete,
        [object.x, object.height / 2, object.z],
        [object.width, object.height, object.depth],
      );
    case 'fountain': {
      const { x, z, radius, height } = object;
      const group = new THREE.Group();
      group.add(mesh(shared.unitCylinder, shared.stone, [0, height / 2, 0], [radius, height, radius]));
      group.add(mesh(shared.unitCylinder, shared.water, [0, height + 0.01, 0], [radius * 0.85, 0.02, radius * 0.85]));
      group.position.set(x, 0, z);
      return group;
    }
    case 'gate':
      return gate(object);
  }
}

/** Grupo con todos los objetos del escenario. */
export function buildScenarioView(scenario: Scenario): THREE.Group {
  const group = new THREE.Group();
  group.name = `escenario: ${scenario.label}`;
  for (const object of scenario.objects) group.add(build(object));
  return group;
}

/** Libera la memoria de la GPU de un escenario que se retira (las piezas compartidas se conservan). */
export function disposeScenarioView(group: THREE.Group): void {
  group.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const materials = Array.isArray(child.material) ? child.material : [child.material];
    // Solo los materiales propios de cada edificio; geometrías y materiales compartidos se reutilizan
    for (const material of materials) {
      if (!Object.values(shared).includes(material)) {
        (material as THREE.MeshStandardMaterial).map?.dispose();
        material.dispose();
      }
    }
  });
}
