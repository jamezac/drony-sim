// Aviso de crash en vuelo libre (en una lección, el crash aparece en la pantalla de resultados).

function element(tag: string, className: string, text = ''): HTMLElement {
  const result = document.createElement(tag);
  result.className = className;
  result.textContent = text;
  return result;
}

export class CrashOverlay {
  private readonly root = element('div', 'crash-overlay');
  private readonly reason = element('p', 'crash-reason');

  constructor(container: HTMLElement) {
    this.root.append(
      element('p', 'crash-title', '💥 ¡Te has estrellado!'),
      this.reason,
      element('p', 'crash-hint', 'Las hélices se han roto. Pulsa R para volver a empezar.'),
    );
    this.root.hidden = true;
    container.append(this.root);
  }

  /** @param reason explicación del choque, o null para ocultar el aviso */
  update(reason: string | null): void {
    this.root.hidden = reason === null;
    if (reason !== null && this.reason.textContent !== reason) this.reason.textContent = reason;
  }
}
