import type { AgentCandidate, AgentProposal } from '../lib/agent';
import type { RouteJSON } from '../types/route';
import { diffRoute } from '../lib/routeDiff';
export default function AgentPreview({proposal, candidate, original, disabled, apply, cancel}: {
  proposal:AgentProposal;candidate:AgentCandidate;original:RouteJSON;disabled:boolean;apply:()=>void;cancel:()=>void;
}) {
  const diff=diffRoute(original,candidate.route);
  return <section className="bg-cream border border-line rounded-xl p-3 mt-2 space-y-2" aria-label="路线修改预览" data-testid="agent-preview">
    <p className="font-medium text-sm">修改预览 · 尚未应用</p>
    <ul className="text-xs space-y-1">{diff.summary.map((s,i)=><li key={i}>{s}</li>)}</ul>
    {proposal.actions.some(a=>a.op==='set_reservation')&&<p className="text-xs text-gold-deep">仅记录待确认预约，未替你预订或购票。</p>}
    {!!candidate.unknown.length&&<details className="text-xs text-gold-deep"><summary>仍有 {candidate.unknown.length} 项未充分评估</summary><ul>{candidate.unknown.slice(0,10).map((s,i)=><li key={i}>{s}</li>)}</ul></details>}
    <div className="flex gap-2"><button type="button" className="px-3 py-1.5 rounded-lg bg-moss text-white text-xs disabled:opacity-50" disabled={disabled} onClick={apply}>应用这组修改</button><button type="button" className="px-3 py-1.5 rounded-lg border border-line text-xs" onClick={cancel}>取消</button></div>
  </section>;
}
