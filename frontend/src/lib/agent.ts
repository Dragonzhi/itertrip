import './schedule.ts';
import '../../../shared/weather.js';
import '../../../shared/agent.js';
import type { RouteJSON } from '../types/route';
import type { Place, Hotel, TransportOption } from '../types/route';
export type AgentAction =
  | {op:'move_place';place_id:string;to_day:number;before_id?:string}
  | {op:'set_duration';place_id:string;minutes:number}
  | {op:'lock_visit';place_id:string;locked:boolean}
  | {op:'set_reservation';place_id:string;date:string;start:string;end:string}
  | {op:'add_place';to_day:number;name:string;type:'attraction'|'food'|'transport'|'other'};
export interface AgentProposal {transaction_id:string;base_version:string;actions:AgentAction[]}
export interface AgentCandidate {route:RouteJSON;changed:boolean;replayed?:boolean;reasons:string[];unknown:string[]}
export interface AgentEvidence {base_version:string;from_id:string;to_id:string;from_point:Place|Hotel;to_point:Place|Hotel;options:TransportOption[]}
export const agent=(globalThis as unknown as {IterTripAgent:{prepare(route:RouteJSON,proposal:AgentProposal,version:string,completed?:string[],requireComplete?:boolean,evidence?:AgentEvidence[],requireWeather?:boolean):AgentCandidate}}).IterTripAgent;
