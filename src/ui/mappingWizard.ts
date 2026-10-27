// Asistente de mapeo: pide cada gesto del SpaceMouse, detecta qué eje se mueve, su sentido,
// su máximo y el acoplamiento con los demás ejes, y al final genera un JSON para copiar.

import { mappingWizardConfig } from '../core/config';
import { GestureTracker, strongestCoupling, type GestureResult } from '../input/axisDetection';
import { axisDeviation, mostActivePad } from '../input/spaceMouseGamepad';

interface ButtonPress {
  pad: number;
  button: number;
}

interface WizardStep {
  kind: 'axis' | 'button';
  id: string;
  label: string;
  instruction: string;
}

const STEPS: WizardStep[] = [
  { kind: 'axis', id: 'lift', label: 'Subir', instruction: 'Tira de la tapa hacia arriba, a fondo, y suéltala.' },
  { kind: 'axis', id: 'slideRight', label: 'Desplazar a la derecha', instruction: 'Desplaza la tapa a la derecha, a fondo, y suéltala.' },
  { kind: 'axis', id: 'slideForward', label: 'Desplazar adelante', instruction: 'Desplaza la tapa hacia delante (alejándola de ti), a fondo, y suéltala.' },
  { kind: 'axis', id: 'tiltForward', label: 'Inclinar adelante', instruction: 'Inclina la tapa hacia delante (como bajando el morro), a fondo, y suéltala.' },
  { kind: 'axis', id: 'tiltRight', label: 'Inclinar a la derecha', instruction: 'Inclina la tapa a la derecha, a fondo, y suéltala.' },
  { kind: 'axis', id: 'twistClockwise', label: 'Girar en sentido horario', instruction: 'Gira la tapa en sentido horario (visto desde arriba), a fondo, y suéltala.' },
  { kind: 'button', id: 'left', label: 'Botón izquierdo', instruction: 'Pulsa y suelta el botón izquierdo.' },
  { kind: 'button', id: 'right', label: 'Botón derecho', instruction: 'Pulsa y suelta el botón derecho.' },
];

function round(value: number): number {
  return Math.round(value * 100) / 100;
}

function button(text: string, secondary = false): HTMLButtonElement {
  const element = document.createElement('button');
  element.textContent = text;
  if (secondary) element.className = 'secondary';
  return element;
}

export class MappingWizard {
  private stepIndex = -1; // -1 = sin empezar; STEPS.length = terminado
  private readonly tracker = new GestureTracker(mappingWizardConfig);
  private pressedButton: ButtonPress | null = null;
  private readonly gestures = new Map<string, GestureResult>();
  private readonly buttons = new Map<string, ButtonPress>();
  // Gamepad fijado: el primero que se movió de verdad. Los demás pasos usan ese mismo.
  private lockedPad: { index: number; id: string; axisCount: number; rest: number[] } | null = null;
  // Valor en reposo de cada eje, por gamepad, capturado al empezar cada paso (con la tapa suelta)
  private readonly restAxes = new Map<number, number[]>();

  private readonly progress = document.createElement('p');
  private readonly instruction = document.createElement('p');
  private readonly hint = document.createElement('p');
  private readonly startButton = button('Empezar');
  private readonly backButton = button('← Repetir el paso anterior', true);
  private readonly result = document.createElement('pre');
  private readonly copyButton = button('Copiar JSON');

  constructor(container: HTMLElement) {
    this.progress.className = 'status-row';
    this.instruction.className = 'wizard-instruction';
    this.hint.className = 'status-row';
    this.result.className = 'wizard-result';

    const actions = document.createElement('div');
    actions.className = 'wizard-actions';
    actions.append(this.startButton, this.backButton);
    container.append(this.progress, this.instruction, this.hint, actions, this.result, this.copyButton);

    this.startButton.addEventListener('click', () => this.start());
    this.backButton.addEventListener('click', () => this.goTo(Math.max(0, this.stepIndex - 1)));
    this.copyButton.addEventListener('click', () => this.copy());
    this.render();
  }

  /** Llamar una vez por frame. */
  update(nowMs: number): void {
    const step = STEPS[this.stepIndex];
    if (!step) return;

    const pads = navigator.getGamepads().filter((pad) => pad !== null);
    if (pads.length === 0) {
      this.hint.textContent = 'No se detecta el SpaceMouse: mueve la tapa o pulsa un botón.';
      return;
    }

    if (step.kind === 'axis') {
      this.updateAxisStep(step, this.choosePad(pads), nowMs);
    } else {
      this.updateButtonStep(step, pads);
    }
  }

  /** Ejes del gamepad menos su valor en reposo (lo captura la primera vez que lo ve en el paso). */
  private deviation(pad: Gamepad): number[] {
    const axes = Array.from(pad.axes);
    let rest = this.restAxes.get(pad.index);
    if (!rest) {
      rest = axes;
      this.restAxes.set(pad.index, rest);
    }
    return axisDeviation(axes, rest);
  }

  /** El gamepad fijado; si aún no hay, el que más se mueve (y se fija si supera minPeak). */
  private choosePad(pads: Gamepad[]): Gamepad {
    const locked = this.lockedPad && pads.find((pad) => pad.index === this.lockedPad?.index);
    if (locked) return locked;

    const active = mostActivePad(pads.map((pad) => ({ pad, axes: this.deviation(pad) })));
    const pad = active?.pad.pad ?? pads[0];
    if (active && active.magnitude >= mappingWizardConfig.minPeak) {
      const rest = (this.restAxes.get(pad.index) ?? []).map(round);
      this.lockedPad = { index: pad.index, id: pad.id, axisCount: pad.axes.length, rest };
    }
    return pad;
  }

  private updateAxisStep(step: WizardStep, pad: Gamepad, nowMs: number): void {
    // Trabajamos con la desviación respecto al reposo: así un eje fijo (como un hat switch) no cuenta
    const axes = this.deviation(pad);
    const status = this.tracker.push(axes, nowMs);

    // Lectura en vivo del eje más movido (respecto al reposo): ayuda a diagnosticar escalas raras
    let liveAxis = 0;
    axes.forEach((value, i) => {
      if (Math.abs(value) > Math.abs(axes[liveAxis] ?? 0)) liveAxis = i;
    });
    const live = `mando #${pad.index}, eje más movido ahora: ${liveAxis} = ${(axes[liveAxis] ?? 0).toFixed(3)}`;
    this.hint.textContent =
      status === 'waiting' ? `Esperando el gesto… (${live})` : `Bien. Ahora suelta la tapa… (${live})`;

    if (status !== 'done') return;
    const result = this.tracker.result();
    if (result) {
      this.gestures.set(step.id, result);
      this.goTo(this.stepIndex + 1);
    } else {
      this.resetStep();
    }
  }

  private updateButtonStep(step: WizardStep, pads: Gamepad[]): void {
    // Los botones pueden llegar por un "gamepad" distinto al de los ejes: miramos todos
    let pressed: ButtonPress | null = null;
    for (const pad of pads) {
      const button = pad.buttons.findIndex((b) => b.pressed);
      if (button >= 0) {
        pressed = { pad: pad.index, button };
        break;
      }
    }

    if (this.pressedButton === null) {
      this.pressedButton = pressed;
      this.hint.textContent = pressed
        ? `Botón ${pressed.button} (mando #${pressed.pad}) detectado. Suéltalo…`
        : 'Esperando la pulsación…';
      return;
    }
    // Esperamos a que lo suelte para que la misma pulsación no cuente en el paso siguiente
    if (!pressed) {
      this.buttons.set(step.id, this.pressedButton);
      this.goTo(this.stepIndex + 1);
    }
  }

  private start(): void {
    this.gestures.clear();
    this.buttons.clear();
    this.lockedPad = null;
    this.goTo(0);
  }

  private goTo(index: number): void {
    this.stepIndex = index;
    this.resetStep();
    this.render();
  }

  private resetStep(): void {
    this.tracker.reset();
    this.restAxes.clear();
    this.pressedButton = null;
  }

  private render(): void {
    const step = STEPS[this.stepIndex];
    const done = this.stepIndex >= STEPS.length;
    this.startButton.textContent = this.stepIndex < 0 ? 'Empezar' : 'Empezar de nuevo';
    this.backButton.hidden = this.stepIndex <= 0 || done;
    this.result.hidden = !done;
    this.copyButton.hidden = !done;

    if (this.stepIndex < 0) {
      this.progress.textContent = `${STEPS.length} pasos. Ten la página en primer plano y la mano en el SpaceMouse.`;
      this.instruction.textContent = 'Pulsa Empezar.';
      this.hint.textContent = '';
    } else if (step) {
      this.progress.textContent = `Paso ${this.stepIndex + 1} de ${STEPS.length} · ${step.label}`;
      this.instruction.textContent = step.instruction;
      this.hint.textContent = 'Esperando…';
    } else {
      this.progress.textContent = '¡Terminado! Copia el JSON y pégamelo en el chat.';
      this.instruction.textContent = '';
      this.hint.textContent = '';
      this.result.textContent = `${this.summary()}\n\n${this.json()}`;
    }
  }

  private summary(): string {
    const lines = STEPS.map((step) => {
      if (step.kind === 'button') {
        const press = this.buttons.get(step.id);
        return `${step.label}: ${press ? `botón ${press.button} (mando #${press.pad})` : 'sin datos'}`;
      }
      const gesture = this.gestures.get(step.id);
      if (!gesture) return `${step.label}: sin datos`;
      const coupling = strongestCoupling(gesture);
      const couplingText = coupling ? `, acoplamiento máx. ${Math.round(coupling.ratio * 100)} % (eje ${coupling.axis})` : '';
      return `${step.label}: eje ${gesture.axis} (${gesture.sign > 0 ? '+' : '−'}), máx ${round(gesture.max)}${couplingText}`;
    });
    return lines.join('\n');
  }

  private json(): string {
    const gestures = Object.fromEntries(
      [...this.gestures].map(([id, g]) => [
        id,
        { axis: g.axis, sign: g.sign, max: round(g.max), coupling: g.coupling.map(round) },
      ]),
    );
    // Todos los gamepads visibles: sirve para elegir bien el SpaceMouse en el simulador
    const allPads = navigator
      .getGamepads()
      .filter((pad) => pad !== null)
      .map((pad) => ({ index: pad.index, id: pad.id, axes: pad.axes.length, buttons: pad.buttons.length }));
    return JSON.stringify(
      { axesPad: this.lockedPad, allPads, gestures, buttons: Object.fromEntries(this.buttons) },
      null,
      2,
    );
  }

  private copy(): void {
    navigator.clipboard
      .writeText(this.json())
      .then(() => (this.hint.textContent = 'Copiado ✓'))
      .catch(() => (this.hint.textContent = 'No se pudo copiar: selecciona el texto y cópialo a mano.'));
  }
}
