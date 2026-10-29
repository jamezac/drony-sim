# CLAUDE.md

Este archivo da contexto a Claude Code sobre el proyecto. Léelo antes de hacer cambios.

## Descripción del proyecto

**Simulador 3D de vuelo de dron** (cuadricóptero) hecho a medida, con fines de **aprendizaje personal**.

El objetivo es aprender a pilotar un dron *antes de comprar uno real* (tipo DJI Mini / Air). Existen simuladores gratuitos (DJI Flight Simulator, Liftoff, Uncrashed, VelociDrone), pero este proyecto busca construir uno propio para:

1. Practicar las habilidades básicas de pilotaje: despegue, hover estable, aterrizaje, giros, orientación invertida ("nose-in"), circuitos y órbitas.
2. Entender cómo funciona un dron por dentro: física de empuje, controladores PID, modos de vuelo y estabilización.
3. Aprender desarrollo de gráficos 3D y simulación en tiempo real.

Prioridad: **que la sensación de vuelo se parezca a un dron de consumo real** (estilo DJI) por encima del realismo gráfico.

## Stack tecnológico

- **Lenguaje:** TypeScript (modo `strict`)
- **Render 3D:** [Three.js](https://threejs.org/)
- **Build / dev server:** Vite
- **Física:** modelo propio simplificado de cuadricóptero (sin motor de física externo al inicio). Si se necesitan colisiones complejas, evaluar `cannon-es` o `rapier3d`.
- **Entrada:** el control principal es un **SpaceMouse Wireless** (3Dconnexion, receptor universal `256f:c652`) leído con la **Gamepad API**. Windows lo expone como un "gamepad" de 6 ejes y funciona con el driver 3DxWare abierto. Con **WebHID** no llega ningún dato mientras 3DxWare está en marcha, así que solo queda como alternativa (`input/spaceMouse.ts`). El teclado es el respaldo. Ojo: el receptor aparece como **varios** gamepads. El SpaceMouse es el que tiene 6 ejes (`pickSpaceMousePad`). El mapeo y los perfiles están en `spaceMouseGamepadConfig` (`core/config.ts`). Los ajustes que elige el usuario (perfil, zona muerta, expo, calibración y modo del mando) se guardan en `localStorage` (`core/settings.ts`, siempre validados al leer). La calibración se hace en `devices.html`. La misma Gamepad API sirve para mandos y radios RC por USB en el futuro.
- **Tests:** Vitest (especialmente para física y controladores).
- **Entorno:** desarrollo en WSL2 (Linux); el simulador se abre en el navegador de Windows en `http://localhost:5173`.

## Comandos

```bash
npm install        # instalar dependencias
npm run dev        # servidor de desarrollo (Vite)
npm run build      # build de producción
npm run test       # tests con Vitest
npm run lint       # ESLint
npm run check      # Chrome de Windows invisible: capturas en .check/ + errores de consola
```

- Páginas: `http://localhost:5173/` (simulador) y `/devices.html` (prueba y calibración de dispositivos).
- `npm run check` usa `playwright-core` (no descarga navegadores) y se conecta por CDP al Chrome de Windows. Requiere WSL con `networkingMode=mirrored`. Hay que ejecutarlo tras cada mejora grande, revisar las capturas y corregir, con un **máximo de 3 rondas**. Para añadir páginas, edita el array `PAGES` en `scripts/check.ts`. Las páginas avisan de que están listas con `window.__dronyReady = true`. El check simula una escala de pantalla del 150 %, como Windows, porque con escala 1 no se ven los fallos de tamaño del canvas.
- El plan completo por fases está en [docs/PLAN.md](docs/PLAN.md).

## Estructura prevista

Resumen; la versión completa está en `docs/PLAN.md`.

```
src/
  main.ts              # punto de entrada, bucle principal
  core/
    loop.ts            # game loop con paso de física fijo (p. ej. 120–240 Hz)
    config.ts          # parámetros ajustables (masa, empuje, sensibilidad...)
  physics/
    drone.ts           # estado del dron: posición, velocidad, orientación (cuaternión), velocidad angular
    dynamics.ts        # fuerzas: empuje de motores, gravedad, arrastre, viento
    environment.ts     # viento, efecto suelo, límites del mundo
  control/
    pid.ts             # controlador PID genérico
    flightController.ts# mezcla de motores y estabilización según modo de vuelo
    modes.ts           # modos: Cine, Normal, Sport, ATTI, Manual/Acro
  input/
    inputManager.ts    # unifica teclado y gamepad en sticks virtuales (-1..1)
    mapping.ts         # Modo 2 (por defecto) / Modo 1, curvas expo, zonas muertas
  render/
    scene.ts           # escena, luces, cielo, terreno
    droneModel.ts      # modelo 3D del dron y hélices animadas
    cameras.ts         # cámaras: tercera persona, FPV, vista desde el piloto (línea de visión)
  ui/
    hud.ts             # telemetría: altura, velocidad, batería, modo, distancia al home
    menus.ts
  training/
    lessons.ts         # lecciones guiadas y retos
    scoring.ts
tests/
```

## Modelo de vuelo (decisiones clave)

- **Paso de física fijo** desacoplado del render (acumulador de tiempo). Nunca integrar física con el `deltaTime` variable del frame.
- Orientación con **cuaterniones**, no ángulos de Euler (evita gimbal lock).
- Sistema de coordenadas de Three.js: **Y hacia arriba**. Documentar cualquier conversión.
- Unidades del SI: metros, segundos, kilogramos, newtons, radianes internamente (grados solo en la UI).
- Parámetros iniciales inspirados en un dron tipo DJI Mini (~250 g, velocidad máx. ~16 m/s en Sport).

### Modos de vuelo

| Modo | Comportamiento | Para qué sirve |
|------|----------------|----------------|
| **Cine** | Muy suave y lento | Primeros vuelos, tomas de video |
| **Normal (GPS)** | Auto-nivelado + mantiene posición y altura al soltar los sticks | Modo por defecto, como un DJI |
| **Sport** | Auto-nivelado, más inclinación y velocidad | Practicar control a alta velocidad |
| **ATTI** | Auto-nivelado y mantiene altura, pero **deriva con el viento** (sin GPS) | Clave para aprender control real ante fallos de GPS |
| **Manual / Acro** | Sin auto-nivelado; los sticks controlan velocidad angular | Avanzado / FPV (fase posterior) |

### Controles (Modo 2, estándar en DJI)

- **Stick izquierdo:** vertical = acelerador/altura (throttle), horizontal = giro sobre su eje (yaw).
- **Stick derecho:** vertical = adelante/atrás (pitch), horizontal = izquierda/derecha (roll).
- Teclado de respaldo: `W/S` altura, `A/D` yaw, flechas pitch/roll, `Espacio` despegue/aterrizaje automático, `E` motores, `1`-`4` modo (Cine/Normal/Sport/ATTI), `G` gráfica de los PID, tecla bajo `Esc` ajustes (el HUD muestra su símbolo según el teclado del usuario: `|` en Latinoamérica, `º` en España, `` ` `` en EE. UU.; ver `ui/keyLabels.ts`), `H` volver a casa (RTH), `V` nivel de viento, `C` cámara (detrás del dron → vista del piloto → FPV), `Q`/`Z` gimbal arriba/abajo, `P` miniatura de la FPV, `N` escenario (campo libre → parque → ciudad → pista de obstáculos), `L` lecciones, `Esc` abandonar lección, `R` reiniciar (también cambia la batería; en una lección, la repite).
- SpaceMouse: botón izquierdo = despegue/aterrizaje, botón derecho = siguiente modo.
- URL: `?mode=cine|normal|sport|atti`, `?wind=calma|moderado|fuerte`, `?battery=25` (batería inicial en %), `?graph=1`, `?lesson=<id>` (empezar una lección, ids en `training/lessons.ts`), `?menu=lecciones`, `?camera=chase|pilot|fpv`, `?scenario=libre|parque|ciudad|obstaculos`, `?demo=hover|sticks|rth|crash` (vuelos automáticos para `npm run check`).
- Lecciones (`training/`): cada una es datos (cómo empieza, objetivos de `goals.ts`, umbrales de estrellas). En una lección el modo, el viento y el RTH los fija la lección. Los récords se guardan en `localStorage`.
- Cámaras (`render/cameras.ts`): el dron está en su propia capa de render (`renderConfig.droneLayer`). La ven las cámaras exteriores y la sombra, pero no la FPV, que está dentro del dron. La miniatura se dibuja en la misma imagen con scissor, y la sombra se calcula una vez por frame.
- Escenarios (`scenarios/scenarios.ts`): solo datos, con semilla. De ellos salen las formas de colisión (`scenarioColliders`) y los modelos 3D (`render/scenarioView.ts`). Colisiones propias en `physics/collisions.ts`: el dron es una esfera contra cajas, cilindros verticales y esferas. Un impacto fuerte (umbrales en `collisionConfig`) pone la fase `crashed`: motores parados hasta reiniciar. En una lección, estrellarse = no superada.
- El viento usa un generador aleatorio con semilla (`core/random.ts`): las ráfagas se repiten igual en cada vuelo y en los tests.

## Hoja de ruta

0. **Esqueleto:** Vite + herramientas, página de prueba del SpaceMouse y `npm run check`.
1. **MVP:** escena con suelo y cielo, dron como caja/modelo simple, física básica, modo Normal, **SpaceMouse** + teclado, cámara en tercera persona.
2. Entrada completa: calibración, expo, zona muerta, anti-acoplamiento del SpaceMouse, perfiles, visualizador de sticks y gamepad / radio RC.
3. HUD de telemetría y modos Cine / Sport / ATTI.
4. Viento y ráfagas, efecto suelo, batería que se agota.
5. Lecciones de entrenamiento: hover en un punto, cuadrado, círculo, ocho, nose-in, aterrizaje de precisión.
6. Cámaras: FPV y vista desde la posición del piloto (línea de visión, como en la vida real).
7. Escenarios: parque, ciudad, obstáculos; colisiones y "crash".
8. Modo Manual/Acro y funciones inteligentes (RTH, órbita, waypoints).

## Convenciones de código

- Código e identificadores en **inglés**; comentarios, documentación y textos de la UI en **español**.
- Separar estrictamente **física / control / render / input**: la física no debe importar nada de Three.js salvo tipos matemáticos (`Vector3`, `Quaternion`), para poder testearla sin navegador.
- Todos los parámetros "mágicos" (masa, ganancias PID, velocidades máx.) van en `core/config.ts`, nunca hardcodeados.
- Funciones pequeñas y puras cuando sea posible; tests unitarios para PID, integración de física y mapeo de entrada.
- Commits pequeños y descriptivos.

## Notas para Claude

- El usuario está **aprendiendo**: al introducir conceptos de física de drones, PID o gráficos 3D, explica brevemente el *por qué* de las decisiones.
- Cuando se añada una funcionalidad de pilotaje, relaciónala con cómo se comporta un dron DJI real y qué habilidad ayuda a practicar.
- Prioriza que el simulador sea jugable en cada paso de la hoja de ruta antes de añadir complejidad.
