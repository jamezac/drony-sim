/// <reference types="vite/client" />

declare global {
  interface Window {
    /** Lo activa cada página cuando ya ha renderizado; `npm run check` lo espera antes de capturar. */
    __dronyReady?: boolean;
  }
}

export {};
