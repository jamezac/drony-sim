// Calibración de ejes: mide el centro real (con la tapa suelta) y hasta dónde llega cada eje
// hacia cada lado, para que "a fondo" sea siempre ±1 y "suelto" sea siempre 0.
//
// Sin calibrar se usa el mapeo medido en la fase 0 (fullScale por eje). Calibrar corrige
// ejes que no llegan al final (como el giro, ~0,87) o con el centro algo desplazado.

import { calibrationConfig } from '../core/config';
import type { AxisCalibration } from '../core/settings';

/** Valor calibrado (−1..1 aprox.): cada lado se escala por su propio recorrido. */
export function applyCalibration(raw: number, calibration: AxisCalibration): number {
  const offset = raw - calibration.center;
  const span = offset >= 0 ? calibration.positive - calibration.center : calibration.center - calibration.negative;
  return span > calibrationConfig.minUsableSpan ? offset / span : offset;
}

/**
 * Graba la calibración en dos fases: primero muestras en reposo (para el centro) y luego
 * muestras moviendo la tapa a fondo en todas las direcciones (para los extremos).
 */
export class CalibrationRecorder {
  private restSum: number[] = [];
  private restSamples = 0;
  private negative: number[] = [];
  private positive: number[] = [];

  addRestSample(axes: readonly number[]): void {
    axes.forEach((value, i) => (this.restSum[i] = (this.restSum[i] ?? 0) + value));
    this.restSamples++;
  }

  get center(): number[] {
    return this.restSum.map((sum) => (this.restSamples ? sum / this.restSamples : 0));
  }

  addMotionSample(axes: readonly number[]): void {
    axes.forEach((value, i) => {
      this.negative[i] = Math.min(this.negative[i] ?? value, value);
      this.positive[i] = Math.max(this.positive[i] ?? value, value);
    });
  }

  /** Recorrido alcanzado desde el centro hacia cada lado, por eje. */
  spans(): { negative: number; positive: number }[] {
    return this.center.map((center, i) => ({
      negative: Math.max(0, center - (this.negative[i] ?? center)),
      positive: Math.max(0, (this.positive[i] ?? center) - center),
    }));
  }

  /** ¿Todos los ejes han llegado lo bastante lejos hacia los dos lados? */
  isComplete(axisCount: number): boolean {
    const spans = this.spans();
    if (spans.length < axisCount) return false;
    return spans.slice(0, axisCount).every((s) => Math.min(s.negative, s.positive) >= calibrationConfig.minSpan);
  }

  result(axisCount: number): AxisCalibration[] {
    return this.center.slice(0, axisCount).map((center, i) => ({
      center,
      negative: this.negative[i] ?? center,
      positive: this.positive[i] ?? center,
    }));
  }
}
