// Escenarios: qué objetos hay y dónde. Son solo datos; de ellos salen las formas de colisión
// (para la física) y los modelos 3D (render/scenarioView.ts). Todo con semilla: el mismo escenario
// siempre es idéntico, así los récords de las lecciones son comparables.

import { Random } from '../core/random';
import type { Collider } from '../physics/collisions';

export type ScenarioName = 'libre' | 'parque' | 'ciudad' | 'obstaculos';

/** Puertas: dos postes y un travesaño (y otro abajo si la ventana está elevada) */
export interface GateObject {
  type: 'gate';
  x: number;
  z: number;
  /** Ancho y alto de la abertura (m) */
  width: number;
  height: number;
  /** Altura del borde inferior de la abertura (0 = desde el suelo) */
  bottom: number;
  /** true: los postes están a los lados en X y la puerta se cruza moviéndose en Z */
  alongX: boolean;
}

export type ScenarioObject =
  | { type: 'tree'; x: number; z: number; height: number; crownRadius: number }
  | { type: 'building'; x: number; z: number; width: number; depth: number; height: number; shade: number }
  | { type: 'bench'; x: number; z: number; alongX: boolean }
  | { type: 'lamp'; x: number; z: number; height: number }
  | { type: 'pole'; x: number; z: number; height: number }
  | { type: 'wall'; x: number; z: number; width: number; depth: number; height: number }
  | { type: 'fountain'; x: number; z: number; radius: number; height: number }
  | GateObject;

/** Un punto por el que hay que pasar en una lección (con franja de altura si es una puerta) */
export interface Waypoint {
  x: number;
  z: number;
  minAltitude?: number;
  maxAltitude?: number;
}

export interface Scenario {
  name: ScenarioName;
  label: string;
  objects: ScenarioObject[];
  /** Recorrido de la lección del escenario (si tiene) */
  course: Waypoint[];
  /** Los conos de referencia del campo libre (en un escenario con objetos estorban) */
  showReferenceCones: boolean;
}

export const SCENARIO_ORDER: ScenarioName[] = ['libre', 'parque', 'ciudad', 'obstaculos'];

export const SCENARIO_LABELS: Record<ScenarioName, string> = {
  libre: 'campo libre',
  parque: 'parque',
  ciudad: 'ciudad',
  obstaculos: 'pista de obstáculos',
};

export function nextScenario(name: ScenarioName): ScenarioName {
  return SCENARIO_ORDER[(SCENARIO_ORDER.indexOf(name) + 1) % SCENARIO_ORDER.length];
}

export function parseScenarioName(value: string | null): ScenarioName | null {
  return SCENARIO_ORDER.find((name) => name === value) ?? null;
}

// Medidas de las piezas (m)
export const GATE_POST_RADIUS = 0.08;
export const GATE_BAR_THICKNESS = 0.15;
const BENCH = { length: 1.6, width: 0.5, height: 0.9 };
const LAMP_RADIUS = 0.08;
const POLE_RADIUS = 0.1;
/** Zona despejada alrededor del despegue y de la manga de viento */
const HOME_CLEAR_RADIUS = 10;
const WINDSOCK = { x: 3, z: -10, clearRadius: 3 };

function distance(ax: number, az: number, bx: number, bz: number): number {
  return Math.hypot(ax - bx, az - bz);
}

/** Paso por una puerta: su centro y la franja de altura de la abertura */
function gateWaypoint(gate: GateObject): Waypoint {
  return { x: gate.x, z: gate.z, minAltitude: gate.bottom + 0.3, maxAltitude: gate.bottom + gate.height - 0.3 };
}

// ---------------------------------------------------------------------------

function park(): Scenario {
  // Circuito de 4 puertas en círculo alrededor de una fuente, a 12 m de su centro
  const center = { x: 0, z: -24 };
  const ring = 12;
  const gates: GateObject[] = [
    { type: 'gate', x: center.x, z: center.z + ring, width: 3, height: 3, bottom: 0, alongX: false },
    { type: 'gate', x: center.x + ring, z: center.z, width: 3, height: 3, bottom: 0, alongX: true },
    { type: 'gate', x: center.x, z: center.z - ring, width: 3, height: 3, bottom: 0, alongX: false },
    { type: 'gate', x: center.x - ring, z: center.z, width: 3, height: 3, bottom: 0, alongX: true },
  ];
  const objects: ScenarioObject[] = [
    ...gates,
    { type: 'fountain', x: center.x, z: center.z, radius: 2, height: 0.8 },
    { type: 'bench', x: center.x, z: center.z + 4, alongX: true },
    { type: 'bench', x: center.x, z: center.z - 4, alongX: true },
    { type: 'bench', x: center.x + 4, z: center.z, alongX: false },
    { type: 'bench', x: center.x - 4, z: center.z, alongX: false },
  ];

  // Farolas alrededor del circuito, por fuera del pasillo
  for (let i = 0; i < 8; i++) {
    const angle = Math.PI / 8 + (i * Math.PI) / 4;
    const x = center.x + 19 * Math.cos(angle);
    const z = center.z + 19 * Math.sin(angle);
    if (distance(x, z, 0, 0) > HOME_CLEAR_RADIUS) objects.push({ type: 'lamp', x, z, height: 4.5 });
  }

  // Árboles repartidos al azar (con semilla), lejos del despegue, del pasillo del circuito y entre sí
  const random = new Random(7);
  const trees: { x: number; z: number }[] = [];
  for (let attempt = 0; attempt < 3000 && trees.length < 32; attempt++) {
    const x = -45 + random.next() * 90;
    const z = -70 + random.next() * 90;
    const fromCenter = distance(x, z, center.x, center.z);
    const blocked =
      distance(x, z, 0, 0) < HOME_CLEAR_RADIUS + 2 ||
      fromCenter < ring + 6 ||
      distance(x, z, WINDSOCK.x, WINDSOCK.z) < WINDSOCK.clearRadius + 2 ||
      trees.some((t) => distance(x, z, t.x, t.z) < 5);
    if (blocked) continue;
    trees.push({ x, z });
    objects.push({ type: 'tree', x, z, height: 5 + random.next() * 4, crownRadius: 1.5 + random.next() });
  }

  return {
    name: 'parque',
    label: SCENARIO_LABELS.parque,
    objects,
    course: [...gates, gates[0]].map(gateWaypoint),
    showReferenceCones: false,
  };
}

function city(): Scenario {
  // Manzanas de 20 × 20 m separadas por calles de 12 m, con una plaza vacía en el centro (el despegue)
  const random = new Random(11);
  const spacing = 32;
  const objects: ScenarioObject[] = [];
  for (let i = -3; i <= 3; i++) {
    for (let j = -3; j <= 3; j++) {
      if (i === 0 && j === 0) continue; // la plaza
      if (random.next() < 0.15) continue; // algún solar vacío
      const size = 18 - random.next() * 4;
      objects.push({
        type: 'building',
        x: i * spacing,
        z: j * spacing,
        width: size,
        depth: 18 - random.next() * 4,
        height: 8 + random.next() * 37,
        shade: random.next(),
      });
    }
  }
  for (const [x, z] of [
    [-8, -8],
    [8, -8],
    [-8, 8],
    [8, 8],
  ]) {
    objects.push({ type: 'lamp', x, z, height: 5 });
  }
  return { name: 'ciudad', label: SCENARIO_LABELS.ciudad, objects, course: [], showReferenceCones: false };
}

function obstacleCourse(): Scenario {
  // En línea recta hacia delante desde el despegue: puerta, muro, puerta, slalom y ventana elevada
  const gate1: GateObject = { type: 'gate', x: 0, z: -12, width: 3, height: 2.5, bottom: 0, alongX: true };
  const gate2: GateObject = { type: 'gate', x: 0, z: -30, width: 3, height: 2.5, bottom: 0, alongX: true };
  const window: GateObject = { type: 'gate', x: 0, z: -64, width: 3, height: 2, bottom: 3, alongX: true };
  const slalom = [-38, -46, -54];
  const objects: ScenarioObject[] = [
    gate1,
    { type: 'wall', x: 0, z: -22, width: 12, depth: 0.5, height: 4 },
    gate2,
    ...slalom.map((z): ScenarioObject => ({ type: 'pole', x: 0, z, height: 6 })),
    window,
  ];
  const course: Waypoint[] = [
    gateWaypoint(gate1),
    // Por encima del muro
    { x: 0, z: -22, minAltitude: 4.5 },
    gateWaypoint(gate2),
    // Slalom: por la derecha del primer poste, la izquierda del segundo...
    ...slalom.map((z, i) => ({ x: i % 2 === 0 ? 2.5 : -2.5, z })),
    gateWaypoint(window),
  ];
  return { name: 'obstaculos', label: SCENARIO_LABELS.obstaculos, objects, course, showReferenceCones: false };
}

export function buildScenario(name: ScenarioName): Scenario {
  switch (name) {
    case 'parque':
      return park();
    case 'ciudad':
      return city();
    case 'obstaculos':
      return obstacleCourse();
    case 'libre':
      return { name: 'libre', label: SCENARIO_LABELS.libre, objects: [], course: [], showReferenceCones: true };
  }
}

// ---------------------------------------------------------------------------

/** Caja alineada con los ejes, centrada en (x, z) en horizontal y de y0 a y1 en altura */
function boxAround(
  label: Collider['label'],
  x: number,
  z: number,
  halfX: number,
  halfZ: number,
  y0: number,
  y1: number,
): Collider {
  return { label, kind: 'box', min: { x: x - halfX, y: y0, z: z - halfZ }, max: { x: x + halfX, y: y1, z: z + halfZ } };
}

/** Cilindro vertical desde el suelo */
function column(label: Collider['label'], x: number, z: number, radius: number, height: number): Collider {
  return { label, kind: 'cylinder', x, z, radius, bottom: 0, top: height };
}

/** Formas de colisión de los objetos (lo que ve la física). */
export function scenarioColliders(objects: readonly ScenarioObject[]): Collider[] {
  return objects.flatMap((object): Collider[] => {
    switch (object.type) {
      case 'tree': {
        // Tronco hasta la copa, y la copa como esfera
        const crownY = object.height - object.crownRadius;
        return [
          { label: 'árbol', kind: 'cylinder', x: object.x, z: object.z, radius: 0.2, bottom: 0, top: crownY },
          { label: 'árbol', kind: 'sphere', x: object.x, y: crownY, z: object.z, radius: object.crownRadius },
        ];
      }
      case 'building':
        return [boxAround('edificio', object.x, object.z, object.width / 2, object.depth / 2, 0, object.height)];
      case 'bench': {
        const halfX = (object.alongX ? BENCH.length : BENCH.width) / 2;
        const halfZ = (object.alongX ? BENCH.width : BENCH.length) / 2;
        return [boxAround('banco', object.x, object.z, halfX, halfZ, 0, BENCH.height)];
      }
      case 'lamp':
        return [column('farola', object.x, object.z, LAMP_RADIUS, object.height)];
      case 'pole':
        return [column('poste', object.x, object.z, POLE_RADIUS, object.height)];
      case 'fountain':
        return [column('fuente', object.x, object.z, object.radius, object.height)];
      case 'wall':
        return [boxAround('muro', object.x, object.z, object.width / 2, object.depth / 2, 0, object.height)];
      case 'gate':
        return gateColliders(object);
    }
  });
}

function gateColliders(gate: GateObject): Collider[] {
  const { x, z, width, height, bottom, alongX } = gate;
  const half = width / 2 + GATE_POST_RADIUS;
  const top = bottom + height;
  // Los postes, a cada lado de la abertura
  const posts: Collider[] = [-1, 1].map((side) => ({
    label: 'puerta',
    kind: 'cylinder',
    x: alongX ? x + side * half : x,
    z: alongX ? z : z + side * half,
    radius: GATE_POST_RADIUS,
    bottom: 0,
    top: top + GATE_BAR_THICKNESS,
  }));
  /** Travesaño horizontal entre los postes, entre las alturas y0 e y1 */
  const thickness = GATE_BAR_THICKNESS / 2;
  const bar = (y0: number, y1: number): Collider =>
    boxAround('puerta', x, z, alongX ? half : thickness, alongX ? thickness : half, y0, y1);
  const colliders = [...posts, bar(top, top + GATE_BAR_THICKNESS)];
  if (bottom > 0) colliders.push(bar(bottom - GATE_BAR_THICKNESS, bottom));
  return colliders;
}
