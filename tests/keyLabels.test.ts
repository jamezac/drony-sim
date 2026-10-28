import { describe, expect, it } from 'vitest';
import { keyLabelFrom } from '../src/ui/keyLabels';

/** Distribución de teclado de prueba: código físico → símbolo impreso */
function layout(entries: Record<string, string>) {
  return { get: (code: string) => entries[code] };
}

describe('keyLabelFrom', () => {
  it('la tecla bajo Esc muestra el símbolo de cada distribución', () => {
    expect(keyLabelFrom(layout({ Backquote: 'º' }), 'Backquote')).toBe('º'); // España
    expect(keyLabelFrom(layout({ Backquote: '|' }), 'Backquote')).toBe('|'); // Latinoamérica
    expect(keyLabelFrom(layout({ Backquote: '`' }), 'Backquote')).toBe('`'); // EE. UU.
    expect(keyLabelFrom(layout({ Backquote: '²' }), 'Backquote')).toBe('²'); // Francia
  });

  it('sin Keyboard API (Firefox, Safari) describe la tecla por su posición', () => {
    expect(keyLabelFrom(null, 'Backquote')).toBe('tecla bajo Esc');
  });

  it('si es una tecla muerta o no hay dato, usa la descripción', () => {
    expect(keyLabelFrom(layout({ Backquote: 'Dead' }), 'Backquote')).toBe('tecla bajo Esc');
    expect(keyLabelFrom(layout({}), 'Backquote')).toBe('tecla bajo Esc');
  });

  it('las letras van en mayúscula, como en el teclado (en AZERTY, KeyQ es la A)', () => {
    expect(keyLabelFrom(layout({ KeyQ: 'a' }), 'KeyQ')).toBe('A');
    expect(keyLabelFrom(null, 'KeyQ')).toBe('Q');
  });
});
