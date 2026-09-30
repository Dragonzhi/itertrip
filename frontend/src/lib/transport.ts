import './navigation.ts';
import '../../../shared/transport.js';
import '../../../shared/schedule.js';
import type { RouteJSON, Place, Hotel, TransportSegment, TransportOption } from '../types/route';
export type Edge = { from: Place | Hotel; to: Place | Hotel; city: string; di: number };
export const transport = (globalThis as unknown as { IterTripTransport: {
  normalize(route: RouteJSON, previous?: RouteJSON): RouteJSON;
  legs(route: RouteJSON, di: number): Edge[];
  sign(edge: Edge): string;
  usable(point: Place | Hotel): boolean;
  selected(day: RouteJSON['days'][number], edge: Edge): { segment?: TransportSegment; mode: string; option?: TransportOption; stale: boolean; known: boolean };
  summary(route: RouteJSON, di: number): { total: number; known: number; seconds: number; walking: number; walkKnown: number; fees: number; feeKnown: number; buffer: number };
  labels: Record<string, string>;
} }).IterTripTransport;
export function normalizeRoute(route: RouteJSON, previous?: RouteJSON) {
  const normalized = transport.normalize(JSON.parse(JSON.stringify(route)), previous);
  return (globalThis as unknown as { IterTripSchedule: {refreshClosures(r: RouteJSON): RouteJSON} }).IterTripSchedule.refreshClosures(normalized);
}
