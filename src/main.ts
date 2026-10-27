// Fase 0: escena mínima para comprobar que Three.js funciona. En la fase 1 se convierte en el simulador.

import * as THREE from 'three';
import './style.css';

// Fotogramas a renderizar antes de avisar a `npm run check` de que la página está lista
const FRAMES_BEFORE_READY = 10;

const canvas = document.querySelector<HTMLCanvasElement>('#scene');
if (!canvas) throw new Error('Falta el <canvas id="scene">');

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x87b5e0);

const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 100);
camera.position.set(3, 2.5, 4);
camera.lookAt(0, 0.5, 0);

scene.add(new THREE.HemisphereLight(0xdfefff, 0x4a5a3a, 1.2));
const sun = new THREE.DirectionalLight(0xffffff, 2);
sun.position.set(5, 8, 3);
scene.add(sun);

const cube = new THREE.Mesh(
  new THREE.BoxGeometry(1, 1, 1),
  new THREE.MeshStandardMaterial({ color: 0xff8a3d }),
);
cube.position.y = 0.8;
scene.add(cube);

const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(20, 20),
  new THREE.MeshStandardMaterial({ color: 0x5f8a4a }),
);
ground.rotation.x = -Math.PI / 2;
scene.add(ground);

function resize(): void {
  const { innerWidth: width, innerHeight: height } = window;
  renderer.setSize(width, height, false);
  camera.aspect = width / height;
  camera.updateProjectionMatrix();
}
window.addEventListener('resize', resize);
resize();

let frames = 0;
renderer.setAnimationLoop((timeMs) => {
  const t = timeMs / 1000;
  cube.rotation.set(t * 0.4, t * 0.7, 0);
  renderer.render(scene, camera);
  if (++frames === FRAMES_BEFORE_READY) window.__dronyReady = true;
});
