import './schedule';
import '../../../shared/weather.js';
import type {RouteJSON, Place, Hotel, WeatherForecast} from '../types/route';
export interface WeatherAssessment {
  date: string; label: string; riskMinutes: number; unknown: string[];
  items: {id: string; name: string; label: string; start: number; end: number; minutes: number; probability: number; precipitation_mm: number}[];
}
export interface WeatherCandidate {route: RouteJSON; title: string; days: number[]; rank: number}
export const weather = (globalThis as unknown as {IterTripWeather:{
  labels: Record<string,string>;
  policy(r:RouteJSON): {probability:number;precipitation_mm:number};
  exposure(p:Place|Hotel): string;
  forecast(r:RouteJSON,p:Place|Hotel): {reason?:string;value?:WeatherForecast};
  assess(r:RouteJSON,di:number,completed?:string[]):WeatherAssessment;
  candidates(r:RouteJSON,di:number,completed?:string[]):WeatherCandidate[];
  validate(a:RouteJSON,b:RouteJSON,days:number[],completed?:string[]):{ok:boolean;reasons:string[];beforeRisk:number;afterRisk:number};
  delta(a:RouteJSON,b:RouteJSON,days:number[]):{minutes:number|null;walking:number|null;fees:number|null};
}}).IterTripWeather;
