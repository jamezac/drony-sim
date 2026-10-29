import { describe, expect, it } from 'vitest';
import { neutralSticks, noActions, type ControlActions, type Sticks } from '../src/core/controlInput';
import { simulate, Simulation } from '../src/core/simulation';
import {
  distanceToSegment,
  GatesGoal,
  HoldBoxGoal,
  LandGoal,
  OrbitGoal,
  TakeoffGoal,
  YawTurnGoal,
  type LessonFrame,
} from '../src/training/goals';
import { frameFromSimulation } from '../src/training/lessonFrame';
import { LessonRun } from '../src/training/lessonRun';
import { findLesson, LESSONS, nextLesson } from '../src/training/lessons';
import { isBetter, loadRecords, saveIfRecord, sanitizeRecords } from '../src/training/records';
import { formatSeconds, minStars, starsAtMost } from '../src/training/scoring';

/** Fotograma en vuelo, con lo que no importe a cero */
function frame(partial: Partial<LessonFrame> = {}): LessonFrame {
  return {
    x: 0,
    z: 0,
    altitude: 2,
    heading: 0,
    verticalSpeed: 0,
    phase: 'flying',
    onGround: false,
    sticks: neutralSticks(),
    crash: null,
    ...partial,
  };
}

describe('objetivos', () => {
  it('despegue: hecho al superar la altura mínima en el aire', () => {
    const goal = new TakeoffGoal(1);
    expect(goal.update(frame({ altitude: 0, onGround: true })).done).toBe(false);
    expect(goal.update(frame({ altitude: 0.5 })).progress).toBeCloseTo(0.5);
    expect(goal.update(frame({ altitude: 1.1 })).done).toBe(true);
  });

  it('cubo: el tiempo cuenta seguido y vuelve a 0 al salir', () => {
    const goal = new HoldBoxGoal({ x: 0, y: 2, z: -4 }, 0.5, 2, 'cubo');
    const inside = frame({ z: -4 });
    goal.update(inside, 1.5);
    expect(goal.update(frame({ z: -2 }), 0.1).progress).toBe(0); // salió
    goal.update(inside, 1.5);
    expect(goal.update(inside, 0.6).done).toBe(true);
    expect(goal.metrics().hoverRms).toBeCloseTo(0);
  });

  it('cubo con orientación: solo cuenta con el morro hacia el piloto', () => {
    const goal = new HoldBoxGoal({ x: 0, y: 3, z: -10 }, 1, 1, 'nose-in', 'noseIn');
    const tailIn = goal.update(frame({ z: -10, altitude: 3, heading: 0 }), 2);
    expect(tailIn.done).toBe(false);
    expect(tailIn.hint).toContain('MORRO');
    expect(goal.update(frame({ z: -10, altitude: 3, heading: Math.PI }), 2).done).toBe(true);
  });

  it('giro: acumula el ángulo aunque el rumbo pase de +π a −π, y mide el desplazamiento', () => {
    const goal = new YawTurnGoal('giro', 1);
    let done = false;
    for (let i = 0; i <= 40; i++) {
      done = goal.update(frame({ heading: Math.atan2(Math.sin(-i * 0.16), Math.cos(-i * 0.16)), x: i === 20 ? 0.4 : 0 })).done;
    }
    expect(done).toBe(true);
    expect(goal.metrics().maxDrift).toBeCloseTo(0.4);
  });

  it('puertas: en orden y con la orientación pedida', () => {
    const goal = new GatesGoal([{ x: 0, z: -10 }, { x: 5, z: -10 }], 'puertas', 'tailIn', 1);
    expect(goal.update(frame({ x: 5, z: -10 })).progress).toBe(0); // la segunda no cuenta antes que la primera
    expect(goal.update(frame({ x: 0, z: -10 })).progress).toBe(0.5);
    const wrong = goal.update(frame({ x: 5, z: -10, heading: Math.PI })); // morro hacia el piloto
    expect(wrong.done).toBe(false);
    expect(goal.update(frame({ x: 5, z: -10, heading: 0 })).done).toBe(true);
  });

  it('órbita: solo cuenta el ángulo recorrido dentro de la franja', () => {
    const goal = new OrbitGoal({ x: 0, z: 0 }, 6, 1, 'órbita');
    for (let i = 0; i <= 36; i++) {
      const angle = (i / 36) * Math.PI; // media vuelta pegado al poste: no cuenta
      goal.update(frame({ x: 2 * Math.cos(angle), z: 2 * Math.sin(angle) }));
    }
    let done = false;
    for (let i = 0; i <= 72; i++) {
      const angle = (i / 72) * 2 * Math.PI;
      done = goal.update(frame({ x: 6 * Math.cos(angle), z: 6 * Math.sin(angle) })).done;
    }
    expect(done).toBe(true);
  });

  it('aterrizaje: mide la velocidad al tocar suelo y falla fuera de la H', () => {
    const goal = new LandGoal('aterriza', { x: 0, z: 0, maxDistance: 1 });
    goal.update(frame({ x: 3, altitude: 1 }));
    goal.update(frame({ x: 3, altitude: 0.1, verticalSpeed: -0.7 }));
    const result = goal.update(frame({ x: 3, altitude: 0, onGround: true, phase: 'armed' }));
    expect(result.failed).toContain('3.0 m');
    expect(goal.metrics().touchdownSpeed).toBeCloseTo(0.7);
  });

  it('distanceToSegment', () => {
    expect(distanceToSegment(0, 1, -1, 0, 1, 0)).toBe(1);
    expect(distanceToSegment(3, 0, -1, 0, 1, 0)).toBe(2); // más allá del extremo
  });
});

describe('puntuación y récords', () => {
  it('starsAtMost y minStars', () => {
    expect(starsAtMost(0.1, 0.15, 0.3)).toBe(3);
    expect(starsAtMost(0.2, 0.15, 0.3)).toBe(2);
    expect(starsAtMost(0.5, 0.15, 0.3)).toBe(1);
    expect(minStars(3, 2, 3)).toBe(2);
  });

  it('formatSeconds', () => {
    expect(formatSeconds(12.34)).toBe('12.3 s');
    expect(formatSeconds(75.5)).toBe('1:15.5');
  });

  it('mejor = más estrellas, o las mismas en menos tiempo', () => {
    expect(isBetter({ stars: 2, seconds: 50 }, undefined)).toBe(true);
    expect(isBetter({ stars: 3, seconds: 90 }, { stars: 2, seconds: 20 })).toBe(true);
    expect(isBetter({ stars: 2, seconds: 30 }, { stars: 2, seconds: 20 })).toBe(false);
  });

  it('los récords se guardan solo si mejoran y se validan al leer', () => {
    const data = new Map<string, string>();
    const storage = {
      getItem: (k: string) => data.get(k) ?? null,
      setItem: (k: string, v: string) => void data.set(k, v),
    } as Storage;
    expect(saveIfRecord('hover', { stars: 2, seconds: 40 }, storage)).toBe(true);
    expect(saveIfRecord('hover', { stars: 1, seconds: 10 }, storage)).toBe(false);
    expect(loadRecords(storage)).toEqual({ hover: { stars: 2, seconds: 40 } });
    expect(sanitizeRecords({ a: { stars: 5, seconds: 1 }, b: { stars: 3, seconds: 9 } })).toEqual({ b: { stars: 3, seconds: 9 } });
  });
});

describe('lecciones con la simulación real', () => {
  function input(sticks: Partial<Sticks> = {}, actions: Partial<ControlActions> = {}) {
    return { sticks: { ...neutralSticks(), ...sticks }, actions: { ...noActions(), ...actions } };
  }

  /** Arranca la lección como lo hace el simulador */
  function start(id: string): { sim: Simulation; run: LessonRun } {
    const lesson = findLesson(id);
    if (!lesson) throw new Error(id);
    const sim = new Simulation();
    sim.resetWith({ mode: lesson.setup.mode, wind: lesson.setup.wind, batteryPercent: 100 });
    if (lesson.setup.airborne) sim.spawnFlying(lesson.setup.airborne);
    return { sim, run: new LessonRun(lesson) };
  }

  /** Simula con la lección corriendo, como hace main.ts en cada frame */
  function fly(sim: Simulation, run: LessonRun, seconds: number, sticks: Partial<Sticks> = {}, actions: Partial<ControlActions> = {}) {
    let pending = actions;
    simulate(sim, seconds, () => {
      const i = input(sticks, pending);
      pending = {};
      run.update(frameFromSimulation(sim, i.sticks), 1 / 240);
      return i;
    });
  }

  it('hay 12 lecciones con identificadores únicos, encadenadas', () => {
    expect(LESSONS).toHaveLength(12);
    expect(new Set(LESSONS.map((l) => l.id)).size).toBe(12);
    expect(nextLesson(LESSONS[11])).toBeNull();
  });

  it('puertas con franja de altura: pasar por encima no cuenta', () => {
    const goal = new GatesGoal([{ x: 0, z: -12, minAltitude: 0.3, maxAltitude: 2.7 }], 'puerta');
    const over = goal.update(frame({ z: -12, altitude: 4 }));
    expect(over.done).toBe(false);
    expect(over.hint).toContain('Por encima');
    expect(goal.update(frame({ z: -12, altitude: 1.5 })).done).toBe(true);
  });

  it('estrellarse hace fallar la lección', () => {
    const lesson = findLesson('obstaculos');
    if (!lesson) throw new Error('falta la lección');
    const run = new LessonRun(lesson);
    run.update(frame({ crash: 'Chocaste contra un muro a 8.0 m/s' }), 0.1);
    expect(run.status).toBe('failed');
    expect(run.failure).toContain('muro');
  });

  it('lección 1: despegue automático, hover y aterrizaje automático → completada', () => {
    const { sim, run } = start('despegue');
    fly(sim, run, 0.1, {}, { takeoffLand: true });
    fly(sim, run, 6);
    fly(sim, run, 0.1, {}, { takeoffLand: true });
    fly(sim, run, 8);
    expect(run.status).toBe('completed');
    const rating = run.rating();
    expect(rating.stars).toBeGreaterThanOrEqual(2); // el aterrizaje automático es suave
    expect(rating.lines).toHaveLength(2);
  });

  it('lección 4: un giro completo con el stick de yaw sin desplazarse → 3 estrellas', () => {
    const { sim, run } = start('giro');
    fly(sim, run, 0.1, {}, { takeoffLand: true });
    fly(sim, run, 5);
    fly(sim, run, 7, { yaw: 1 });
    expect(run.status).toBe('completed');
    expect(run.metrics().maxDrift).toBeLessThan(0.3);
    expect(run.rating().stars).toBe(3);
  });

  it('lección 9: aterrizar donde empieza (lejos de la H) → no superada', () => {
    const { sim, run } = start('aterrizaje');
    expect(sim.phase).toBe('flying');
    expect(sim.altitude).toBeCloseTo(4);
    fly(sim, run, 0.1, {}, { takeoffLand: true });
    fly(sim, run, 12);
    expect(run.status).toBe('failed');
    expect(run.failure).toContain('de la H');
  });

  it('lección 10: empieza en ATTI con viento y el dron deriva si no se corrige', () => {
    const { sim, run } = start('atti-viento');
    expect(sim.mode).toBe('atti');
    fly(sim, run, 4);
    expect(run.view.progress).toBeLessThan(1);
    expect(Math.abs(sim.state.position.x)).toBeGreaterThan(1);
  });
});
