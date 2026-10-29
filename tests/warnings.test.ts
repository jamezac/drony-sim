import { describe, expect, it } from 'vitest';
import { activeWarnings, type WarningInput } from '../src/ui/warnings';

const calmFlight: WarningInput = {
  batteryPercent: 80,
  phase: 'flying',
  forcedLanding: false,
  gps: true,
  acro: false,
  inLesson: false,
  altitude: 10,
  distance: 20,
  windSpeed: 2,
};

describe('activeWarnings', () => {
  it('en un vuelo tranquilo no hay avisos', () => {
    expect(activeWarnings(calmFlight)).toEqual([]);
  });

  it('el aterrizaje forzoso va primero, por encima de cualquier otro aviso', () => {
    const warnings = activeWarnings({ ...calmFlight, batteryPercent: 9, forcedLanding: true, gps: false, windSpeed: 10 });
    expect(warnings[0]).toContain('aterrizaje forzoso');
    expect(warnings).toHaveLength(3);
  });

  it('batería baja: en vuelo pide volver; en el suelo, cambiar la batería', () => {
    expect(activeWarnings({ ...calmFlight, batteryPercent: 25 })[0]).toContain('vuelve pronto');
    expect(activeWarnings({ ...calmFlight, batteryPercent: 25, phase: 'armed' })[0]).toContain('Pulsa R');
  });

  it('durante el RTH explica cómo cancelarlo', () => {
    expect(activeWarnings({ ...calmFlight, phase: 'returning' })[0]).toContain('Pulsa H');
  });

  it('avisa de ATTI, del techo de altura, del límite de distancia y del viento fuerte', () => {
    const warnings = activeWarnings({ ...calmFlight, gps: false, altitude: 119.5, distance: 178, windSpeed: 9 });
    expect(warnings.join(' ')).toMatch(/ATTI.*Altura máxima.*Límite de distancia.*Viento fuerte/);
  });

  it('en Acro explica cómo volver a un modo que se nivela solo (y no habla de ATTI)', () => {
    const [warning] = activeWarnings({ ...calmFlight, gps: false, acro: true });
    expect(warning).toContain('Acro');
    expect(warning).toContain('Normal');
    // En una lección no se puede cambiar de modo: no lo sugiere
    expect(activeWarnings({ ...calmFlight, gps: false, acro: true, inLesson: true })[0]).not.toContain('Normal');
  });
});
