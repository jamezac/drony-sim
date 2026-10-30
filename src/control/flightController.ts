// Controlador de vuelo: de los sticks (o de las fases automáticas) al empuje de cada motor.
//
// Control en cascada, como el de un DJI. Cada lazo da el objetivo al siguiente, más rápido:
//
//   sticks ─▶ velocidad deseada ─▶ [PID velocidad] ─▶ aceleración deseada
//         ─▶ inclinación + empuje total ─▶ [P actitud] ─▶ velocidad angular deseada
//         ─▶ [PID velocidad angular] ─▶ torques ─▶ mezclador ─▶ 4 motores
//
// Con GPS (Cine/Normal/Sport): el stick pide una VELOCIDAD, no una inclinación. Al soltarlo, el
// objetivo vuelve a 0 con aceleración limitada (frenado suave) y, ya parado, se fija la posición.
// Sin GPS (ATTI): no hay lazo de velocidad. El stick pide directamente una INCLINACIÓN; al soltarlo
// el dron se nivela, pero nada lo frena salvo el aire: sigue deslizándose.
// La altura se mantiene en todos esos modos (en un DJI la da el barómetro, no el GPS).
// Acro: solo queda el lazo interior. El stick pide velocidad de giro y el throttle, empuje
// (ver control/acro.ts). Las fases automáticas (despegue, aterrizaje) sí se nivelan.

import { Matrix4, Quaternion, Vector3 } from 'three';
import {
  acroConfig,
  controlConfig,
  droneConfig,
  flightConfig,
  limitsConfig,
  simConfig,
  type FlightModeParams,
} from '../core/config';
import type { Sticks } from '../core/controlInput';
import { headingOf, MOTOR_COUNT, tiltOf, type DroneState } from '../physics/drone';
import { acroRate, acroThrust } from './acro';
import type { FlightPhase } from './flightState';
import { Mission, type MissionFinish } from './mission';
import { mixMotors } from './mixer';
import { Pid } from './pid';
import type { AutoTargets } from './autoTargets';
import { Orbit } from './orbit';
import { ReturnToHome, type RthStage } from './rth';

function clamp(value: number, limit: number): number {
  return Math.max(-limit, Math.min(limit, value));
}

/** Ángulo en (−π, π] */
function wrapAngle(angle: number): number {
  return Math.atan2(Math.sin(angle), Math.cos(angle));
}

// Temporales reutilizados
const specificForce = new Vector3();
const bodyUp = new Vector3();
const desiredForward = new Vector3();
const bodyRight = new Vector3();
const bodyBack = new Vector3();
const basis = new Matrix4();
const attitudeError = new Quaternion();
const rateSetpoint = new Vector3();
const torque = new Vector3();
const currentUp = new Vector3();
const attiAccel = new Vector3();

/** Objetivos del último paso, para la gráfica en vivo (null = ese lazo no está activo) */
export interface ControlTelemetry {
  /** Altura objetivo sobre el suelo (m) */
  altitudeSetpoint: number | null;
  /** Velocidad horizontal objetivo (m/s); null en ATTI, que no tiene lazo de velocidad */
  horizontalSpeedSetpoint: number | null;
  /** Inclinación objetivo (rad) */
  desiredTilt: number;
}

export class FlightController {
  // En ejes del cuerpo: girar sobre x es pitch (morro arriba/abajo) y sobre z es roll
  private readonly pitchRate = new Pid(controlConfig.rate);
  private readonly rollRate = new Pid(controlConfig.rate);
  private readonly yawRate = new Pid(controlConfig.yawRate);
  private readonly velocityX = new Pid(controlConfig.velocity);
  private readonly velocityZ = new Pid(controlConfig.velocity);
  private readonly verticalSpeed = new Pid(controlConfig.verticalSpeed);

  private yawSetpoint = 0;
  /** Velocidad horizontal objetivo (solo x, z), con la aceleración limitada */
  private readonly velocitySetpoint = new Vector3();
  private readonly holdPosition = new Vector3();
  private holding = false;
  private altitudeSetpoint: number | null = null;
  private readonly rth = new ReturnToHome();
  /** Órbita en curso (o la última): centro, radio y velocidad, para el HUD y la escena */
  readonly orbit = new Orbit();
  /** Misión de waypoints: el plan que se vuela y el punto al que va */
  readonly mission = new Mission();
  private lastPhase: FlightPhase = 'disarmed';

  /** Orientación objetivo del último paso (para el panel de ajuste y los tests) */
  readonly desiredOrientation = new Quaternion();
  readonly motorCommands = new Array<number>(MOTOR_COUNT).fill(0);
  readonly telemetry: ControlTelemetry = { altitudeSetpoint: null, horizontalSpeedSetpoint: null, desiredTilt: 0 };

  /** Etapa del RTH en curso (solo tiene sentido en la fase 'returning') */
  get rthStage(): RthStage {
    return this.rth.stage;
  }

  /** El RTH ha llegado sobre el punto de despegue: toca aterrizar */
  get rthArrived(): boolean {
    return this.lastPhase === 'returning' && this.rth.stage === 'arrived';
  }

  /** La misión ha llegado al último punto: qué toca hacer ahora (null si no) */
  get missionEnd(): MissionFinish | null {
    return this.lastPhase === 'mission' && this.mission.finished ? this.mission.plan.finish : null;
  }

  reset(state: DroneState): void {
    for (const pid of [this.pitchRate, this.rollRate, this.yawRate, this.velocityX, this.velocityZ, this.verticalSpeed]) {
      pid.reset();
    }
    this.yawSetpoint = headingOf(state.orientation);
    this.velocitySetpoint.set(0, 0, 0);
    this.holding = false;
    this.altitudeSetpoint = null;
    this.desiredOrientation.copy(state.orientation);
    Object.assign(this.telemetry, { altitudeSetpoint: null, horizontalSpeedSetpoint: null, desiredTilt: 0 });
  }

  update(state: DroneState, phase: FlightPhase, sticks: Sticks, mode: FlightModeParams, dt: number): number[] {
    const entering = phase !== this.lastPhase;
    this.lastPhase = phase;
    if (phase === 'disarmed' || phase === 'armed' || phase === 'crashed') {
      const idle = phase === 'armed' ? droneConfig.idleThrustFraction * droneConfig.maxThrustPerMotor : 0;
      this.motorCommands.fill(idle);
      this.reset(state);
      return this.motorCommands;
    }

    const flying = phase === 'flying';
    // En las fases automáticas (despegue, RTH, misión, aterrizaje) los sticks no mueven el dron. En la
    // órbita, avance y lateral la ajustan (los lee la órbita) y el throttle sube y baja como siempre.
    const pilot: Sticks = flying
      ? sticks
      : { throttle: phase === 'orbiting' ? sticks.throttle : 0, yaw: 0, pitch: 0, roll: 0 };
    if (flying && !mode.selfLevel) return this.acro(state, pilot, dt);
    if (entering && phase === 'returning') this.rth.start(state);
    if (entering && phase === 'orbiting') this.orbit.start(state);
    if (entering && phase === 'mission') this.mission.start(state);
    const auto: AutoTargets | null =
      phase === 'returning'
        ? this.rth.update(state)
        : phase === 'orbiting'
          ? this.orbit.update(state, sticks, mode.maxSpeed, dt)
          : phase === 'mission'
            ? this.mission.update(state, mode)
            : null;

    // 1. Rumbo: el stick de yaw gira el objetivo (positivo = horario = rumbo decreciente).
    //    En el RTH, la órbita y la misión, el objetivo gira hacia donde toca a la velocidad de giro del modo.
    let yawRateCommand = -pilot.yaw * mode.maxYawRate;
    if (auto?.heading != null) {
      const step = clamp(wrapAngle(auto.heading - this.yawSetpoint), mode.maxYawRate * dt);
      this.yawSetpoint = wrapAngle(this.yawSetpoint + step);
      // Prealimentación, igual que con el stick: si el objetivo gira (en la órbita, sin parar), se
      // pide ese giro directamente. Si no, el lazo de actitud (solo P) iría siempre unos grados por detrás.
      yawRateCommand = step / dt;
    } else {
      this.yawSetpoint = wrapAngle(this.yawSetpoint + yawRateCommand * dt);
    }

    // 2. Vertical: objetivo de velocidad → aceleración deseada (m/s²)
    const verticalSetpoint = this.verticalSetpoint(state, phase, pilot, mode, auto);
    const ay = this.verticalSpeed.update(verticalSetpoint, state.velocity.y, dt);

    // 3. Horizontal → aceleración deseada (m/s²). Posado no se inclina.
    let ax = 0;
    let az = 0;
    if (mode.positionHold) {
      this.updateHorizontalSetpoint(state, pilot, mode, dt, auto);
      if (state.onGround) {
        this.velocityX.reset();
        this.velocityZ.reset();
      } else {
        ax = this.velocityX.update(this.velocitySetpoint.x, state.velocity.x, dt) + (auto?.accelX ?? 0);
        az = this.velocityZ.update(this.velocitySetpoint.z, state.velocity.z, dt) + (auto?.accelZ ?? 0);
      }
    } else {
      if (!state.onGround) {
        this.attiAcceleration(state, pilot, mode);
        ax = attiAccel.x;
        az = attiAccel.z;
      }
      // Sin GPS no hay punto que mantener. El objetivo de velocidad sigue a la velocidad real
      // para que, si se vuelve a un modo con GPS, el dron frene desde ahí sin dar un tirón.
      this.holding = false;
      this.velocitySetpoint.set(state.velocity.x, 0, state.velocity.z);
      this.velocityX.reset();
      this.velocityZ.reset();
    }

    // 4. Aceleración → orientación deseada + empuje total
    const collective = this.attitudeFromAcceleration(state, ax, ay, az, mode);

    // 5. Actitud → velocidad angular deseada (ejes del cuerpo)
    this.attitudeToRates(state, yawRateCommand);

    this.telemetry.altitudeSetpoint = this.altitudeSetpoint === null ? null : this.altitudeSetpoint - droneConfig.restHeight;
    this.telemetry.horizontalSpeedSetpoint = mode.positionHold ? Math.hypot(this.velocitySetpoint.x, this.velocitySetpoint.z) : null;
    this.telemetry.desiredTilt = tiltOf(this.desiredOrientation);

    // 6. Velocidad angular → torque → motores
    return this.rateLoop(state, collective, dt);
  }

  /** Lazo interior: velocidad angular deseada (rateSetpoint) → torques → empuje de cada motor. */
  private rateLoop(state: DroneState, collective: number, dt: number): number[] {
    const omega = state.angularVelocity;
    const { inertia } = droneConfig;
    torque.set(
      inertia.x * this.pitchRate.update(rateSetpoint.x, omega.x, dt),
      inertia.y * this.yawRate.update(rateSetpoint.y, omega.y, dt),
      inertia.z * this.rollRate.update(rateSetpoint.z, omega.z, dt),
    );
    return mixMotors(collective, torque, this.motorCommands);
  }

  /**
   * Acro: los sticks dan la velocidad de giro y el empuje total, sin más lazos por encima.
   * Los objetivos de los demás lazos siguen al dron, para que al volver a un modo con
   * auto-nivelado partan de cómo está ahora: se nivela, frena y fija la altura sin dar tirones.
   */
  private acro(state: DroneState, sticks: Sticks, dt: number): number[] {
    const { rollPitch, yaw } = acroConfig;
    // Ejes del cuerpo (x derecha, y arriba, z atrás): girar en +x levanta el morro y en +z levanta
    // el lado derecho, así que "adelante" y "derecha" son giros negativos. El yaw horario, también.
    rateSetpoint.set(
      -acroRate(sticks.pitch, rollPitch),
      -acroRate(sticks.yaw, yaw),
      -acroRate(sticks.roll, rollPitch),
    );

    this.yawSetpoint = headingOf(state.orientation);
    this.velocitySetpoint.set(state.velocity.x, 0, state.velocity.z);
    this.holding = false;
    this.altitudeSetpoint = null;
    this.velocityX.reset();
    this.velocityZ.reset();
    this.verticalSpeed.reset();
    this.desiredOrientation.copy(state.orientation);
    Object.assign(this.telemetry, { altitudeSetpoint: null, horizontalSpeedSetpoint: null, desiredTilt: tiltOf(state.orientation) });

    return this.rateLoop(state, acroThrust(sticks.throttle), dt);
  }

  /**
   * ATTI: el stick da directamente la inclinación (a fondo = inclinación máxima del modo).
   * Inclinarse un ángulo θ acelera g·tan(θ) hacia ese lado, en el marco del rumbo del dron.
   */
  private attiAcceleration(state: DroneState, sticks: Sticks, mode: FlightModeParams): void {
    const g = simConfig.gravity;
    const forward = g * Math.tan(sticks.pitch * mode.maxTilt);
    const right = g * Math.tan(sticks.roll * mode.maxTilt);
    const heading = headingOf(state.orientation);
    const forwardX = -Math.sin(heading);
    const forwardZ = -Math.cos(heading);
    attiAccel.set(forward * forwardX + right * -forwardZ, 0, forward * forwardZ + right * forwardX);
  }

  /** Normal (GPS): stick → velocidad en el marco del rumbo; suelto → frenar y mantener posición. */
  private updateHorizontalSetpoint(
    state: DroneState,
    sticks: Sticks,
    mode: FlightModeParams,
    dt: number,
    auto: AutoTargets | null,
  ): void {
    const { position: positionGains, holdEngageSpeed } = controlConfig;
    const sticksActive = sticks.pitch !== 0 || sticks.roll !== 0;

    if (auto) {
      this.holding = false;
      this.slewVelocitySetpoint(auto.velocityX, auto.velocityZ, mode.maxAccel * dt);
      return;
    }

    if (sticksActive) {
      this.holding = false;
      // Adelante = hacia donde mira el morro; derecha = 90° a su derecha
      const heading = headingOf(state.orientation);
      const forwardX = -Math.sin(heading);
      const forwardZ = -Math.cos(heading);
      let targetX = (sticks.pitch * forwardX + sticks.roll * -forwardZ) * mode.maxSpeed;
      let targetZ = (sticks.pitch * forwardZ + sticks.roll * forwardX) * mode.maxSpeed;
      const length = Math.hypot(targetX, targetZ);
      if (length > mode.maxSpeed) {
        targetX *= mode.maxSpeed / length;
        targetZ *= mode.maxSpeed / length;
      }
      // Límite de distancia (como el de DJI): la velocidad hacia fuera se limita para poder
      // frenar a tiempo, v = √(2·a·d) con la distancia que queda (a la mitad de la aceleración
      // máxima, porque el lazo de velocidad tarda un poco en responder). Pasado el borde, vuelve.
      const distance = Math.hypot(state.position.x, state.position.z);
      if (distance > 1e-6) {
        const outwardX = state.position.x / distance;
        const outwardZ = state.position.z / distance;
        const outward = targetX * outwardX + targetZ * outwardZ;
        const remaining = limitsConfig.maxDistance - distance;
        const maxOutward = remaining >= 0 ? Math.sqrt(mode.maxAccel * remaining) : remaining * positionGains.kp;
        if (outward > maxOutward) {
          targetX -= outwardX * (outward - maxOutward);
          targetZ -= outwardZ * (outward - maxOutward);
        }
      }
      this.slewVelocitySetpoint(targetX, targetZ, mode.maxAccel * dt);
      return;
    }

    if (!this.holding) {
      // Frenando: el objetivo baja a 0 con aceleración limitada; ya casi parado, se fija el punto
      this.slewVelocitySetpoint(0, 0, mode.maxAccel * dt);
      const speed = Math.hypot(state.velocity.x, state.velocity.z);
      const setpointStopped = this.velocitySetpoint.lengthSq() === 0;
      if (setpointStopped && (speed < holdEngageSpeed || state.onGround)) {
        this.holding = true;
        this.holdPosition.copy(state.position);
      }
      return;
    }

    // Manteniendo el punto: un P de posición da la velocidad objetivo
    const vx = (this.holdPosition.x - state.position.x) * positionGains.kp;
    const vz = (this.holdPosition.z - state.position.z) * positionGains.kp;
    const length = Math.hypot(vx, vz);
    const scale = length > positionGains.maxSpeed ? positionGains.maxSpeed / length : 1;
    this.velocitySetpoint.set(vx * scale, 0, vz * scale);
  }

  /** Acerca el objetivo de velocidad al pedido sin superar la aceleración máxima. */
  private slewVelocitySetpoint(targetX: number, targetZ: number, maxStep: number): void {
    const dx = targetX - this.velocitySetpoint.x;
    const dz = targetZ - this.velocitySetpoint.z;
    const distance = Math.hypot(dx, dz);
    if (distance <= maxStep) {
      this.velocitySetpoint.set(targetX, 0, targetZ);
    } else {
      this.velocitySetpoint.x += (dx / distance) * maxStep;
      this.velocitySetpoint.z += (dz / distance) * maxStep;
    }
  }

  /** Velocidad vertical objetivo según la fase y el throttle. */
  private verticalSetpoint(
    state: DroneState,
    phase: FlightPhase,
    sticks: Sticks,
    mode: FlightModeParams,
    auto: AutoTargets | null,
  ): number {
    const { altitude: altitudeGains } = controlConfig;
    const y = state.position.y;
    const altitude = y - droneConfig.restHeight;
    // Techo de altura (120 m): el dron no sube más aunque se pida
    const ceiling = droneConfig.restHeight + limitsConfig.maxAltitude;

    if (auto?.altitude != null) {
      this.altitudeSetpoint = Math.min(auto.altitude, ceiling);
      const speed = (this.altitudeSetpoint - y) * altitudeGains.kp;
      return Math.max(-mode.maxDescent, Math.min(mode.maxClimb, speed));
    }

    if (phase === 'takingOff') {
      this.altitudeSetpoint = droneConfig.restHeight + flightConfig.takeoffAltitude;
      return Math.min(flightConfig.takeoffSpeed, (this.altitudeSetpoint - y) * altitudeGains.kp);
    }
    if (phase === 'landing') {
      this.altitudeSetpoint = null;
      return -(altitude > flightConfig.landingSlowAltitude ? flightConfig.landingSpeed : flightConfig.landingSlowSpeed);
    }

    if (sticks.throttle !== 0) {
      this.altitudeSetpoint = null;
      if (sticks.throttle < 0) return sticks.throttle * mode.maxDescent;
      // Subiendo: frena al acercarse al techo, igual que el P de altura
      return Math.min(sticks.throttle * mode.maxClimb, (ceiling - y) * altitudeGains.kp);
    }
    // Throttle suelto: primero frena la subida/bajada y después fija la altura
    if (this.altitudeSetpoint === null) {
      if (Math.abs(state.velocity.y) > controlConfig.holdEngageSpeed) return 0;
      this.altitudeSetpoint = Math.min(y, ceiling);
    }
    return clamp((this.altitudeSetpoint - y) * altitudeGains.kp, altitudeGains.maxSpeed);
  }

  /**
   * Convierte la aceleración deseada en orientación y empuje. El empuje solo puede ir en el
   * "arriba" del dron, así que para acelerar hacia un lado hay que inclinarse hacia ese lado:
   * el "arriba" deseado es la dirección de la fuerza total (aceleración + gravedad).
   */
  private attitudeFromAcceleration(state: DroneState, ax: number, ay: number, az: number, mode: FlightModeParams): number {
    const g = simConfig.gravity;
    // Nunca pedir menos del 20 % de g hacia arriba: el dron no debe intentar ponerse boca abajo
    const vertical = Math.max(g + ay, 0.2 * g);
    const maxHorizontal = vertical * Math.tan(mode.maxTilt);
    const horizontal = Math.hypot(ax, az);
    const scale = horizontal > maxHorizontal ? maxHorizontal / horizontal : 1;
    specificForce.set(ax * scale, vertical, az * scale);

    bodyUp.copy(specificForce).normalize();
    desiredForward.set(-Math.sin(this.yawSetpoint), 0, -Math.cos(this.yawSetpoint));
    bodyRight.crossVectors(desiredForward, bodyUp).normalize();
    bodyBack.crossVectors(bodyRight, bodyUp);
    basis.makeBasis(bodyRight, bodyUp, bodyBack);
    this.desiredOrientation.setFromRotationMatrix(basis);

    // Empuje: la parte de la fuerza deseada que cae sobre el "arriba" ACTUAL del dron
    currentUp.set(0, 1, 0).applyQuaternion(state.orientation);
    return Math.max(0, droneConfig.mass * specificForce.dot(currentUp));
  }

  /** Error de orientación (cuaternión, en ejes del cuerpo) → velocidad angular deseada. */
  private attitudeToRates(state: DroneState, yawRateFeedForward: number): void {
    const { attitude } = controlConfig;
    attitudeError.copy(state.orientation).invert().multiply(this.desiredOrientation);
    // q y −q son la misma rotación: elegimos la que gira por el camino corto
    const sign = attitudeError.w < 0 ? -1 : 1;
    rateSetpoint.set(
      clamp(2 * attitude.kp * sign * attitudeError.x, attitude.maxTiltRate),
      clamp(2 * attitude.yawKp * sign * attitudeError.y + yawRateFeedForward, attitude.maxYawRate),
      clamp(2 * attitude.kp * sign * attitudeError.z, attitude.maxTiltRate),
    );
  }
}
