// Las 10 lecciones, en orden de dificultad, siguiendo lo que se practica al aprender con un DJI.
// Cada lección es solo datos: cómo empieza, qué objetivos tiene y cómo se puntúa.
// Los umbrales de estrellas son orientativos: ajústalos aquí si te resultan fáciles o difíciles.

import type { FlightModeName, WindLevel } from '../core/config';
import { buildScenario, type ScenarioName } from '../scenarios/scenarios';
import {
  AltitudeGoal,
  GatesGoal,
  HoldBoxGoal,
  LandGoal,
  OrbitGoal,
  TakeoffGoal,
  YawTurnGoal,
  type Goal,
  type MarkerSpec,
} from './goals';
import { minStars, rateMetric, rateTime, type LessonMetrics, type Rating } from './scoring';

/** Cámara de la lección: detrás del dron, o desde donde estarías tú (a la vista, como en la realidad) */
export type LessonCamera = 'chase' | 'pilot';

export interface LessonSetup {
  mode: FlightModeName;
  wind: WindLevel;
  camera: LessonCamera;
  /** Escenario (por defecto, el campo libre) */
  scenario?: ScenarioName;
  /** Si empieza ya en el aire: posición (altura sobre el suelo) y rumbo. Si no, posado en la H. */
  airborne?: { x: number; altitude: number; z: number; heading: number };
}

export interface LessonDefinition {
  /** Identificador para la URL (?lesson=...) y los récords */
  id: string;
  title: string;
  summary: string;
  /** Para qué sirve con un dron real */
  skill: string;
  setup: LessonSetup;
  /** Marcadores fijos de la lección (postes...) además de los del objetivo actual */
  staticMarkers?: MarkerSpec[];
  goals(): Goal[];
  rate(metrics: LessonMetrics): Rating;
}

const NORMAL_CALM_CHASE: LessonSetup = { mode: 'normal', wind: 'calm', camera: 'chase' };

/** Combina las puntuaciones de varias métricas: nota final = la peor. */
function combine(...parts: { stars: 1 | 2 | 3; line: string }[]): Rating {
  return { stars: minStars(...parts.map((p) => p.stars)), lines: parts.map((p) => p.line) };
}

const SQUARE_TAIL_IN = [
  { x: -4, z: -14 },
  { x: 4, z: -14 },
  { x: 4, z: -6 },
  { x: -4, z: -6 },
];

const SQUARE_NOSE_IN = [
  { x: -4, z: -6 },
  { x: -4, z: -14 },
  { x: 4, z: -14 },
  { x: 4, z: -6 },
  { x: -4, z: -6 },
];

// Ocho alrededor de dos postes en (±4, −12): primero el bucle derecho, luego el izquierdo,
// cruzando por el centro entre ambos
const EIGHT_CENTER = { x: 0, z: -12 };
const FIGURE_EIGHT = [
  EIGHT_CENTER,
  { x: 4, z: -16 },
  { x: 8, z: -12 },
  { x: 4, z: -8 },
  EIGHT_CENTER,
  { x: -4, z: -16 },
  { x: -8, z: -12 },
  { x: -4, z: -8 },
  EIGHT_CENTER,
];

export const LESSONS: LessonDefinition[] = [
  {
    id: 'despegue',
    title: 'Despegue y aterrizaje',
    summary: 'Despega, mantén el dron en el aire 3 s y vuelve a posarlo con suavidad.',
    skill: 'Lo primero con un DJI: despegue automático o manual y un aterrizaje sin golpe.',
    setup: NORMAL_CALM_CHASE,
    goals: () => [
      new TakeoffGoal(),
      new AltitudeGoal(1.5, 0.7, 3, 'Mantén el dron entre 0,8 y 2,2 m de altura durante 3 s.'),
      new LandGoal('Aterriza: baja despacio (o pulsa Espacio) hasta que el dron se pose.'),
    ],
    rate: (m) => combine(rateTime(m.time, 25, 45), rateMetric('Velocidad al tocar suelo', m.touchdownSpeed, 0.8, 1.5, 'm/s')),
  },
  {
    id: 'hover',
    title: 'Hover estable',
    summary: 'Lleva el dron al cubo y mantenlo dentro 10 s seguidos.',
    skill: 'El hover es la base de todo. En un DJI lo sujeta el GPS, pero colocarlo donde quieres es cosa tuya.',
    setup: NORMAL_CALM_CHASE,
    goals: () => [
      new TakeoffGoal(),
      new HoldBoxGoal({ x: 0, y: 2, z: -4 }, 0.5, 10, 'Mete el dron en el cubo (4 m delante, a 2 m) y mantenlo dentro 10 s.'),
    ],
    rate: (m) => combine(rateMetric('Precisión (error medio)', m.hoverRms, 0.15, 0.3, 'm'), rateTime(m.time, 40, 70)),
  },
  {
    id: 'altura',
    title: 'Control de altura',
    summary: 'Sube a 5 m, quédate ahí y baja a 2 m.',
    skill: 'Dosificar el throttle: subir y bajar sin pasarte, como al encuadrar una toma.',
    setup: NORMAL_CALM_CHASE,
    goals: () => [
      new TakeoffGoal(),
      new AltitudeGoal(5, 0.3, 2, 'Sube a 5 m (mira H en el HUD) y quédate ahí 2 s.'),
      new AltitudeGoal(2, 0.3, 2, 'Ahora baja a 2 m y quédate ahí 2 s.'),
    ],
    rate: (m) => combine(rateTime(m.time, 30, 50)),
  },
  {
    id: 'giro',
    title: 'Giro de 360°',
    summary: 'Gira una vuelta completa sobre ti mismo sin moverte del sitio.',
    skill: 'El yaw sin desplazarse: es como hacer un barrido panorámico con la cámara.',
    setup: NORMAL_CALM_CHASE,
    goals: () => [
      new TakeoffGoal(),
      new YawTurnGoal('Gira una vuelta completa (yaw: gira la tapa o A/D) sin salir del círculo.', 1),
    ],
    rate: (m) => combine(rateMetric('Desplazamiento máximo', m.maxDrift, 0.3, 0.8, 'm'), rateTime(m.time, 20, 35)),
  },
  {
    id: 'cuadrado',
    title: 'Cuadrado con la cola hacia ti',
    summary: 'Recorre un cuadrado de 8 m sin girar el dron, viéndolo desde tu posición.',
    skill: 'Mover el dron solo con avance y lateral, con la cola hacia ti: los controles coinciden con lo que ves.',
    setup: { mode: 'normal', wind: 'calm', camera: 'pilot', airborne: { x: -4, altitude: 3, z: -6, heading: 0 } },
    goals: () => [
      new GatesGoal(SQUARE_TAIL_IN, 'Pasa por las columnas en orden SIN girar el dron: solo avance y lateral.', 'tailIn'),
    ],
    rate: (m) => combine(rateMetric('Desvío de la línea', m.pathRms, 0.8, 1.6, 'm'), rateTime(m.time, 35, 60)),
  },
  {
    id: 'nose-in',
    title: 'Morro hacia ti (nose-in)',
    summary: 'Hover y cuadrado con el morro mirando hacia ti: todo se ve invertido.',
    skill: 'La orientación más difícil y la más importante: así vuelve el dron hacia ti en la vida real.',
    setup: { mode: 'normal', wind: 'calm', camera: 'pilot', airborne: { x: 0, altitude: 3, z: -10, heading: Math.PI } },
    goals: () => [
      new HoldBoxGoal(
        { x: 0, y: 3, z: -10 },
        1,
        5,
        'Mantén el dron en el cubo 5 s con el morro hacia ti. Fíjate: ahora adelante lo acerca a ti.',
        'noseIn',
      ),
      new GatesGoal(SQUARE_NOSE_IN, 'Ahora recorre el cuadrado sin girar: el morro siempre hacia ti.', 'noseIn'),
    ],
    rate: (m) => combine(rateMetric('Desvío de la línea', m.pathRms, 1, 2, 'm'), rateTime(m.time, 60, 100)),
  },
  {
    id: 'circulo',
    title: 'Círculo alrededor de un poste',
    summary: 'Da una vuelta completa al poste a unos 6 m de distancia.',
    skill: 'Combinar dos ejes a la vez. Con yaw para mirar al poste, es la órbita de las tomas de DJI.',
    setup: { mode: 'normal', wind: 'calm', camera: 'pilot', airborne: { x: 0, altitude: 3, z: -6, heading: 0 } },
    goals: () => [
      new OrbitGoal({ x: 0, z: -12 }, 6, 1.5, 'Da una vuelta completa al poste sin salirte de la franja del suelo.'),
    ],
    rate: (m) => combine(rateMetric('Error de radio', m.radiusRms, 0.5, 1, 'm'), rateTime(m.time, 40, 70)),
  },
  {
    id: 'ocho',
    title: 'Ocho',
    summary: 'Recorre un ocho alrededor de dos postes, pasando por las columnas en orden.',
    skill: 'Cambiar de sentido de giro con fluidez: el ejercicio clásico de los exámenes de piloto.',
    setup: { mode: 'normal', wind: 'calm', camera: 'pilot', airborne: { x: 0, altitude: 3, z: -8, heading: 0 } },
    staticMarkers: [
      { kind: 'pole', x: 4, z: -12, height: 6 },
      { kind: 'pole', x: -4, z: -12, height: 6 },
    ],
    goals: () => [new GatesGoal(FIGURE_EIGHT, 'Pasa por las columnas en orden: primero el bucle derecho, luego el izquierdo.')],
    rate: (m) => combine(rateMetric('Desvío de la línea', m.pathRms, 1.2, 2.5, 'm'), rateTime(m.time, 60, 100)),
  },
  {
    id: 'aterrizaje',
    title: 'Aterrizaje de precisión',
    summary: 'Desde el aire, aterriza justo sobre la H.',
    skill: 'Aterrizar en un punto concreto (un barco, una terraza, tu mano): colócate encima y baja despacio.',
    setup: { mode: 'normal', wind: 'calm', camera: 'pilot', airborne: { x: 6, altitude: 4, z: -8, heading: 0 } },
    goals: () => [
      new LandGoal('Aterriza sobre la H: colócate justo encima y baja despacio. Usa la sombra.', {
        x: 0,
        z: 0,
        maxDistance: 1,
      }),
    ],
    rate: (m) =>
      combine(
        rateMetric('Distancia al centro de la H', m.landingDistance, 0.15, 0.4, 'm'),
        rateMetric('Velocidad al tocar suelo', m.touchdownSpeed, 0.6, 1.2, 'm/s'),
      ),
  },
  {
    id: 'atti-viento',
    title: 'Hover en ATTI con viento',
    summary: 'Sin GPS y con viento moderado: mantén el dron dentro del cubo 15 s.',
    skill: 'Lo que pasa si el DJI pierde el GPS: el viento te arrastra y tienes que corregir tú.',
    setup: { mode: 'atti', wind: 'moderate', camera: 'chase', airborne: { x: 0, altitude: 2, z: -3, heading: 0 } },
    goals: () => [
      new HoldBoxGoal({ x: 0, y: 2, z: -3 }, 1, 15, 'Mantén el dron en el cubo 15 s. Al soltar no frena: corrige antes de salirte.'),
    ],
    rate: (m) => combine(rateMetric('Precisión (error medio)', m.hoverRms, 0.4, 0.7, 'm')),
  },
  {
    id: 'parque',
    title: 'Circuito en el parque',
    summary: 'Cruza las 4 puertas del parque en orden y vuelve a cruzar la primera, sin tocar los árboles.',
    skill: 'Volar entre obstáculos reales: medir distancias y frenar a tiempo. Aquí chocar significa estrellarse.',
    setup: { mode: 'normal', wind: 'calm', camera: 'chase', scenario: 'parque' },
    goals: () => [
      new GatesGoal(
        buildScenario('parque').course,
        'Pasa por DENTRO de las 4 puertas en orden y vuelve a cruzar la primera. Por encima no cuenta.',
      ),
    ],
    rate: (m) => combine(rateMetric('Desvío de la línea', m.pathRms, 1.5, 3, 'm'), rateTime(m.time, 45, 75)),
  },
  {
    id: 'obstaculos',
    title: 'Pista de obstáculos',
    summary: 'Puerta, muro, puerta, slalom entre postes y una ventana elevada.',
    skill: 'Cambiar de altura y de dirección con precisión: lo que hace falta para volar cerca de edificios.',
    setup: { mode: 'normal', wind: 'calm', camera: 'chase', scenario: 'obstaculos' },
    goals: () => [
      new GatesGoal(
        buildScenario('obstaculos').course,
        'Puerta, POR ENCIMA del muro, puerta, slalom (derecha, izquierda, derecha) y la ventana elevada.',
      ),
    ],
    rate: (m) => combine(rateMetric('Desvío de la línea', m.pathRms, 1.2, 2.5, 'm'), rateTime(m.time, 40, 70)),
  },
];

export function findLesson(id: string | null): LessonDefinition | null {
  return LESSONS.find((lesson) => lesson.id === id) ?? null;
}

export function nextLesson(lesson: LessonDefinition): LessonDefinition | null {
  return LESSONS[LESSONS.indexOf(lesson) + 1] ?? null;
}
