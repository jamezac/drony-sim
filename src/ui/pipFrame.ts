// Marco de la imagen en miniatura (PiP) de la FPV. La imagen la dibuja WebGL en ese rectángulo;
// esto solo pone el borde y la etiqueta encima, en el HUD.

function element(tag: string, className: string, text = ''): HTMLElement {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

export class PipFrame {
  private readonly frame = element('div', 'pip-frame');
  private readonly label = element('span', 'pip-label');

  constructor(root: HTMLElement) {
    this.frame.append(this.label);
    this.frame.hidden = true;
    root.append(this.frame);
  }

  /**
   * @param rect rectángulo en px CSS con origen abajo a la izquierda (como WebGL), o null para ocultarlo
   * @param gimbalDegrees inclinación del gimbal, para la etiqueta
   */
  update(rect: { x: number; y: number; width: number; height: number } | null, gimbalDegrees: number): void {
    this.frame.hidden = rect === null;
    if (!rect) return;
    Object.assign(this.frame.style, {
      left: `${rect.x}px`,
      bottom: `${rect.y}px`,
      width: `${rect.width}px`,
      height: `${rect.height}px`,
    });
    this.label.textContent = `FPV · gimbal ${Math.round(gimbalDegrees)}° · P: ocultar`;
  }
}
