# Drony Sim 🚁

Simulador 3D de vuelo de dron cuadricóptero en el navegador, hecho con **TypeScript** y **Three.js**, para aprender a pilotar antes de volar un dron real.

## Características previstas

- Física propia de cuadricóptero con paso de simulación fijo
- Modos de vuelo estilo DJI: Cine, Normal, Sport, ATTI y (más adelante) Manual/Acro
- Control con **SpaceMouse** (WebHID), teclado y, en el futuro, mando o radio RC por USB
- HUD de telemetría: altura, velocidad, batería, distancia al punto de despegue
- Lecciones de entrenamiento: hover, cuadrado, círculo, ocho, nose-in y aterrizaje de precisión

## Cómo ejecutarlo

```bash
npm install
npm run dev     # abre http://localhost:5173 en Chrome o Edge
```

- `http://localhost:5173/devices.html` sirve para probar el SpaceMouse (por Gamepad API y WebHID) y tiene un **asistente de mapeo** que mide ejes, sentidos y acoplamiento.
- `npm run test`: tests de Vitest.
- `npm run lint`: ESLint.
- `npm run check`: abre las páginas en un Chrome invisible, guarda capturas en `.check/` y lista los errores de consola. Necesita WSL con `networkingMode=mirrored` (ver [CLAUDE.md](CLAUDE.md)).

## Estado

🚧 Fase 5 (lecciones) en curso: 10 lecciones guiadas con objetivos en la escena, puntuación de 1 a 3 estrellas y récords; vista del piloto (tecla C). El plan completo está en [docs/PLAN.md](docs/PLAN.md).
