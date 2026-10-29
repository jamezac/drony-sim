// Objetivos de las lecciones. Cada lección es una secuencia de objetivos (despegar, mantenerse en
// un cubo, pasar por puertas...). Son lógica pura: reciben un "fotograma" con el estado del dron
// y dicen cuánto falta. Así se pueden probar con trayectorias inventadas, sin navegador.

import type { FlightPhase } from '../control/flightState';
import type { Sticks } from '../core/controlInput';
import type { Waypoint } from '../scenarios/scenarios';
import { orientationToPilot, type Orientation } from './orientation';

/** Lo que ve una lección del dron en cada momento */
export interface LessonFrame {
  x: number;
  z: number;
  /** Altura sobre el suelo (m) */
  altitude: number;
  heading: number;
  /** Componente vertical del "arriba" del dron: 1 nivelado, 0 de lado, −1 boca abajo */
  upright: number;
  verticalSpeed: number;
  phase: FlightPhase;
  onGround: boolean;
  sticks: Sticks;
  /** Si el dron se ha estrellado, la explicación ("Chocaste contra un árbol a 4.2 m/s") */
  crash: string | null;
}

/** Marcadores que se dibujan en la escena (alturas sobre el suelo) */
export type MarkerSpec =
  | { kind: 'box'; x: number; y: number; z: number; halfSize: number; active: boolean }
  | {
      kind: 'gate';
      x: number;
      z: number;
      radius: number;
      state: 'next' | 'pending' | 'done';
      /** Franja de altura por la que hay que pasar (puertas reales); sin ella, columna desde el suelo */
      minAltitude?: number;
      maxAltitude?: number;
    }
  | { kind: 'path'; points: { x: number; z: number }[] }
  | { kind: 'altitude'; y: number }
  | { kind: 'groundCircle'; x: number; z: number; radius: number }
  | { kind: 'pole'; x: number; z: number; height: number }
  | { kind: 'landing'; x: number; z: number; radius: number };

export interface GoalUpdate {
  /** 0..1 */
  progress: number;
  done: boolean;
  /** Consejo puntual (p. ej. "vuelve al cubo") */
  hint?: string;
  /** Si el intento ya no puede superarse (p. ej. aterrizó fuera de la H) */
  failed?: string;
}

export interface Goal {
  readonly instruction: string;
  update(frame: LessonFrame, dt: number): GoalUpdate;
  markers(): MarkerSpec[];
  /** Métricas para la puntuación (m, m/s...) */
  metrics(): Record<string, number>;
}

/** Orientación exigida respecto al piloto, con el consejo que se da si no se cumple */
const ORIENTATION_HINTS: Partial<Record<Orientation, string>> = {
  noseIn: 'Gira el dron: el MORRO tiene que mirar hacia ti.',
  tailIn: 'Gira el dron: la COLA tiene que mirar hacia ti.',
};

/** Altura mínima para considerar que el dron está volando (y no posado o rozando el suelo) */
const MIN_FLYING_ALTITUDE = 0.5;

function airborne(frame: LessonFrame): boolean {
  return !frame.onGround && frame.altitude > MIN_FLYING_ALTITUDE;
}

function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

/** Raíz del error cuadrático medio: penaliza más los errores grandes que una media normal */
class RmsAccumulator {
  private sumSquares = 0;
  private samples = 0;

  add(error: number): void {
    this.sumSquares += error * error;
    this.samples++;
  }

  get value(): number {
    return this.samples ? Math.sqrt(this.sumSquares / this.samples) : 0;
  }
}

/** Distancia del punto P al segmento AB (en el plano horizontal) */
export function distanceToSegment(px: number, pz: number, ax: number, az: number, bx: number, bz: number): number {
  const dx = bx - ax;
  const dz = bz - az;
  const lengthSq = dx * dx + dz * dz;
  const t = lengthSq ? clamp01(((px - ax) * dx + (pz - az) * dz) / lengthSq) : 0;
  return Math.hypot(px - (ax + t * dx), pz - (az + t * dz));
}

// ---------------------------------------------------------------------------

/** Despegar hasta una altura mínima. */
export class TakeoffGoal implements Goal {
  readonly instruction: string;
  private readonly minAltitude: number;

  constructor(minAltitude = 1, instruction = 'Despega: Espacio o botón izquierdo (o E para arrancar motores y sube la tapa).') {
    this.minAltitude = minAltitude;
    this.instruction = instruction;
  }

  update(frame: LessonFrame): GoalUpdate {
    const progress = clamp01(frame.onGround ? 0 : frame.altitude / this.minAltitude);
    return { progress, done: progress >= 1 };
  }

  markers(): MarkerSpec[] {
    return [];
  }

  metrics(): Record<string, number> {
    return {};
  }
}

/** Mantener la altura dentro de una franja durante un tiempo seguido. */
export class AltitudeGoal implements Goal {
  readonly instruction: string;
  private readonly low: number;
  private readonly high: number;
  private readonly seconds: number;
  private timer = 0;

  constructor(target: number, tolerance: number, seconds: number, instruction: string) {
    this.low = target - tolerance;
    this.high = target + tolerance;
    this.seconds = seconds;
    this.instruction = instruction;
  }

  update(frame: LessonFrame, dt: number): GoalUpdate {
    const inside = !frame.onGround && frame.altitude >= this.low && frame.altitude <= this.high;
    this.timer = inside ? this.timer + dt : 0;
    const hint = inside ? undefined : frame.altitude < this.low ? 'Sube un poco más.' : 'Baja un poco.';
    return { progress: clamp01(this.timer / this.seconds), done: this.timer >= this.seconds, hint };
  }

  markers(): MarkerSpec[] {
    return [{ kind: 'altitude', y: (this.low + this.high) / 2 }];
  }

  metrics(): Record<string, number> {
    return {};
  }
}

/** Mantener el dron dentro de un cubo (y opcionalmente con una orientación) un tiempo seguido. */
export class HoldBoxGoal implements Goal {
  readonly instruction: string;
  private readonly center: { x: number; y: number; z: number };
  private readonly halfSize: number;
  private readonly seconds: number;
  private readonly orientation: Orientation | null;
  private timer = 0;
  private inside = false;
  private readonly error = new RmsAccumulator();

  constructor(
    center: { x: number; y: number; z: number },
    halfSize: number,
    seconds: number,
    instruction: string,
    orientation: Orientation | null = null,
  ) {
    this.center = center;
    this.halfSize = halfSize;
    this.seconds = seconds;
    this.instruction = instruction;
    this.orientation = orientation;
  }

  update(frame: LessonFrame, dt: number): GoalUpdate {
    const { x, y, z } = this.center;
    const dx = frame.x - x;
    const dy = frame.altitude - y;
    const dz = frame.z - z;
    const inBox = !frame.onGround && Math.max(Math.abs(dx), Math.abs(dy), Math.abs(dz)) <= this.halfSize;
    const oriented = this.orientation === null || orientationToPilot(frame.x, frame.z, frame.heading) === this.orientation;
    this.inside = inBox && oriented;
    this.timer = this.inside ? this.timer + dt : 0;
    // La precisión se mide mientras cuenta el tiempo: lo bien que se mantiene, no lo que tarda en llegar
    if (this.inside) this.error.add(Math.hypot(dx, dy, dz));

    let hint: string | undefined;
    if (!inBox) hint = this.timer === 0 ? 'Lleva el dron al cubo y mantenlo dentro.' : undefined;
    else if (!oriented && this.orientation) hint = ORIENTATION_HINTS[this.orientation];
    return { progress: clamp01(this.timer / this.seconds), done: this.timer >= this.seconds, hint };
  }

  markers(): MarkerSpec[] {
    const { x, y, z } = this.center;
    return [{ kind: 'box', x, y, z, halfSize: this.halfSize, active: this.inside }];
  }

  metrics(): Record<string, number> {
    return { hoverRms: this.error.value };
  }
}

/** Girar sobre sí mismo una vuelta completa (en cualquier sentido) sin desplazarse. */
export class YawTurnGoal implements Goal {
  readonly instruction: string;
  private readonly totalAngle: number;
  private readonly radius: number;
  private start: { x: number; z: number } | null = null;
  private lastHeading: number | null = null;
  private turned = 0;
  private maxDrift = 0;

  constructor(instruction: string, radius = 1, totalAngle = 2 * Math.PI) {
    this.instruction = instruction;
    this.radius = radius;
    this.totalAngle = totalAngle;
  }

  update(frame: LessonFrame): GoalUpdate {
    if (!airborne(frame)) return { progress: clamp01(Math.abs(this.turned) / this.totalAngle), done: false };
    this.start ??= { x: frame.x, z: frame.z };
    if (this.lastHeading !== null) this.turned += wrapAngle(frame.heading - this.lastHeading);
    this.lastHeading = frame.heading;
    const drift = Math.hypot(frame.x - this.start.x, frame.z - this.start.z);
    this.maxDrift = Math.max(this.maxDrift, drift);
    const progress = clamp01(Math.abs(this.turned) / this.totalAngle);
    const hint = drift > this.radius ? 'Te estás desplazando: vuelve al círculo mientras giras.' : undefined;
    return { progress, done: progress >= 1, hint };
  }

  markers(): MarkerSpec[] {
    return this.start ? [{ kind: 'groundCircle', x: this.start.x, z: this.start.z, radius: this.radius }] : [];
  }

  metrics(): Record<string, number> {
    return { maxDrift: this.maxDrift };
  }
}

/**
 * Pasar por una serie de puntos en orden: columnas en el campo libre o puertas reales de un escenario
 * (estas con franja de altura: pasar por encima de la puerta no cuenta). Opcionalmente, con una
 * orientación respecto al piloto.
 */
export class GatesGoal implements Goal {
  readonly instruction: string;
  private readonly gates: Waypoint[];
  private readonly radius: number;
  private readonly orientation: Orientation | null;
  private next = 0;
  private previous: { x: number; z: number } | null = null;
  private readonly pathError = new RmsAccumulator();

  constructor(
    gates: Waypoint[],
    instruction: string,
    orientation: Orientation | null = null,
    radius = 1.2,
  ) {
    this.gates = gates;
    this.instruction = instruction;
    this.orientation = orientation;
    this.radius = radius;
  }

  update(frame: LessonFrame): GoalUpdate {
    const progress = (): number => this.next / this.gates.length;
    if (!airborne(frame)) return { progress: progress(), done: false, hint: 'Despega para empezar el recorrido.' };
    this.previous ??= { x: frame.x, z: frame.z };

    const target = this.gates[this.next];
    // Lo bien que sigue la línea recta entre la puerta anterior y la siguiente
    this.pathError.add(distanceToSegment(frame.x, frame.z, this.previous.x, this.previous.z, target.x, target.z));

    let hint: string | undefined;
    if (this.orientation) {
      const current = orientationToPilot(frame.x, frame.z, frame.heading);
      if (current !== this.orientation && current !== 'near') hint = ORIENTATION_HINTS[this.orientation];
    }
    const inside = Math.hypot(frame.x - target.x, frame.z - target.z) <= this.radius;
    const low = target.minAltitude ?? -Infinity;
    const high = target.maxAltitude ?? Infinity;
    const atHeight = frame.altitude >= low && frame.altitude <= high;
    if (inside && !atHeight && !hint) {
      hint = frame.altitude > high ? 'Por encima no cuenta: pasa por dentro de la puerta.' : 'Sube un poco: pasa por dentro.';
    }
    if (inside && atHeight && !hint) {
      this.previous = target;
      this.next++;
    }
    return { progress: progress(), done: this.next >= this.gates.length, hint };
  }

  markers(): MarkerSpec[] {
    const gates: MarkerSpec[] = this.gates.map((gate, i) => ({
      kind: 'gate',
      x: gate.x,
      z: gate.z,
      radius: this.radius,
      state: i < this.next ? 'done' : i === this.next ? 'next' : 'pending',
      minAltitude: gate.minAltitude,
      maxAltitude: gate.maxAltitude,
    }));
    return [{ kind: 'path', points: this.gates }, ...gates];
  }

  metrics(): Record<string, number> {
    return { pathRms: this.pathError.value };
  }
}

/** Dar vueltas alrededor de un punto a un radio dado. Solo cuenta el ángulo recorrido dentro de la franja. */
export class OrbitGoal implements Goal {
  readonly instruction: string;
  private readonly center: { x: number; z: number };
  private readonly radius: number;
  private readonly tolerance: number;
  private readonly totalAngle: number;
  private lastAngle: number | null = null;
  private turned = 0;
  private readonly radiusError = new RmsAccumulator();

  constructor(center: { x: number; z: number }, radius: number, tolerance: number, instruction: string, turns = 1) {
    this.center = center;
    this.radius = radius;
    this.tolerance = tolerance;
    this.instruction = instruction;
    this.totalAngle = 2 * Math.PI * turns;
  }

  update(frame: LessonFrame): GoalUpdate {
    const progress = (): number => clamp01(Math.abs(this.turned) / this.totalAngle);
    if (!airborne(frame)) return { progress: progress(), done: false };
    const dx = frame.x - this.center.x;
    const dz = frame.z - this.center.z;
    const distance = Math.hypot(dx, dz);
    const angle = Math.atan2(dz, dx);
    const inBand = Math.abs(distance - this.radius) <= this.tolerance;
    this.radiusError.add(distance - this.radius);
    if (inBand && this.lastAngle !== null) this.turned += wrapAngle(angle - this.lastAngle);
    this.lastAngle = inBand ? angle : null;
    const hint = inBand ? undefined : distance < this.radius ? 'Demasiado cerca del poste: abre el círculo.' : 'Demasiado lejos: cierra el círculo.';
    return { progress: progress(), done: progress() >= 1, hint };
  }

  markers(): MarkerSpec[] {
    const { x, z } = this.center;
    return [
      { kind: 'pole', x, z, height: 6 },
      { kind: 'groundCircle', x, z, radius: this.radius },
    ];
  }

  metrics(): Record<string, number> {
    return { radiusRms: this.radiusError.value };
  }
}

/** Aterrizar (y parar o dejar al ralentí los motores), opcionalmente sobre un punto. */
export class LandGoal implements Goal {
  readonly instruction: string;
  private readonly target: { x: number; z: number; maxDistance: number } | null;
  private wasAirborne = false;
  private lastVerticalSpeed = 0;
  private touchdownSpeed = 0;
  private landingDistance = 0;

  constructor(instruction: string, target: { x: number; z: number; maxDistance: number } | null = null) {
    this.instruction = instruction;
    this.target = target;
  }

  update(frame: LessonFrame): GoalUpdate {
    if (airborne(frame)) this.wasAirborne = true;
    if (!frame.onGround) {
      // La velocidad justo antes de tocar suelo: lo que mide lo suave que ha sido el aterrizaje
      this.lastVerticalSpeed = frame.verticalSpeed;
      return { progress: 0, done: false };
    }
    const landed = this.wasAirborne && (frame.phase === 'armed' || frame.phase === 'disarmed');
    if (!landed) return { progress: 0, done: false };

    this.touchdownSpeed = Math.max(0, -this.lastVerticalSpeed);
    if (this.target) {
      this.landingDistance = Math.hypot(frame.x - this.target.x, frame.z - this.target.z);
      if (this.landingDistance > this.target.maxDistance) {
        return {
          progress: 1,
          done: false,
          failed: `Has aterrizado a ${this.landingDistance.toFixed(1)} m de la H (máximo ${this.target.maxDistance} m).`,
        };
      }
    }
    return { progress: 1, done: true };
  }

  markers(): MarkerSpec[] {
    return this.target ? [{ kind: 'landing', x: this.target.x, z: this.target.z, radius: this.target.maxDistance }] : [];
  }

  metrics(): Record<string, number> {
    return this.target
      ? { touchdownSpeed: this.touchdownSpeed, landingDistance: this.landingDistance }
      : { touchdownSpeed: this.touchdownSpeed };
  }
}

/** "Arriba" del dron por encima de esto: nivelado (inclinación < ~25°) */
const LEVEL_UPRIGHT = 0.9;
/** "Arriba" del dron por debajo de esto: boca abajo (inclinación > ~135°) */
const INVERTED_UPRIGHT = -0.7;

/**
 * Flip en Acro: pasar por boca abajo y volver a quedar nivelado sin bajar de una altura mínima.
 * Mide la altura perdida desde la última vez que estuvo nivelado antes del flip hasta que se
 * endereza: un buen flip corta el gas al empezar y lo vuelve a dar al terminar.
 */
export class FlipGoal implements Goal {
  readonly instruction: string;
  private readonly minAltitude: number;
  private inverted = false;
  private startAltitude = 0;
  private altitudeLoss = 0;

  constructor(minAltitude: number, instruction: string) {
    this.minAltitude = minAltitude;
    this.instruction = instruction;
  }

  update(frame: LessonFrame): GoalUpdate {
    if (frame.altitude < this.minAltitude) {
      return {
        progress: 0,
        done: false,
        failed: `Has bajado de ${this.minAltitude} m. Corta el gas al empezar el flip y vuelve a darlo al terminar.`,
      };
    }
    if (!this.inverted) {
      if (frame.upright > LEVEL_UPRIGHT) this.startAltitude = frame.altitude;
      if (frame.upright < INVERTED_UPRIGHT) this.inverted = true;
      // Hasta boca abajo, la mitad del progreso
      return { progress: 0.5 * clamp01((1 - frame.upright) / (1 - INVERTED_UPRIGHT)), done: false };
    }
    if (frame.upright > LEVEL_UPRIGHT) {
      this.altitudeLoss = Math.max(0, this.startAltitude - frame.altitude);
      return { progress: 1, done: true };
    }
    return {
      progress: 0.5 + 0.5 * clamp01((frame.upright - INVERTED_UPRIGHT) / (LEVEL_UPRIGHT - INVERTED_UPRIGHT)),
      done: false,
      hint: 'Sigue con el stick a fondo hasta que vuelva a estar nivelado, y entonces suéltalo.',
    };
  }

  markers(): MarkerSpec[] {
    return [{ kind: 'altitude', y: this.minAltitude }];
  }

  metrics(): Record<string, number> {
    return { flipAltitudeLoss: this.altitudeLoss };
  }
}
