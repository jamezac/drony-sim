// Escena: cielo, luces, suelo con cuadrícula, helipuerto y conos de referencia.
//
// Pensado para PILOTAR, no para lucir:
// - La cuadrícula de 1 m (líneas fuertes cada 10 m) deja ver la velocidad y la deriva.
// - La sombra del dron justo debajo es la mejor pista de altura al aterrizar, como en la realidad.
// - Los conos cada 10 m dan profundidad: sin ellos es muy difícil juzgar distancias en 3D.

import * as THREE from 'three';
import { renderConfig } from '../core/config';

const SKY_COLOR = 0x9ec9ef;
const GRASS_COLOR = '#6f9a52';
const TILE_METERS = 10; // la textura de la cuadrícula cubre 10 × 10 m

export interface World {
  renderer: THREE.WebGLRenderer;
  scene: THREE.Scene;
  /** Mueve el sol (y su sombra) para que siga al dron */
  followWithSun(target: THREE.Vector3): void;
}

function gridTexture(renderer: THREE.WebGLRenderer): THREE.CanvasTexture {
  const size = 512;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el canvas 2D');

  ctx.fillStyle = GRASS_COLOR;
  ctx.fillRect(0, 0, size, size);
  // Líneas finas cada metro
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.18)';
  ctx.lineWidth = 2;
  const cell = size / TILE_METERS;
  for (let i = 1; i < TILE_METERS; i++) {
    ctx.beginPath();
    ctx.moveTo(i * cell, 0);
    ctx.lineTo(i * cell, size);
    ctx.moveTo(0, i * cell);
    ctx.lineTo(size, i * cell);
    ctx.stroke();
  }
  // Línea fuerte en el borde: al repetirse, marca cada 10 m
  ctx.strokeStyle = 'rgba(255, 255, 255, 0.45)';
  ctx.lineWidth = 5;
  ctx.strokeRect(0, 0, size, size);

  const texture = new THREE.CanvasTexture(canvas);
  texture.wrapS = texture.wrapT = THREE.RepeatWrapping;
  texture.repeat.set(renderConfig.groundSize / TILE_METERS, renderConfig.groundSize / TILE_METERS);
  texture.anisotropy = renderer.capabilities.getMaxAnisotropy();
  texture.colorSpace = THREE.SRGBColorSpace;
  return texture;
}

function helipad(): THREE.Mesh {
  const size = 256;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = size;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('No se pudo crear el canvas 2D');
  ctx.fillStyle = '#3b4148';
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = '#f4f4f4';
  ctx.lineWidth = 10;
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, size / 2 - 16, 0, Math.PI * 2);
  ctx.stroke();
  ctx.fillStyle = '#f4f4f4';
  ctx.font = 'bold 140px system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText('H', size / 2, size / 2 + 8);

  const texture = new THREE.CanvasTexture(canvas);
  texture.colorSpace = THREE.SRGBColorSpace;
  const mesh = new THREE.Mesh(
    new THREE.CircleGeometry(1, 48),
    // polygonOffset: evita el parpadeo ("z-fighting") con el suelo, que está casi en el mismo plano
    new THREE.MeshStandardMaterial({ map: texture, transparent: true, polygonOffset: true, polygonOffsetFactor: -1 }),
  );
  mesh.rotation.x = -Math.PI / 2;
  mesh.position.y = 0.002;
  mesh.receiveShadow = true;
  return mesh;
}

function referenceCones(): THREE.InstancedMesh {
  const { coneSpacing, coneRange } = renderConfig;
  const positions: [number, number][] = [];
  for (let x = -coneRange; x <= coneRange; x += coneSpacing) {
    for (let z = -coneRange; z <= coneRange; z += coneSpacing) {
      if (x !== 0 || z !== 0) positions.push([x, z]);
    }
  }
  // Un solo InstancedMesh para todos los conos: una única llamada de dibujo en la GPU
  const cones = new THREE.InstancedMesh(
    new THREE.ConeGeometry(0.15, 0.4, 12),
    new THREE.MeshStandardMaterial({ color: 0xff7a1a }),
    positions.length,
  );
  const matrix = new THREE.Matrix4();
  positions.forEach(([x, z], i) => cones.setMatrixAt(i, matrix.makeTranslation(x, 0.2, z)));
  return cones;
}

export function createWorld(canvas: HTMLCanvasElement): World {
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFShadowMap;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;

  const scene = new THREE.Scene();
  scene.background = new THREE.Color(SKY_COLOR);
  scene.fog = new THREE.Fog(SKY_COLOR, 60, 250);

  scene.add(new THREE.HemisphereLight(0xdfefff, 0x56703f, 1.4));

  // Sol con sombra. La cámara de sombra es pequeña y sigue al dron: sombra nítida sin gastar
  // una textura enorme para todo el mapa.
  const sun = new THREE.DirectionalLight(0xffffff, 2.2);
  const range = renderConfig.shadowRange;
  sun.castShadow = true;
  sun.shadow.mapSize.set(2048, 2048);
  Object.assign(sun.shadow.camera, { left: -range, right: range, top: range, bottom: -range, near: 0.5, far: 60 });
  sun.shadow.bias = -0.0005;
  sun.shadow.normalBias = 0.02;
  sun.shadow.radius = 3; // bordes de sombra algo suaves
  // El dron está en su propia capa (la FPV no lo ve), pero tiene que seguir dando sombra
  sun.shadow.camera.layers.enable(renderConfig.droneLayer);
  scene.add(sun, sun.target);
  const { x, y, z } = renderConfig.sunOffset;
  const sunOffset = new THREE.Vector3(x, y, z);

  const ground = new THREE.Mesh(
    new THREE.PlaneGeometry(renderConfig.groundSize, renderConfig.groundSize),
    new THREE.MeshStandardMaterial({ map: gridTexture(renderer), roughness: 1 }),
  );
  ground.rotation.x = -Math.PI / 2;
  ground.receiveShadow = true;
  scene.add(ground, helipad(), referenceCones());

  return {
    renderer,
    scene,
    followWithSun(target) {
      sun.position.copy(target).add(sunOffset);
      sun.target.position.copy(target);
    },
  };
}
