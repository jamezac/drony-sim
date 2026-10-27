// Manga de viento junto al helipuerto. Leer el viento antes de despegar es una habilidad real:
// la manga apunta hacia donde va el aire y cuanto más horizontal está, más fuerte sopla.
// Con viento, en GPS el dron se inclinará contra él para no moverse; en ATTI te arrastrará.

import * as THREE from 'three';
import { renderConfig } from '../core/config';

const POLE_HEIGHT = 2; // m
const SOCK_LENGTH = 1.2; // m
const SOCK_RADIUS = 0.22; // m
const MAX_DROOP = 80 * (Math.PI / 180); // sin viento cuelga casi vertical
const RESPONSE = 2; // 1/s: la tela no reacciona al instante a cada ráfaga

function stripedTexture(): THREE.CanvasTexture {
  const canvas = document.createElement('canvas');
  canvas.width = 8;
  canvas.height = 64;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el canvas 2D');
  const stripes = 5;
  for (let i = 0; i < stripes; i++) {
    ctx.fillStyle = i % 2 === 0 ? '#ff5a1f' : '#f4f4f4';
    ctx.fillRect(0, (i * canvas.height) / stripes, canvas.width, canvas.height / stripes);
  }
  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

export class Windsock {
  readonly group = new THREE.Group();
  private readonly sock = new THREE.Group();
  private readonly smoothed = new THREE.Vector3();

  constructor() {
    const { x, z } = renderConfig.windsockPosition;
    this.group.position.set(x, 0, z);

    const pole = new THREE.Mesh(
      new THREE.CylinderGeometry(0.03, 0.03, POLE_HEIGHT, 8),
      new THREE.MeshStandardMaterial({ color: 0xb8bec4 }),
    );
    pole.position.y = POLE_HEIGHT / 2;
    pole.castShadow = true;

    // Cono abierto tumbado a lo largo de +X, con la boca ancha en el mástil
    const geometry = new THREE.ConeGeometry(SOCK_RADIUS, SOCK_LENGTH, 16, 1, true);
    geometry.rotateZ(-Math.PI / 2);
    geometry.translate(SOCK_LENGTH / 2, 0, 0);
    const sock = new THREE.Mesh(
      geometry,
      new THREE.MeshStandardMaterial({ map: stripedTexture(), side: THREE.DoubleSide }),
    );
    sock.castShadow = true;
    this.sock.position.y = POLE_HEIGHT;
    this.sock.add(sock);
    this.group.add(pole, this.sock);
  }

  /** @param wind velocidad del aire (m/s, mundo) */
  update(wind: THREE.Vector3, dt: number): void {
    this.smoothed.lerp(wind, 1 - Math.exp(-RESPONSE * dt));
    const speed = Math.hypot(this.smoothed.x, this.smoothed.z);
    const lift = Math.min(1, speed / renderConfig.windsockFullSpeed);
    // Primero se dobla hacia abajo (sobre su Z local) y luego se orienta con el viento (Y)
    const direction = Math.atan2(-this.smoothed.z, this.smoothed.x);
    this.sock.rotation.set(0, direction, -(1 - lift) * MAX_DROOP, 'YZX');
  }
}
