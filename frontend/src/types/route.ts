export interface PriceItem {
  platform: string;
  price: number;
  breakfast?: boolean;
  note?: string;
}

export interface Hotel {
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
  day: number;
  theme?: string;
  places: Place[];
  hotel?: Hotel | null;
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