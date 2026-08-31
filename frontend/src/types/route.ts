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