// Visualizador de sticks: dos cuadrados con la posición que tendrían los sticks de una radio
// DJI en Modo 2 con lo que estás haciendo ahora (con el SpaceMouse, el teclado o un mando).
//
// Sirve para construir el modelo mental que usarás con la radio real: el dron no sabe de
// "tapas" ni de teclas, solo de estos cuatro ejes.
//   Izquierdo: arriba/abajo = altura (throttle), lados = giro (yaw)
//   Derecho:   arriba/abajo = avance (pitch),    lados = lateral (roll)

import type { Sticks } from '../core/controlInput';

function element(tag: string, className: string, text = ''): HTMLElement {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

function stick(label: string): { root: HTMLElement; dot: HTMLElement } {
  const root = element('div', 'stick');
  const pad = element('div', 'stick-pad');
  const dot = element('div', 'stick-dot');
  pad.append(dot);
  root.append(pad, element('span', 'stick-label', label));
  return { root, dot };
}

/** Coloca el punto: x a la derecha, y hacia arriba, ambos en −1..1. */
function place(dot: HTMLElement, x: number, y: number): void {
  dot.style.left = `${50 + x * 50}%`;
  dot.style.top = `${50 - y * 50}%`;
}

export class StickView {
  private readonly left = stick('Altura · giro');
  private readonly right = stick('Avance · lateral');

  constructor(root: HTMLElement) {
    const panel = element('div', 'sticks');
    const pair = element('div', 'sticks-pair');
    pair.append(this.left.root, this.right.root);
    panel.append(element('p', 'sticks-title', 'Radio DJI · Modo 2'), pair);
    root.append(panel);
  }

  update(sticks: Sticks): void {
    place(this.left.dot, sticks.yaw, sticks.throttle);
    place(this.right.dot, sticks.roll, sticks.pitch);
  }
}
