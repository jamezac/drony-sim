// Menú de lecciones y pantalla de resultados (ventanas sobre la escena; el vuelo se pausa).

import type { LessonDefinition } from '../training/lessons';
import { LESSONS } from '../training/lessons';
import type { LessonRecords } from '../training/records';
import { formatSeconds, type Rating, type Stars } from '../training/scoring';

function element(tag: string, className: string, text = ''): HTMLElement {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

function button(text: string, secondary = false): HTMLButtonElement {
  const result = document.createElement('button');
  result.textContent = text;
  if (secondary) result.className = 'secondary';
  return result;
}

function starsText(stars: Stars): string {
  return `${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
}

/** Ventana modal genérica: fondo oscuro que bloquea el resto de la página */
class Modal {
  protected readonly backdrop = element('div', 'modal-backdrop');
  protected readonly panel = element('div', 'modal');

  constructor(root: HTMLElement) {
    this.backdrop.append(this.panel);
    this.backdrop.hidden = true;
    root.append(this.backdrop);
  }

  get isOpen(): boolean {
    return !this.backdrop.hidden;
  }

  close(): void {
    this.backdrop.hidden = true;
  }

  protected openWith(...children: HTMLElement[]): void {
    this.panel.replaceChildren(...children);
    this.backdrop.hidden = false;
  }
}

export class LessonMenu extends Modal {
  private readonly onStart: (lesson: LessonDefinition) => void;

  constructor(root: HTMLElement, onStart: (lesson: LessonDefinition) => void) {
    super(root);
    this.onStart = onStart;
  }

  open(records: LessonRecords): void {
    const list = element('ol', 'lesson-list');
    LESSONS.forEach((lesson) => {
      const record = records[lesson.id];
      const item = element('li', 'lesson-card');
      const start = button('Empezar');
      start.addEventListener('click', () => this.onStart(lesson));
      const best = element(
        'p',
        `lesson-card-best${record ? ' lesson-card-done' : ''}`,
        record ? `${starsText(record.stars)} · mejor tiempo ${formatSeconds(record.seconds)}` : 'Sin completar',
      );
      item.append(
        element('h3', 'lesson-card-title', lesson.title),
        element('p', 'lesson-card-summary', lesson.summary),
        element('p', 'lesson-card-skill', lesson.skill),
        best,
        start,
      );
      list.append(item);
    });
    const close = button('Cerrar (Esc)', true);
    close.addEventListener('click', () => this.close());
    this.openWith(
      element('h2', 'modal-title', 'Lecciones'),
      element(
        'p',
        'modal-subtitle',
        'De lo más básico a lo más difícil. Cada lección se puntúa de 1 a 3 estrellas y se guarda tu mejor resultado.',
      ),
      list,
      close,
    );
  }
}

export interface ResultsData {
  lesson: LessonDefinition;
  completed: boolean;
  failure: string | null;
  rating: Rating | null;
  seconds: number;
  newRecord: boolean;
  hasNext: boolean;
}

export interface ResultsActions {
  retry(): void;
  next(): void;
  menu(): void;
  freeFlight(): void;
}

export class ResultsDialog extends Modal {
  private readonly actions: ResultsActions;

  constructor(root: HTMLElement, actions: ResultsActions) {
    super(root);
    this.actions = actions;
  }

  show(data: ResultsData): void {
    const children: HTMLElement[] = [element('h2', 'modal-title', data.lesson.title)];
    if (data.completed && data.rating) {
      children.push(
        element('p', 'results-stars', starsText(data.rating.stars)),
        element('p', 'modal-subtitle', `¡Completada en ${formatSeconds(data.seconds)}!${data.newRecord ? ' · ¡Nuevo récord!' : ''}`),
      );
      const lines = element('ul', 'results-lines');
      data.rating.lines.forEach((line) => lines.append(element('li', '', line)));
      children.push(lines);
    } else {
      children.push(element('p', 'results-failed', `No superada: ${data.failure ?? ''}`));
    }

    const actions = element('div', 'wizard-actions');
    const retry = button('Repetir (R)');
    retry.addEventListener('click', () => this.actions.retry());
    actions.append(retry);
    if (data.completed && data.hasNext) {
      const next = button('Siguiente lección');
      next.addEventListener('click', () => this.actions.next());
      actions.append(next);
    }
    const menu = button('Lecciones', true);
    menu.addEventListener('click', () => this.actions.menu());
    const free = button('Volar libre', true);
    free.addEventListener('click', () => this.actions.freeFlight());
    actions.append(menu, free);
    children.push(actions);
    this.openWith(...children);
  }
}
