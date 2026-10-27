// Barras horizontales centradas para mostrar el valor de un eje (−1..1). Las usan la página de
// dispositivos y el panel de calibración.

export interface AxisRow {
  fill: HTMLElement;
  value: HTMLElement;
}

export function createAxisRow(container: HTMLElement, label: string): AxisRow {
  const row = document.createElement('div');
  row.className = 'axis';
  const name = document.createElement('span');
  name.textContent = label;
  const bar = document.createElement('div');
  bar.className = 'axis-bar';
  const fill = document.createElement('div');
  fill.className = 'axis-fill';
  bar.append(fill);
  const value = document.createElement('span');
  value.className = 'axis-value';
  row.append(name, bar, value);
  container.append(row);
  return { fill, value };
}

/** Barra centrada: crece a la derecha si es positivo, a la izquierda si es negativo. */
export function setBar(row: AxisRow, n: number, text: string): void {
  // Recortamos a ±1: hay ejes (hat switch) que reposan en ≈1,286 y se saldrían del medidor
  const clamped = Math.max(-1, Math.min(1, n));
  row.fill.style.left = `${50 + Math.min(clamped, 0) * 50}%`;
  row.fill.style.width = `${Math.abs(clamped) * 50}%`;
  row.value.textContent = text;
}
