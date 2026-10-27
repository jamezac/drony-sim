// Controlador PID genérico.
//
// - P: corrige en proporción al error actual.
// - I: acumula el error en el tiempo; elimina el error que queda fijo (p. ej. con viento constante).
// - D: frena la corrección cuando el valor ya se acerca rápido al objetivo; amortigua oscilaciones.
//
// Dos detalles importantes en drones:
// - Derivada sobre la MEDIDA, no sobre el error: si el objetivo cambia de golpe (mueves el stick),
//   la derivada del error daría un pico enorme ("derivative kick"). La de la medida no.
// - Anti-windup: si la salida está saturada, el integral deja de crecer en esa dirección. Si no,
//   se "carga" durante la saturación y luego provoca un sobrepaso grande.

export interface PidGains {
  kp: number;
  ki: number;
  kd: number;
  maxOutput: number;
}

export class Pid {
  // Se guarda la referencia (no una copia) para que el panel de ajuste cambie las ganancias en vivo
  private readonly gains: PidGains;
  private integral = 0;
  private previousMeasurement: number | null = null;

  constructor(gains: PidGains) {
    this.gains = gains;
  }

  update(setpoint: number, measurement: number, dt: number): number {
    const { kp, ki, kd, maxOutput } = this.gains;
    const error = setpoint - measurement;
    const derivative =
      this.previousMeasurement === null ? 0 : -(measurement - this.previousMeasurement) / dt;
    this.previousMeasurement = measurement;

    const unclamped = kp * error + ki * (this.integral + error * dt) + kd * derivative;
    const saturated = Math.abs(unclamped) > maxOutput;
    // Integramos salvo que la salida esté saturada y el error empuje aún más hacia la saturación
    if (!saturated || Math.sign(error) !== Math.sign(unclamped)) {
      this.integral += error * dt;
    }

    const output = kp * error + ki * this.integral + kd * derivative;
    return Math.max(-maxOutput, Math.min(maxOutput, output));
  }

  reset(): void {
    this.integral = 0;
    this.previousMeasurement = null;
  }
}
