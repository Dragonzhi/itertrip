import type { AgentCandidate, AgentEvidence, AgentProposal } from '../lib/agent';
import type { RouteJSON } from '../types/route';
import { diffRoute } from '../lib/routeDiff';
import { optionText, proposalInfo, proposalRows, queryTime, sourceText } from '../lib/agentTrace';
import './agentChat.css';

export default function AgentPreview({proposal, candidate, original, evidence, disabled, apply, cancel}: {
  proposal:AgentProposal;candidate:AgentCandidate;original:RouteJSON;evidence?:AgentEvidence[];disabled:boolean;apply:()=>void;cancel:()=>void;
}) {
  const diff=diffRoute(original,candidate.route);
  const rows=proposalRows(proposal,original);
  const info=proposalInfo(proposal,original);
  const unknown=candidate.unknown||[];
  const evidenceRows=evidence||[];
  const footerNote=proposal.actions.some(a=>a.op==='set_reservation')
    ? <>只记录待确认预约<br/>不会替你预订</>
    : <>应用后可撤销<br/>固定预约不会被改动</>;
  return <section className="mt-2 overflow-hidden rounded-xl border border-[#DCCEB8] bg-white shadow-[0_8px_24px_rgba(43,43,40,.07)]" aria-label="路线修改预览" data-testid="agent-preview">
    <header className="flex items-start gap-2 border-b border-[#F2EBDD] bg-gradient-to-b from-white to-[#FDFBF6] px-3 py-2.5">
      {info.badge&&<span className="mt-0.5 shrink-0 rounded border border-[#E7D3B1] bg-gold-soft px-1.5 py-0.5 text-[9px] font-extrabold tracking-wide text-gold-deep">{info.badge}</span>}
      <div className="min-w-0 flex-1">
        <h3 className="text-[13px] font-bold leading-snug tracking-tight">{info.title}</h3>
        <p className="mt-0.5 text-[10.5px] leading-snug text-ink-soft">{info.note}</p>
      </div>
      <span className="mt-0.5 shrink-0 rounded bg-gold-soft px-1.5 py-0.5 text-[9px] font-extrabold text-gold-deep">待确认</span>
    </header>

    <div className="border-b border-line/60">
      {rows.length>0?rows.map(row=>
        <div key={row.key} data-testid="agent-preview-row" className="grid grid-cols-[78px_minmax(0,1fr)_12px_minmax(0,1.1fr)] items-center gap-1.5 border-b border-line/40 px-3 py-1.5 text-[11px] leading-snug last:border-b-0">
          <span className="truncate font-semibold text-ink" title={row.label}>{row.label}</span>
          <span className={"truncate "+(row.isNew?"italic text-[#B3AA9A]":"text-ink-soft line-through decoration-[#D8CFC0]")} title={row.from}>{row.from}</span>
          <span className="text-center text-[9px] text-[#C1B8A8]">→</span>
          <span className="truncate font-semibold text-moss" title={row.to}>{row.to}</span>
        </div>
      ):diff.summary.length>0?diff.summary.map((line,i)=>
        <div key={i} data-testid="agent-preview-summary" className="border-b border-line/40 px-3 py-1.5 text-[11px] leading-relaxed text-ink-soft last:border-b-0">{line}</div>
      ):<div className="px-3 py-2 text-[11px] text-ink-soft">没有可预览的字段变化。</div>}
    </div>

    {evidenceRows.length>0&&<details className="agent-evidence border-b border-line/60">
      <summary className="flex cursor-pointer list-none items-center gap-1.5 px-3 py-2 text-[11px] text-ink-soft">
        <span className="font-semibold text-ink/80">依据</span>
        <span>· 查了 {evidenceRows.length} 段交通</span>
        <span className="ml-auto font-semibold text-moss">查看</span>
        <span className="agent-evidence-chev inline-block text-moss" aria-hidden="true">›</span>
      </summary>
      <div className="space-y-1 px-3 pb-2">
        {evidenceRows.map((leg,index)=>{
          const opts=leg.options.filter(o=>o.status==='ok').slice(0,3);
          const first=opts[0]||leg.options[0];
          return <div key={index} className="rounded-lg border border-line/70 bg-cream/50 px-2 py-1.5">
            <p className="text-[11px] font-semibold text-ink/90">{leg.from_point.name} <span className="font-normal text-ink-soft">→</span> {leg.to_point.name}</p>
            <p className="mt-0.5 text-[10px] text-moss">{opts.length?opts.map(optionText).join(' · '):'没有可用方案'}</p>
            <p className="mt-0.5 text-[10px] text-ink-soft">{sourceText(first?.source)} · 查询于 {queryTime(first?.queried_at)||'未知'}</p>
          </div>;
        })}
      </div>
    </details>}

    {unknown.length>0&&<details className="agent-evidence border-b border-[#EAD8B8] bg-gold-soft/70">
      <summary className="flex cursor-pointer list-none items-center gap-1 px-3 py-2 text-[11px] text-gold-deep">
        <span className="font-semibold">仍未评估</span>
        <span className="min-w-0 truncate">· {unknown[0]}{unknown.length>1?` 等 ${unknown.length} 项`:''}</span>
        <span className="ml-auto shrink-0 font-semibold underline underline-offset-2">查看</span>
      </summary>
      <ul className="list-disc space-y-0.5 px-6 pb-2 text-[10px] leading-relaxed text-gold-deep">
        {unknown.slice(0,10).map((line,i)=><li key={i}>{line}</li>)}
      </ul>
    </details>}

    <footer className="flex items-center gap-2 border-t border-[#F2EBDD] bg-[#FFFDFA] px-3 py-2.5">
      <button type="button" className="rounded-lg bg-moss px-3 py-1.5 text-xs font-semibold text-white disabled:opacity-50" disabled={disabled} onClick={apply}>应用这组修改</button>
      <button type="button" className="rounded-lg border border-line bg-white px-3 py-1.5 text-xs text-ink-soft hover:text-ink" onClick={cancel}>取消</button>
      <span className="ml-auto text-right text-[10px] leading-tight text-ink-soft">{footerNote}</span>
    </footer>
  </section>;
}
