import { Euler, Quaternion, Vector3 } from 'three';
import { describe, expect, it } from 'vitest';
import { gimbalConfig, renderConfig } from '../src/core/config';
import { fpvOrientation, gimbalStep, nextCamera, parseCameraMode, pipRect } from '../src/render/cameras';

const DEG = Math.PI / 180;

/** Dron inclinado: 20° de cabeceo (morro abajo) y 30° de alabeo, con rumbo 40° */
function tiltedDrone(): Quaternion {
  return new Quaternion().setFromEuler(new Euler(-20 * DEG, 40 * DEG, 30 * DEG, 'YXZ'));
}

describe('fpvOrientation', () => {
  it('estabilizada: el horizonte queda recto aunque el dron esté inclinado', () => {
    const camera = fpvOrientation(tiltedDrone(), 40 * DEG, 0, true, new Quaternion());
    const right = new Vector3(1, 0, 0).applyQuaternion(camera);
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera);
    expect(right.y).toBeCloseTo(0); // sin alabeo en la imagen
    expect(forward.y).toBeCloseTo(0); // mira al frente, no hacia donde cabecea el dron
  });

  it('estabilizada: el gimbal a −90° mira en vertical hacia abajo', () => {
    const camera = fpvOrientation(tiltedDrone(), 40 * DEG, -90 * DEG, true, new Quaternion());
    expect(new Vector3(0, 0, -1).applyQuaternion(camera).y).toBeCloseTo(-1);
  });

  it('fija al cuerpo: el horizonte se inclina con el dron', () => {
    const camera = fpvOrientation(tiltedDrone(), 40 * DEG, 0, false, new Quaternion());
    const right = new Vector3(1, 0, 0).applyQuaternion(camera);
    expect(Math.abs(right.y)).toBeGreaterThan(0.3);
  });

  it('mira hacia el mismo lado que el morro del dron (rumbo 0 = −Z)', () => {
    const camera = fpvOrientation(new Quaternion(), 0, 0, true, new Quaternion());
    const forward = new Vector3(0, 0, -1).applyQuaternion(camera);
    expect(forward.z).toBeCloseTo(-1);
  });
});

describe('gimbalStep', () => {
  it('se mueve a la velocidad del gimbal y se queda en su rango', () => {
    expect(gimbalStep(0, -1, 0.5)).toBeCloseTo(-gimbalConfig.pitchRate * 0.5);
    expect(gimbalStep(0, -1, 100)).toBe(gimbalConfig.minPitch);
    expect(gimbalStep(0, 1, 100)).toBe(gimbalConfig.maxPitch);
    expect(gimbalStep(-0.3, 0, 1)).toBe(-0.3);
  });
});

describe('cámaras', () => {
  it('C recorre detrás → piloto → FPV → detrás', () => {
    expect(nextCamera('chase')).toBe('pilot');
    expect(nextCamera('pilot')).toBe('fpv');
    expect(nextCamera('fpv')).toBe('chase');
  });

  it('parseCameraMode acepta solo cámaras conocidas', () => {
    expect(parseCameraMode('fpv')).toBe('fpv');
    expect(parseCameraMode('dron')).toBeNull();
  });

  it('la miniatura va abajo a la derecha y encoge en pantallas estrechas', () => {
    const { width, height, right, bottom } = renderConfig.pip;
    expect(pipRect(1280, 720)).toEqual({ x: 1280 - right - width, y: bottom, width, height });
    const narrow = pipRect(600, 400);
    expect(narrow.width).toBeLessThan(width);
    expect(narrow.width / narrow.height).toBeCloseTo(width / height, 1);
  });
});
