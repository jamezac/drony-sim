// Puntuación de las lecciones: de 1 a 3 estrellas según las métricas del intento.
// Completar una lección siempre da al menos 1 estrella; las otras dos premian la precisión
// y la soltura, que es lo que diferencia "lo he conseguido" de "lo domino".

export type Stars = 1 | 2 | 3;

export interface LessonMetrics {
  /** Duración total del intento (s) */
  time: number;
  [metric: string]: number;
}

export interface Rating {
  stars: Stars;
  /** Explicación de cada métrica, para la pantalla de resultados */
  lines: string[];
}

/** Estrellas para una métrica donde menos es mejor: ≤ three → 3, ≤ two → 2, si no 1. */
export function starsAtMost(value: number, three: number, two: number): Stars {
  if (value <= three) return 3;
  if (value <= two) return 2;
  return 1;
}

/** La nota final es la de la peor métrica: no vale ser rápido pero impreciso. */
export function minStars(...stars: Stars[]): Stars {
  return Math.min(...stars) as Stars;
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const rest = seconds - minutes * 60;
  return minutes > 0 ? `${minutes}:${rest.toFixed(1).padStart(4, '0')}` : `${rest.toFixed(1)} s`;
}

/** Línea de resultado: valor, objetivo de 3 estrellas y estrellas de esa métrica. */
export function metricLine(label: string, value: string, goal: string, stars: Stars): string {
  return `${label}: ${value} (3★ con ${goal}) ${'★'.repeat(stars)}${'☆'.repeat(3 - stars)}`;
}

/** Puntuación por tiempo: lo usan casi todas las lecciones. */
export function rateTime(time: number, three: number, two: number): { stars: Stars; line: string } {
  const stars = starsAtMost(time, three, two);
  return { stars, line: metricLine('Tiempo', formatSeconds(time), `≤ ${formatSeconds(three)}`, stars) };
}

/** Puntuación de una métrica en metros (o m/s) donde menos es mejor. */
export function rateMetric(
  label: string,
  value: number,
  three: number,
  two: number,
  unit: string,
): { stars: Stars; line: string } {
  const stars = starsAtMost(value, three, two);
  return { stars, line: metricLine(label, `${value.toFixed(2)} ${unit}`, `≤ ${three} ${unit}`, stars) };
}
