// Un intento de una lección: va pasando los objetivos en orden, cronometra y al final puntúa.

import type { GoalUpdate, Goal, LessonFrame, MarkerSpec } from './goals';
import type { LessonDefinition } from './lessons';
import type { LessonMetrics, Rating } from './scoring';

export type LessonStatus = 'running' | 'completed' | 'failed';

/** Lo que muestra el panel de la lección */
export interface LessonView {
  title: string;
  stepNumber: number;
  stepCount: number;
  instruction: string;
  progress: number;
  hint?: string;
  elapsed: number;
  status: LessonStatus;
  failure: string | null;
}

export class LessonRun {
  readonly lesson: LessonDefinition;
  status: LessonStatus = 'running';
  failure: string | null = null;
  elapsed = 0;
  private readonly goals: Goal[];
  private index = 0;
  private last: GoalUpdate = { progress: 0, done: false };

  constructor(lesson: LessonDefinition) {
    this.lesson = lesson;
    this.goals = lesson.goals();
  }

  update(frame: LessonFrame, dt: number): void {
    if (this.status !== 'running') return;
    this.elapsed += dt;
    const goal = this.goals[this.index];
    this.last = goal.update(frame, dt);
    if (this.last.failed) {
      this.status = 'failed';
      this.failure = this.last.failed;
    } else if (this.last.done) {
      this.index++;
      this.last = { progress: 0, done: false };
      if (this.index >= this.goals.length) this.status = 'completed';
    }
  }

  get view(): LessonView {
    const goal = this.goals[Math.min(this.index, this.goals.length - 1)];
    return {
      title: this.lesson.title,
      stepNumber: Math.min(this.index + 1, this.goals.length),
      stepCount: this.goals.length,
      instruction: goal.instruction,
      progress: this.status === 'completed' ? 1 : this.last.progress,
      hint: this.last.hint,
      elapsed: this.elapsed,
      status: this.status,
      failure: this.failure,
    };
  }

  markers(): MarkerSpec[] {
    const current = this.status === 'running' ? this.goals[this.index].markers() : [];
    return [...(this.lesson.staticMarkers ?? []), ...current];
  }

  metrics(): LessonMetrics {
    return Object.assign({ time: this.elapsed }, ...this.goals.map((goal) => goal.metrics()));
  }

  rating(): Rating {
    return this.lesson.rate(this.metrics());
  }
}
