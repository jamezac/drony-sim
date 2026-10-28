// Panel de la lección en curso: qué hacer ahora, progreso del paso, consejo y cronómetro.

import type { LessonView } from '../training/lessonRun';
import { formatSeconds } from '../training/scoring';

function element(tag: string, className: string, text = ''): HTMLElement {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

export class LessonPanel {
  private readonly root = element('div', 'lesson-panel');
  private readonly title = element('p', 'lesson-title');
  private readonly step = element('span', 'lesson-step');
  private readonly timer = element('span', 'lesson-timer');
  private readonly instruction = element('p', 'lesson-instruction');
  private readonly fill = element('div', 'lesson-progress-fill');
  private readonly hint = element('p', 'lesson-hint');

  /**
   * @param container raíz del HUD. El panel va abajo en el centro: arriba taparía los objetivos
   * altos (cubos, columnas), que con la cámara de seguimiento caen en la parte alta de la imagen.
   */
  constructor(container: HTMLElement) {
    const header = element('div', 'lesson-header');
    header.append(this.step, this.timer);
    const progress = element('div', 'lesson-progress');
    progress.append(this.fill);
    const footer = element('p', 'lesson-footer', 'R: repetir · Esc: abandonar · L: lecciones');
    this.root.append(this.title, header, this.instruction, progress, this.hint, footer);
    this.root.hidden = true;
    container.append(this.root);
  }

  show(view: LessonView): void {
    this.root.hidden = false;
    this.title.textContent = view.title;
    this.step.textContent = `Paso ${view.stepNumber} de ${view.stepCount}`;
    this.timer.textContent = `⏱ ${formatSeconds(view.elapsed)}`;
    this.instruction.textContent = view.instruction;
    this.fill.style.width = `${Math.round(view.progress * 100)}%`;
    this.hint.hidden = !view.hint;
    this.hint.textContent = view.hint ?? '';
  }

  hide(): void {
    this.root.hidden = true;
  }
}
