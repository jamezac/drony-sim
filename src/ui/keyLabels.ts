// Símbolo que lleva impreso cada tecla en el teclado del usuario, para mostrarlo en la interfaz.
//
// El código reconoce las teclas por su POSICIÓN física, con los nombres del teclado de EE. UU.:
// 'Backquote' es la tecla de debajo de Esc. Lo que lleva impreso depende de la distribución:
// º (España), | (Latinoamérica), ` (EE. UU.), ^ (Alemania), ² (Francia)...
// Chrome y Edge lo dicen con la Keyboard API (navigator.keyboard.getLayoutMap). Firefox y Safari
// no la tienen: entonces se describe la tecla por su posición.

/** Texto cuando no se conoce la distribución del teclado */
const FALLBACK_LABELS: Record<string, string> = {
  Backquote: 'tecla bajo Esc',
};

// La Keyboard API aún es experimental y TypeScript no trae sus tipos: declaramos lo que usamos
interface KeyboardLayoutMapLike {
  get(code: string): string | undefined;
}

interface NavigatorWithKeyboard {
  keyboard?: { getLayoutMap(): Promise<KeyboardLayoutMapLike> };
}

/**
 * Etiqueta de una tecla a partir de la distribución del teclado (o null si no se conoce).
 * Las letras van en mayúscula, como están impresas en el teclado.
 */
export function keyLabelFrom(layout: KeyboardLayoutMapLike | null, code: string): string {
  const symbol = layout?.get(code);
  // 'Dead' = tecla muerta (acentos que esperan a la siguiente letra): no es un símbolo que mostrar
  if (symbol && symbol.trim() !== '' && symbol !== 'Dead') {
    return /^\p{L}$/u.test(symbol) ? symbol.toUpperCase() : symbol;
  }
  return FALLBACK_LABELS[code] ?? code.replace(/^(Key|Digit)/, '');
}

/** Etiqueta de una tecla en el teclado del usuario (consulta la distribución al navegador). */
export async function keyLabel(code: string): Promise<string> {
  try {
    const keyboard = (navigator as NavigatorWithKeyboard).keyboard;
    return keyLabelFrom(keyboard ? await keyboard.getLayoutMap() : null, code);
  } catch {
    // Puede fallar, por ejemplo, dentro de un iframe: usamos la descripción por posición
    return keyLabelFrom(null, code);
  }
}
