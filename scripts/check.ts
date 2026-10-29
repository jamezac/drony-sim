// npm run check: abre las páginas en el Chrome de Windows en modo invisible, guarda una
// captura de cada una en .check/ y lista los errores de consola. Termina con código 1 si hay errores.
//
// Cómo funciona desde WSL:
// - Playwright no puede lanzar el Chrome de Windows con launch() (usa una "tubería" que no
//   cruza de Linux a Windows), así que lo arrancamos nosotros con un puerto de depuración
//   y nos conectamos por CDP (Chrome DevTools Protocol).
// - Requiere WSL con networkingMode=mirrored para que WSL vea el puerto de Chrome en Windows.

import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { chromium, type Browser } from 'playwright-core';
import { createServer, type ViteDevServer } from 'vite';

const CHROME_PATH =
  process.env.CHROME_PATH ?? '/mnt/c/Program Files (x86)/Google/Chrome/Application/chrome.exe';
const VITE_PORT = 5174; // distinto del 5173 de `npm run dev` para no chocar
const CDP_PORT = 9223;
const VIEWPORT = { width: 1280, height: 720 };
// Escala de pantalla como la de Windows al 150 %: con escala 1 se escapan fallos de tamaño del canvas
const DEVICE_SCALE_FACTOR = 1.5;
const CHROME_START_TIMEOUT_MS = 15_000;
const READY_TIMEOUT_MS = 15_000;
const OUT_DIR = '.check';
const PROFILE_NAME = 'drony-check'; // carpeta del perfil temporal dentro de %TEMP%

// Páginas a revisar. Crece con cada fase del plan.
const PAGES: { name: string; path: string }[] = [
  { name: 'index', path: '/' },
  { name: 'demo-hover', path: '/?demo=hover' },
  { name: 'demo-sticks', path: '/?demo=sticks' },
  { name: 'atti-hover', path: '/?demo=hover&mode=atti' },
  { name: 'graph', path: '/?demo=sticks&mode=sport&graph=1' },
  { name: 'wind-hover', path: '/?demo=hover&wind=moderado' },
  { name: 'rth', path: '/?demo=rth&battery=25' },
  { name: 'lesson-menu', path: '/?menu=lecciones' },
  { name: 'lesson-hover', path: '/?lesson=hover&demo=hover' },
  { name: 'lesson-square', path: '/?lesson=cuadrado' },
  { name: 'fpv', path: '/?camera=fpv&demo=sticks' },
  { name: 'pilot-pip', path: '/?camera=pilot&demo=sticks' },
  { name: 'parque', path: '/?scenario=parque&demo=hover' },
  { name: 'ciudad', path: '/?scenario=ciudad&demo=hover' },
  { name: 'obstaculos', path: '/?scenario=obstaculos&demo=hover' },
  { name: 'crash', path: '/?scenario=obstaculos&demo=crash' },
  { name: 'lesson-obstacles', path: '/?lesson=obstaculos&demo=hover' },
  { name: 'devices', path: '/devices.html' },
];

interface PageResult {
  name: string;
  errors: string[];
  warnings: string[];
  screenshot: string;
}

function windowsTempDir(): string {
  // cwd en /mnt/c para que cmd.exe no se queje de rutas UNC de WSL
  return execFileSync('cmd.exe', ['/c', 'echo %TEMP%'], { cwd: '/mnt/c', encoding: 'utf8' }).trim();
}

/**
 * Cierra los procesos de Chrome que usan nuestro perfil temporal (nunca tu Chrome normal).
 * Hace falta porque matar el proceso desde WSL no cierra el chrome.exe de Windows.
 */
function killCheckChrome(): void {
  const script =
    "Get-CimInstance Win32_Process -Filter \"name='chrome.exe'\" | " +
    `Where-Object { $_.CommandLine -like '*${PROFILE_NAME}*' } | ` +
    'ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }';
  try {
    execFileSync('powershell.exe', ['-NoProfile', '-Command', script], { cwd: '/mnt/c', stdio: 'ignore' });
  } catch {
    // Si PowerShell falla no hay mucho más que hacer; no debe tapar el resultado del check
  }
}

function startChrome(): ChildProcess {
  const profileDir = `${windowsTempDir()}\\${PROFILE_NAME}`;
  return spawn(
    CHROME_PATH,
    [
      '--headless=new',
      `--remote-debugging-port=${CDP_PORT}`,
      // Perfil propio: no interfiere con tu Chrome abierto ni con tu perfil
      `--user-data-dir=${profileDir}`,
      `--window-size=${VIEWPORT.width},${VIEWPORT.height}`,
      '--no-first-run',
      '--no-default-browser-check',
      // Si no hay GPU disponible, permite WebGL por software en lugar de fallar
      '--enable-unsafe-swiftshader',
      'about:blank',
    ],
    { cwd: '/mnt/c', stdio: 'ignore' },
  );
}

async function waitForCdp(chrome: ChildProcess): Promise<void> {
  const deadline = Date.now() + CHROME_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (chrome.exitCode !== null && chrome.exitCode !== 0) {
      throw new Error(`Chrome terminó con código ${chrome.exitCode}. ¿Es correcta la ruta ${CHROME_PATH}?`);
    }
    try {
      const response = await fetch(`http://localhost:${CDP_PORT}/json/version`);
      if (response.ok) return;
    } catch {
      // Todavía no escucha; reintentamos
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error(
    `No se pudo conectar con Chrome en localhost:${CDP_PORT}.\n` +
      '  ¿Activaste networkingMode=mirrored en C:\\Users\\<tú>\\.wslconfig y ejecutaste `wsl --shutdown`?',
  );
}

async function checkPage(browser: Browser, baseUrl: string, name: string, path: string): Promise<PageResult> {
  const result: PageResult = { name, errors: [], warnings: [], screenshot: `${OUT_DIR}/${name}.png` };
  const context = await browser.newContext({ viewport: VIEWPORT, deviceScaleFactor: DEVICE_SCALE_FACTOR });
  const page = await context.newPage();

  page.on('console', (message) => {
    const { url, lineNumber } = message.location();
    const where = url ? ` (${url.replace(baseUrl, '')}:${lineNumber})` : '';
    if (message.type() === 'error') result.errors.push(`console.error: ${message.text()}${where}`);
    if (message.type() === 'warning') result.warnings.push(`console.warn: ${message.text()}${where}`);
  });
  page.on('pageerror', (error) => result.errors.push(`excepción: ${error.message}`));
  page.on('requestfailed', (request) =>
    result.errors.push(`petición fallida: ${request.url()} (${request.failure()?.errorText ?? '?'})`),
  );
  page.on('response', (response) => {
    if (response.status() >= 400) result.errors.push(`HTTP ${response.status()}: ${response.url()}`);
  });

  try {
    await page.goto(baseUrl + path, { waitUntil: 'load' });
    await page.waitForFunction(() => window.__dronyReady === true, null, { timeout: READY_TIMEOUT_MS });
  } catch (error) {
    result.errors.push(`la página no quedó lista: ${error instanceof Error ? error.message.split('\n')[0] : String(error)}`);
  }
  // Página completa: en páginas largas (como devices) lo importante puede quedar bajo el pliegue
  await page.screenshot({ path: result.screenshot, fullPage: true });
  await context.close();
  return result;
}

function printReport(results: PageResult[]): boolean {
  let ok = true;
  for (const { name, errors, warnings, screenshot } of results) {
    ok &&= errors.length === 0;
    console.log(`${errors.length === 0 ? '✓' : '✗'} ${name}  →  ${screenshot}`);
    for (const error of errors) console.log(`    ✗ ${error}`);
    for (const warning of warnings) console.log(`    ⚠ ${warning}`);
  }
  console.log(ok ? '\nSin errores.' : '\nHay errores.');
  return ok;
}

async function main(): Promise<void> {
  mkdirSync(OUT_DIR, { recursive: true });
  let server: ViteDevServer | undefined;
  let chrome: ChildProcess | undefined;
  let browser: Browser | undefined;

  try {
    server = await createServer({ server: { port: VITE_PORT, strictPort: true }, logLevel: 'warn' });
    await server.listen();
    const baseUrl = `http://localhost:${VITE_PORT}`;

    killCheckChrome(); // por si quedó alguno de una ejecución anterior interrumpida
    chrome = startChrome();
    await waitForCdp(chrome);
    browser = await chromium.connectOverCDP(`http://localhost:${CDP_PORT}`);

    const results: PageResult[] = [];
    for (const { name, path } of PAGES) {
      results.push(await checkPage(browser, baseUrl, name, path));
    }
    if (!printReport(results)) process.exitCode = 1;
  } finally {
    if (browser) {
      // browser.close() en una conexión CDP solo desconecta: pedimos a Chrome que se cierre
      const session = await browser.newBrowserCDPSession();
      await session.send('Browser.close').catch(() => {});
      await browser.close().catch(() => {});
    }
    chrome?.kill();
    if (chrome) killCheckChrome();
    await server?.close();
  }
}

main().catch((error: unknown) => {
  console.error(`✗ ${error instanceof Error ? error.message : String(error)}`);
  process.exitCode = 1;
});
