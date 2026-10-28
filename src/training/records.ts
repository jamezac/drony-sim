// Mejores resultados de cada lección, guardados en el navegador (como los ajustes de entrada).
// Mejor = más estrellas; con las mismas estrellas, menos tiempo.

import { browserStorage } from '../core/settings';
import type { Stars } from './scoring';

export interface LessonRecord {
  stars: Stars;
  seconds: number;
}

export type LessonRecords = Record<string, LessonRecord>;

export const RECORDS_STORAGE_KEY = 'drony.lessonRecords.v1';

export function isBetter(result: LessonRecord, record: LessonRecord | undefined): boolean {
  if (!record) return true;
  if (result.stars !== record.stars) return result.stars > record.stars;
  return result.seconds < record.seconds;
}

/** Valida lo leído del almacenamiento: descarta entradas corruptas sin perder las buenas. */
export function sanitizeRecords(raw: unknown): LessonRecords {
  const records: LessonRecords = {};
  if (typeof raw !== 'object' || raw === null) return records;
  for (const [id, value] of Object.entries(raw)) {
    if (typeof value !== 'object' || value === null) continue;
    const { stars, seconds } = value as Record<string, unknown>;
    if ((stars === 1 || stars === 2 || stars === 3) && typeof seconds === 'number' && Number.isFinite(seconds) && seconds >= 0) {
      records[id] = { stars, seconds };
    }
  }
  return records;
}

export function loadRecords(storage: Storage | null = browserStorage()): LessonRecords {
  try {
    const stored = storage?.getItem(RECORDS_STORAGE_KEY);
    return sanitizeRecords(stored ? JSON.parse(stored) : null);
  } catch {
    return {};
  }
}

/**
 * Guarda el resultado si mejora el récord.
 * @returns si es un récord nuevo
 */
export function saveIfRecord(id: string, result: LessonRecord, storage: Storage | null = browserStorage()): boolean {
  const records = loadRecords(storage);
  if (!isBetter(result, records[id])) return false;
  records[id] = result;
  try {
    storage?.setItem(RECORDS_STORAGE_KEY, JSON.stringify(records));
  } catch {
    // Sin almacenamiento el récord no se guarda, pero el resultado se sigue mostrando
  }
  return true;
}
