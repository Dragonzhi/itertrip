export interface PriceItem {
  platform: string;
  price: number;
  breakfast?: boolean;
  breakfast_known?: boolean;
  note?: string;
  source_url?: string;
  queried_at?: string;
  check_in?: string;
  check_out?: string;
  room?: string;
  occupancy?: string;
  cancellation?: string;
  unit?: 'night' | 'stay' | '';
}

export interface Hotel {
  weather_exposure?: WeatherExposure;
  visit?: VisitPlan;
  opening?: OpeningFact[];
  id?: string;
  poi_id?: string;
  city_code?: string;
  name: string;
  lat: number;
  lng: number;
  note?: string;
  prices?: PriceItem[];
  verdict?: string;
  bookingUrl?: string;
  /** M19 坐标溯源：memory|user|amap|llm|search|city|mock */
  source?: string;
  /** M19 坐标置信度：high|low|none|""（未核验） */
  confidence?: string;
}

export type PlaceType = "attraction" | "food" | "transport" | "other";

export interface Place {
  weather_exposure?: WeatherExposure;
  visit?: VisitPlan;
  opening?: OpeningFact[];
  id?: string;
  poi_id?: string;
  city_code?: string;
  name: string;
  lat: number;
  lng: number;
  type?: PlaceType;
  time?: string;
  transport?: string;
  ticket?: string;
  note?: string;
  /** M19 坐标溯源：memory|user|amap|llm|search|city|mock */
  source?: string;
  /** M19 坐标置信度：high|low|none|""（未核验） */
  confidence?: string;
  /** M22 事实告警（确定性检查写出，如「闭馆日：周一闭馆，当天为周一（D5 · 2026-10-05）」） */
  warnings?: string[];
}

export interface DayPlan {
  schedule?: { start?: string; end?: string };
  day: number;
  theme?: string;
  places: Place[];
  hotel?: Hotel | null;
  traffic_mode?: 'walk' | 'bus' | 'car';
  start_from_hotel?: boolean;
  transport?: TransportSegment[];
}

/** Times are local to the destination (first release: Asia/Shanghai); never inferred from prose. */
export interface VisitPlan {
  duration_min?: number | null;
  duration_source?: 'user' | 'estimate';
  kind?: 'visit' | 'meal' | 'rest';
  required?: boolean;
  locked?: boolean;
  completed?: boolean;
  reservation?: {
    type: 'entry' | 'train' | 'hotel' | 'other';
    date: string; start: string; end: string;
    status: 'needed' | 'pending' | 'confirmed' | 'cancelled';
    url?: string;
  };
}
/** User records structured facts after consulting a source; search candidates are never verified facts. */
export interface OpeningFact {
  place_name?: string;
  entry_policy?: 'unknown' | 'none' | 'last_entry';
  open?: string; close?: string; last_entry?: string;
  closed?: boolean; reservation_required?: boolean;
  weekdays?: number[]; // ISO weekday, 1=Monday
  valid_from: string; valid_to: string;
  source_kind: 'official' | 'map' | 'user';
  source_url: string; checked_at: string;
  confirmed: boolean;
}

export interface TransportOption {
  mode: 'walk' | 'bus' | 'car';
  status: 'ok' | 'unknown';
  reason?: string;
  duration_s?: number | null;
  distance_m?: number | null;
  walking_m?: number | null;
  fee_yuan?: number | null;
  tolls_yuan?: number | null;
  fee_kind?: string;
  description?: string;
  queried_at: string;
  source: string;
  source_url: string;
}
export interface TransportSnapshot { signature: string; options: TransportOption[]; refresh_error?: string }
export interface TransportSegment {
  from_id: string; to_id: string;
  mode?: '' | 'walk' | 'bus' | 'car'; buffer_min: number;
  snapshot?: TransportSnapshot;
}

export interface TripInfo {
  title: string;
  destination: string;
  days: number;
  dates?: string;
  budget?: string;
  style?: string;
  travelers?: string;
  /** M22 结构化出发日期（YYYY-MM-DD）：dates 是给人看的文本，算不出星期，靠它算 */
  start_date?: string;
  /** M22 日期来源：user=用户给定 / inferred=推断（界面显式标注）/ ""=未知 */
  date_source?: string;
}

export interface RouteJSON {
  trip: TripInfo;
  days: DayPlan[];
  summary?: string[];
  weather?: WeatherForecast[];
  weather_policy?: { probability: number; precipitation_mm: number };
}

export interface WeatherExposure {
  environment: 'indoor' | 'outdoor' | 'mixed' | 'unknown';
  rain_sensitive: boolean; source: 'user'; place_name: string; confirmed_at: string;
}
export interface WeatherForecast {
  provider: 'qweather' | 'open_meteo'; source_url: string; attributions: string[];
  queried_at: string; issued_at: string | null; timezone: string;
  granularity: 'hourly' | 'daily'; kind: 'forecast' | 'historical';
  lat: number; lng: number; valid_from: string; valid_to: string; refresh_error?: string;
  hours: {start: string; end: string; probability: number | null; precipitation_mm: number | null}[];
}

export interface PlanRequest {
  destination: string;
  days: number;
  date?: string;
  travelers?: string;
  budget?: string;
  style?: string;
  constraints?: string;
}
