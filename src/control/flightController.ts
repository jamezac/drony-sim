// Controlador de vuelo: de los sticks (o de las fases automáticas) al empuje de cada motor.
//
// Control en cascada, como el de un DJI. Cada lazo da el objetivo al siguiente, más rápido:
//
//   sticks ─▶ velocidad deseada ─▶ [PID velocidad] ─▶ aceleración deseada
//         ─▶ inclinación + empuje total ─▶ [P actitud] ─▶ velocidad angular deseada
//         ─▶ [PID velocidad angular] ─▶ torques ─▶ mezclador ─▶ 4 motores
//
// Modo Normal (GPS): el stick pide una VELOCIDAD, no una inclinación. Al soltarlo, el objetivo
// vuelve a 0 con aceleración limitada (frenado suave) y, ya parado, se fija la posición y la altura.

import { Matrix4, Quaternion, Vector3 } from 'three';
import { controlConfig, droneConfig, flightConfig, simConfig, type FlightModeParams } from '../core/config';
import type { Sticks } from '../core/controlInput';
import { headingOf, MOTOR_COUNT, type DroneState } from '../physics/drone';
import type { FlightPhase } from './flightState';
import { mixMotors } from './mixer';
import { Pid } from './pid';

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

  /** Orientación objetivo del último paso (para el panel de ajuste y los tests) */
  readonly desiredOrientation = new Quaternion();
  readonly motorCommands = new Array<number>(MOTOR_COUNT).fill(0);

  reset(state: DroneState): void {
    for (const pid of [this.pitchRate, this.rollRate, this.yawRate, this.velocityX, this.velocityZ, this.verticalSpeed]) {
      pid.reset();
    }
    this.yawSetpoint = headingOf(state.orientation);
    this.velocitySetpoint.set(0, 0, 0);
    this.holding = false;
    this.altitudeSetpoint = null;
    this.desiredOrientation.copy(state.orientation);
  }

  update(state: DroneState, phase: FlightPhase, sticks: Sticks, mode: FlightModeParams, dt: number): number[] {
    if (phase === 'disarmed' || phase === 'armed') {
      const idle = phase === 'armed' ? droneConfig.idleThrustFraction * droneConfig.maxThrustPerMotor : 0;
      this.motorCommands.fill(idle);
      this.reset(state);
      return this.motorCommands;
    }

    const flying = phase === 'flying';
    // En el despegue y el aterrizaje automáticos los sticks no mueven el dron
    const pilot: Sticks = flying ? sticks : { throttle: 0, yaw: 0, pitch: 0, roll: 0 };

    // 1. Rumbo: el stick de yaw gira el objetivo (positivo = horario = rumbo decreciente)
    const yawRateCommand = -pilot.yaw * mode.maxYawRate;
    this.yawSetpoint = wrapAngle(this.yawSetpoint + yawRateCommand * dt);

    // 2. Objetivos de velocidad horizontal y vertical
    this.updateHorizontalSetpoint(state, pilot, mode, dt);
    const verticalSetpoint = this.verticalSetpoint(state, phase, pilot, mode);

    // 3. Lazos de velocidad → aceleración deseada (m/s²). Posado no se inclina.
    let ax = 0;
    let az = 0;
    if (state.onGround) {
      this.velocityX.reset();
      this.velocityZ.reset();
    } else {
      ax = this.velocityX.update(this.velocitySetpoint.x, state.velocity.x, dt);
      az = this.velocityZ.update(this.velocitySetpoint.z, state.velocity.z, dt);
    }
    const ay = this.verticalSpeed.update(verticalSetpoint, state.velocity.y, dt);

    // 4. Aceleración → orientación deseada + empuje total
    const collective = this.attitudeFromAcceleration(state, ax, ay, az, mode);

    // 5. Actitud → velocidad angular deseada (ejes del cuerpo)
    this.attitudeToRates(state, yawRateCommand);

    // 6. Velocidad angular → torque → motores
    const omega = state.angularVelocity;
    const { inertia } = droneConfig;
    torque.set(
      inertia.x * this.pitchRate.update(rateSetpoint.x, omega.x, dt),
      inertia.y * this.yawRate.update(rateSetpoint.y, omega.y, dt),
      inertia.z * this.rollRate.update(rateSetpoint.z, omega.z, dt),
    );
    return mixMotors(collective, torque, this.motorCommands);
  }

  /** Normal (GPS): stick → velocidad en el marco del rumbo; suelto → frenar y mantener posición. */
  private updateHorizontalSetpoint(state: DroneState, sticks: Sticks, mode: FlightModeParams, dt: number): void {
    const { position: positionGains, holdEngageSpeed } = controlConfig;
    const sticksActive = sticks.pitch !== 0 || sticks.roll !== 0;

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
  private verticalSetpoint(state: DroneState, phase: FlightPhase, sticks: Sticks, mode: FlightModeParams): number {
    const { altitude: altitudeGains } = controlConfig;
    const y = state.position.y;
    const altitude = y - droneConfig.restHeight;

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
      return sticks.throttle * (sticks.throttle > 0 ? mode.maxClimb : mode.maxDescent);
    }
    // Throttle suelto: primero frena la subida/bajada y después fija la altura
    if (this.altitudeSetpoint === null) {
      if (Math.abs(state.velocity.y) > controlConfig.holdEngageSpeed) return 0;
      this.altitudeSetpoint = y;
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
