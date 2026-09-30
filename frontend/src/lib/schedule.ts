import './transport.ts';
import '../../../shared/schedule.js';
import type { RouteJSON, Place, Hotel, OpeningFact, PriceItem } from '../types/route';
export interface ScheduleRow {
  id?: string; name: string; hotel: boolean; arrival: number | null; start: number | null;
  departure: number | null; wait: number; fixed: boolean; issues: string[]; unknown: string[]; suggestions: string[];
  fact: { known: boolean; reason?: string; value?: OpeningFact } | null;
}
export interface ScheduleResult {
  date: string; rows: ScheduleRow[]; issues: {id: string; text: string}[];
  unknown: {id: string; text: string}[]; end: number | null;
  status: 'conflict' | 'unassessed' | 'estimated'; label: string;
}
export const schedule = (globalThis as unknown as { IterTripSchedule: {
  clock(value?: string): number | null;
  date(value?: string): Date | null;
  dayDate(route: RouteJSON, di: number): string;
  fmt(min: number | null): string;
  url(value?: string): string;
  fixed(point: Place | Hotel, completed?: string[]): boolean;
  calculate(route: RouteJSON, di: number, completed?: string[]): ScheduleResult;
  refreshClosures(route: RouteJSON): RouteJSON;
  protect(old: RouteJSON, candidate: RouteJSON, completed?: string[]): {route: RouteJSON; reasons: string[]};
  comparable(p: PriceItem, checkIn: string, checkOut: string): boolean;
  quoteGroup(p: PriceItem): string;
} }).IterTripSchedule;
