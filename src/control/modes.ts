// Modos de vuelo. En la fase 1 solo existe Normal (GPS): auto-nivelado, y al soltar los sticks
// el dron frena y mantiene posición y altura, como un DJI por defecto.
// Cine, Sport y ATTI llegan en la fase 3; Acro en la 8.

import { modesConfig, type FlightModeParams } from '../core/config';

export type FlightModeName = keyof typeof modesConfig;

export const FLIGHT_MODE_LABELS: Record<FlightModeName, string> = {
  normal: 'Normal',
};

export function modeParams(mode: FlightModeName): FlightModeParams {
  return modesConfig[mode];
}
