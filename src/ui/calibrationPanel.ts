// Panel de calibración del SpaceMouse (devices.html). Dos pasos:
//   1. Tapa suelta ~1 s → centro real de cada eje.
//   2. Tapa a fondo en todas las direcciones → hasta dónde llega cada eje hacia cada lado.
// Se guarda en el navegador y el simulador lo usa al momento (aunque esté abierto en otra pestaña).

import { calibrationConfig } from '../core/config';
import { loadInputSettings, saveInputSettings, type AxisCalibration } from '../core/settings';
import { applyCalibration, CalibrationRecorder } from '../input/calibration';
import { findSpaceMouseGamepad } from '../input/spaceMouseGamepad';
import { createAxisRow, setBar, type AxisRow } from './axisBars';

type Stage = 'idle' | 'rest' | 'motion';

function button(text: string, secondary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = text;
  if (secondary) element.className = 'secondary';
  return element;
}

export class CalibrationPanel {
  private stage: Stage = 'idle';
  private recorder = new CalibrationRecorder();
  private restStartMs = 0;
  private rows: AxisRow[] = [];
  /** Calibración guardada (se relee al cambiar de paso, no en cada frame) */
  private calibration: AxisCalibration[] | null = null;

  private readonly status = document.createElement('p');
  private readonly instruction = document.createElement('p');
  private readonly rowsContainer = document.createElement('div');
  private readonly startButton = button('Calibrar');
  private readonly saveButton = button('Guardar');
  private readonly cancelButton = button('Cancelar', true);
  private readonly clearButton = button('Borrar calibración', true);

  constructor(container: HTMLElement) {
    this.status.className = 'status-row';
    this.instruction.className = 'wizard-instruction';
    const actions = document.createElement('div');
    actions.className = 'wizard-actions';
    actions.append(this.startButton, this.saveButton, this.cancelButton, this.clearButton);
    container.append(this.status, this.instruction, this.rowsContainer, actions);

    this.startButton.addEventListener('click', () => this.start());
    this.saveButton.addEventListener('click', () => this.save());
    this.cancelButton.addEventListener('click', () => this.setStage('idle'));
    this.clearButton.addEventListener('click', () => this.clear());
    this.setStage('idle');
  }

  /** Llamar una vez por frame. */
  update(nowMs: number): void {
    const pad = findSpaceMouseGamepad();
    if (!pad) {
      this.startButton.disabled = true;
      if (this.stage === 'idle') this.instruction.textContent = 'Mueve la tapa para que Chrome detecte el SpaceMouse.';
      return;
    }
    this.startButton.disabled = this.stage !== 'idle';
    const axes = Array.from(pad.axes);
    this.ensureRows(axes.length);

    if (this.stage === 'rest') {
      this.recorder.addRestSample(axes);
      if (nowMs - this.restStartMs >= calibrationConfig.restSeconds * 1000) this.setStage('motion');
    } else if (this.stage === 'motion') {
      this.recorder.addMotionSample(axes);
      this.showMotion(axes);
      this.saveButton.disabled = !this.recorder.isComplete(axes.length);
    } else {
      this.showLive(axes);
    }
  }

  private ensureRows(count: number): void {
    if (this.rows.length === count) return;
    this.rowsContainer.replaceChildren();
    this.rows = Array.from({ length: count }, (_, i) => createAxisRow(this.rowsContainer, `Eje ${i}`));
  }

  /** En reposo: valor de cada eje tal y como lo verá el simulador (calibrado si lo está). */
  private showLive(axes: number[]): void {
    axes.forEach((raw, i) => {
      const row = this.rows[i];
      const axisCalibration = this.calibration?.[i];
      const value = axisCalibration ? applyCalibration(raw, axisCalibration) : raw;
      if (row) setBar(row, value, `${value.toFixed(2)}${axisCalibration ? ' · calibrado' : ''}`);
    });
  }

  /** Calibrando: recorrido alcanzado hacia cada lado; ✓ cuando ambos llegan al mínimo. */
  private showMotion(axes: number[]): void {
    const center = this.recorder.center;
    const spans = this.recorder.spans();
    axes.forEach((raw, i) => {
      const row = this.rows[i];
      const span = spans[i];
      if (!row || !span) return;
      const done = Math.min(span.negative, span.positive) >= calibrationConfig.minSpan;
      setBar(row, raw - (center[i] ?? 0), `−${span.negative.toFixed(2)} / +${span.positive.toFixed(2)} ${done ? '✓' : '…'}`);
    });
  }

  private start(): void {
    this.recorder = new CalibrationRecorder();
    // Mismo origen de tiempo que el nowMs de requestAnimationFrame
    this.restStartMs = performance.now();
    this.setStage('rest');
  }

  private save(): void {
    const settings = loadInputSettings();
    settings.calibration = this.recorder.result(this.rows.length);
    const saved = saveInputSettings(settings);
    this.setStage('idle', saved ? undefined : 'No se pudo guardar: el navegador bloquea el almacenamiento.');
  }

  private clear(): void {
    const settings = loadInputSettings();
    settings.calibration = null;
    saveInputSettings(settings);
    this.setStage('idle');
  }

  private setStage(stage: Stage, error?: string): void {
    this.stage = stage;
    this.calibration = loadInputSettings().calibration;
    const calibrated = this.calibration !== null;
    this.saveButton.hidden = stage !== 'motion';
    this.saveButton.disabled = true;
    this.cancelButton.hidden = stage === 'idle';
    this.clearButton.hidden = stage !== 'idle' || !calibrated;

    if (error) {
      this.status.textContent = `✗ ${error}`;
      this.status.className = 'status-row bad';
    } else {
      this.status.textContent = calibrated
        ? '✓ SpaceMouse calibrado: el simulador ya usa esta calibración.'
        : 'Sin calibrar: se usa el mapeo medido en la fase 0. Es opcional, pero hace que «a fondo» sea ±1 en todos los ejes.';
      this.status.className = `status-row ${calibrated ? 'ok' : ''}`;
    }

    this.instruction.textContent = {
      idle: 'Pulsa Calibrar para empezar.',
      rest: 'Suelta la tapa y no la toques… (midiendo el centro)',
      motion:
        'Mueve la tapa A FONDO en todas las direcciones: subir y hundir, desplazar a los cuatro lados, ' +
        'inclinar a los cuatro lados y girar en los dos sentidos. Cuando todos los ejes tengan ✓, pulsa Guardar.',
    }[stage];
  }
}
