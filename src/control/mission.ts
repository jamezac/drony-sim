// Misión de waypoints, como la del DJI Fly: se marcan puntos en el mapa (posición y altura) y el
// dron los recorre solo, en línea recta de uno a otro y con el morro hacia donde va.
//
// Cómo sigue cada tramo (seguimiento de trayectoria, como el piloto automático de un avión):
// - A lo largo de la línea, la velocidad de la misión. Antes de cada punto frena lo justo para
//   tomar la curva: cuanto más cerrado el giro, más despacio; en el último, hasta pararse.
// - Hacia la línea, una velocidad proporcional al desvío ("cross-track error"). Si el viento o una
//   curva lo sacan de la línea, vuelve a ella en vez de cortar en diagonal hacia el punto.
// - La altura cambia poco a poco a lo largo del tramo, de la del punto anterior a la del siguiente.
//
// No esquiva obstáculos (las misiones de un DJI Mini tampoco): la altura de los puntos tiene que librarlos.

import { controlConfig, droneConfig, missionConfig, type FlightModeParams } from '../core/config';
import type { DroneState } from '../physics/drone';
import type { AutoTargets } from './autoTargets';

/** Qué hace el dron al llegar al último punto */
export type MissionFinish = 'hover' | 'home' | 'land';

export const MISSION_FINISH_LABELS: Record<MissionFinish, string> = {
  hover: 'Quedarse en el último punto',
  home: 'Volver a casa (RTH)',
  land: 'Aterrizar en el último punto',
};

export interface MissionWaypoint {
  x: number;
  z: number;
  /** Altura sobre el suelo (m) */
  altitude: number;
}

export interface MissionPlan {
  waypoints: MissionWaypoint[];
  /** Velocidad de crucero (m/s) */
  speed: number;
  finish: MissionFinish;
}

export function createMissionPlan(): MissionPlan {
  return { waypoints: [], speed: missionConfig.defaultSpeed, finish: 'hover' };
}

/** Longitud horizontal del recorrido (m), contando desde `from` (el dron) hasta el primer punto si se da. */
export function missionLength(waypoints: readonly MissionWaypoint[], from?: { x: number; z: number }): number {
  const route = from ? [from, ...waypoints] : waypoints;
  let length = 0;
  for (let i = 1; i < route.length; i++) length += Math.hypot(route[i].x - route[i - 1].x, route[i].z - route[i - 1].z);
  return length;
}

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Tramos más cortos que esto (en horizontal) son verticales: no tienen dirección */
const MIN_LEG_LENGTH = 0.1; // m

/** Velocidad de crucero de un tramo: la de la misión, la del modo y la que permite su subida o bajada. */
function legCruise(from: MissionWaypoint, to: MissionWaypoint, speed: number, mode: FlightModeParams): number {
  const length = Math.hypot(to.x - from.x, to.z - from.z);
  const climb = to.altitude - from.altitude;
  const maxVertical = (climb > 0 ? mode.maxClimb : mode.maxDescent) * missionConfig.climbMargin;
  const climbLimit = Math.abs(climb) > 1e-3 ? (maxVertical * length) / Math.abs(climb) : Infinity;
  return Math.min(speed, mode.maxSpeed, climbLimit);
}

export class Mission {
  /** Plan que se vuela (una copia: editar el mapa no cambia una misión en curso) */
  plan: MissionPlan = createMissionPlan();
  /** Punto al que se dirige */
  index = 0;
  /** Ha llegado al último punto: la máquina de estados decide qué hacer (MissionPlan.finish) */
  finished = false;
  /** Inicio del tramo actual: el punto anterior, o donde estaba el dron al empezar */
  private readonly legStart: MissionWaypoint = { x: 0, z: 0, altitude: 0 };
  readonly targets: AutoTargets = { velocityX: 0, velocityZ: 0, accelX: 0, accelZ: 0, altitude: null, heading: null };

  setPlan(plan: MissionPlan): void {
    this.plan = { ...plan, waypoints: plan.waypoints.map((w) => ({ ...w })) };
  }

  /** Empieza desde donde está el dron hacia el primer punto. */
  start(state: DroneState): void {
    this.index = 0;
    this.finished = false;
    Object.assign(this.legStart, {
      x: state.position.x,
      z: state.position.z,
      altitude: state.position.y - droneConfig.restHeight,
    });
  }

  update(state: DroneState, mode: FlightModeParams): AutoTargets {
    const { waypoints } = this.plan;
    const { x, z } = state.position;
    const altitude = state.position.y - droneConfig.restHeight;
    let target = waypoints[this.index];
    let leg = this.leg(x, z, target);
    let cornerSpeed = this.cornerSpeed(leg, mode);

    // Punto intermedio pasado (y a su altura): el tramo siguiente empieza en él. El giro empieza
    // un poco antes de llegar, más cuanto más rápido va: si no, la inercia lo saca por fuera.
    const { passDistance, turnLead, altitudeTolerance } = missionConfig;
    if (
      this.index < waypoints.length - 1 &&
      leg.length - leg.along < passDistance + cornerSpeed * turnLead &&
      Math.abs(target.altitude - altitude) < altitudeTolerance
    ) {
      Object.assign(this.legStart, target);
      this.index++;
      target = waypoints[this.index];
      leg = this.leg(x, z, target);
      cornerSpeed = this.cornerSpeed(leg, mode);
    }

    const last = this.index === waypoints.length - 1;
    const targets = this.targets;
    const { kp } = controlConfig.position;
    targets.accelX = 0;
    targets.accelZ = 0;

    if (leg.length < MIN_LEG_LENGTH) {
      // Tramo vertical: se queda encima del punto (como el P de posición) y sube o baja
      const limit = Math.min(this.plan.speed, mode.maxSpeed);
      targets.velocityX = clamp((target.x - x) * kp, limit);
      targets.velocityZ = clamp((target.z - z) * kp, limit);
      targets.altitude = droneConfig.restHeight + target.altitude;
      targets.heading = null;
    } else {
      const cruise = legCruise(this.legStart, target, this.plan.speed, mode);
      const remaining = leg.length - leg.along;
      // Frena para llegar a la velocidad de paso justo donde empieza el giro
      const toTurn = last ? remaining : remaining - (passDistance + cornerSpeed * turnLead);
      let alongSpeed =
        remaining > 0
          ? Math.min(cruise, Math.sqrt(cornerSpeed * cornerSpeed + 2 * missionConfig.brakeAccel * Math.max(toTurn, 0)))
          : remaining * kp; // pasado de largo: vuelve
      // Al final, el mismo acercamiento suave que el P de posición
      if (last) alongSpeed = Math.min(alongSpeed, remaining * kp);
      const crossSpeed = clamp(-leg.cross * missionConfig.crossTrackKp, cruise);
      // Derecha de la dirección de avance (ux, uz): (−uz, ux)
      targets.velocityX = leg.ux * alongSpeed - leg.uz * crossSpeed;
      targets.velocityZ = leg.uz * alongSpeed + leg.ux * crossSpeed;
      const progress = Math.max(0, Math.min(1, leg.along / leg.length));
      targets.altitude =
        droneConfig.restHeight + this.legStart.altitude + (target.altitude - this.legStart.altitude) * progress;
      // Morro hacia donde va el tramo (adelante es (−sin h, −cos h))
      targets.heading = Math.atan2(-leg.ux, -leg.uz);
    }

    if (last) {
      const { arriveRadius, arriveSpeed, arriveAltitude } = missionConfig;
      const distance = Math.hypot(target.x - x, target.z - z);
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      this.finished =
        distance < arriveRadius && speed < arriveSpeed && Math.abs(target.altitude - altitude) < arriveAltitude;
    }
    return targets;
  }

  /**
   * Velocidad al pasar por el punto al que va: una fracción de la de crucero que depende del giro
   * θ hacia el tramo siguiente, ((1 + cos θ)/2)². Recto: sin frenar; 90°: a la cuarta parte;
   * media vuelta, tramo vertical o último punto: parado.
   */
  private cornerSpeed(leg: { ux: number; uz: number; length: number }, mode: FlightModeParams): number {
    const target = this.plan.waypoints[this.index];
    const next = this.plan.waypoints[this.index + 1];
    if (!next || leg.length < MIN_LEG_LENGTH) return 0;
    const nextLength = Math.hypot(next.x - target.x, next.z - target.z);
    if (nextLength < MIN_LEG_LENGTH) return 0;
    const cosTurn = ((next.x - target.x) * leg.ux + (next.z - target.z) * leg.uz) / nextLength;
    const factor = ((1 + cosTurn) / 2) ** 2;
    const speed = this.plan.speed;
    return Math.min(legCruise(this.legStart, target, speed, mode), legCruise(target, next, speed, mode)) * factor;
  }

  /** Geometría del tramo actual: dirección, longitud y dónde está el dron respecto a él. */
  private leg(x: number, z: number, target: MissionWaypoint) {
    const legX = target.x - this.legStart.x;
    const legZ = target.z - this.legStart.z;
    const length = Math.hypot(legX, legZ);
    const ux = length > 0 ? legX / length : 0;
    const uz = length > 0 ? legZ / length : 0;
    const px = x - this.legStart.x;
    const pz = z - this.legStart.z;
    return {
      ux,
      uz,
      length,
      /** Recorrido a lo largo del tramo (m) */
      along: px * ux + pz * uz,
      /** Desvío a la derecha de la línea (m) */
      cross: -px * uz + pz * ux,
    };
  }
}
