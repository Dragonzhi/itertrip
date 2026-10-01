/* M30 atomic domain edits. Browser authoritative checks also work offline.
   Tools never write route state; only this candidate feeds the common history stack. */
(function(root) {
  'use strict';
  const S = root.IterTripSchedule, T = root.IterTripTransport;
  const clone = x => JSON.parse(JSON.stringify(x));
  const canonical = x => JSON.stringify(sort(x));
  function sort(x) {
    if (Array.isArray(x)) return x.map(sort);
    if (x && typeof x === 'object') return Object.fromEntries(Object.keys(x).sort().map(k => [k, sort(x[k])]));
    return x;
  }
  const reject = reason => { throw new Error(reason); };
  function keys(x, required, optional=[]) {
    if (!x || typeof x !== 'object' || Array.isArray(x) || required.some(k=>!(k in x)) || Object.keys(x).some(k=>![...required,...optional].includes(k))) reject('操作参数缺失或包含未知字段');
  }
  function integer(x, min, max) { if (!Number.isInteger(x) || x < min || x > max) reject('操作数值无效'); }
  function prepare(route, raw, version, completed=[], requireComplete=false, evidence=[], requireWeather=false) {
    try {
      const p=clone(raw);
      keys(p,['transaction_id','base_version','actions']);
      if (!/^[A-Za-z0-9_-]{8,60}$/.test(p.transaction_id) || typeof p.base_version !== 'string' || p.base_version.length<8 || p.base_version.length>80) reject('操作编号或版本无效');
      if (!Array.isArray(p.actions) || !p.actions.length || p.actions.length>12 || JSON.stringify(p).length>16000) reject('操作数量超出预算');
      for (const a of p.actions) {
        const fields={move_place:['place_id','to_day'],set_duration:['place_id','minutes'],lock_visit:['place_id','locked'],set_reservation:['place_id','date','start','end'],add_place:['to_day','name','type']}[a.op];
        if (!fields) reject('不支持的领域操作');
        keys(a,['op',...fields],a.op==='move_place'?['before_id']:[]);
        if (a.op==='move_place') { if(!('before_id' in a)) a.before_id=''; if(typeof a.before_id!=='string'||a.before_id.length>80) reject('插入位置身份无效'); }
        if ('place_id' in a && (typeof a.place_id!=='string'||!a.place_id||a.place_id.length>80)) reject('地点身份无效');
        if ('to_day' in a) integer(a.to_day,1,30);
        if ('minutes' in a) integer(a.minutes,0,1440);
        if ('locked' in a && typeof a.locked!=='boolean') reject('锁定参数必须为布尔值');
        if (a.op==='add_place' && (typeof a.name!=='string'||!a.name.trim()||a.name.length>150||!['attraction','food','transport','other'].includes(a.type))) reject('新增地点参数无效');
        if (a.op==='set_reservation' && (!S.date(a.date)||S.clock(a.start)===null||S.clock(a.end)===null||a.end<=a.start)) reject('预约时间无效');
      }
      const payload=canonical(p), receipts=route.agent_receipts||[], prior=receipts.find(r=>r.id===p.transaction_id);
      if (prior) {
        if(prior.payload!==payload) reject('操作编号已用于另一组修改');
        return {route,changed:false,replayed:true,reasons:[],unknown:[]};
      }
      if(p.base_version!==version) reject('路线版本已变化，请重新生成');
      if(p.transaction_id!==version) reject('必须使用本轮提供的操作编号');
      if(receipts.length>=1000||JSON.stringify(receipts).length+payload.length>500000) reject('操作记录达到预算，请另存新行程后继续');
      let out=clone(route), index=new Map();
      function reindex() {
        index=new Map();
        out.days.forEach((d,di)=>[...d.places,...(d.hotel?[d.hotel]:[])].forEach(point=>{
          if(!point.id||index.has(point.id)) reject('地点身份缺失或重复');
          index.set(point.id,{point,di,hotel:point===d.hotel});
        }));
      }
      reindex();
      for (const [ai,a] of p.actions.entries()) {
        if(a.op==='add_place') {
          const day=out.days[a.to_day-1],id=`agent-${p.transaction_id}-${ai}`;
          if(!day) reject('目标天不存在');
          if(index.has(id)) reject('新增地点已存在，拒绝重放');
          day.places.push({id,name:a.name,type:a.type,lat:0,lng:0,note:'坐标待确认：请按名称定位后确认。',source:'none',confidence:'low'});
          reindex(); continue;
        }
        const entry=index.get(a.place_id);
        if(!entry) reject('地点不存在：'+a.place_id);
        const {point,di,hotel}=entry,visit=point.visit||{};
        if(completed.includes(point.id)||visit.completed) reject('已完成的访问不能由 AI 修改');
        if(a.op==='move_place') {
          if(hotel||S.fixed(point,completed)) reject('酒店或固定预约不能移动');
          const day=out.days[a.to_day-1];
          if(!day) reject('目标天不存在');
          if(a.before_id===a.place_id) reject('不能移动到自身之前');
          if(a.before_id&&!day.places.some(p=>p.id===a.before_id)) reject('插入位置的地点不存在于目标天');
          out.days[di].places.splice(out.days[di].places.indexOf(point),1);
          const at=day.places.findIndex(p=>p.id===a.before_id);
          day.places.splice(at<0?day.places.length:at,0,point); reindex();
        } else if(a.op==='set_duration') {
          if(S.fixed(point,completed)) reject('固定访问的停留时间不能由 AI 改动');
          point.visit={...visit,duration_min:a.minutes,duration_source:'user'};
        } else if(a.op==='lock_visit') {
          if(!a.locked&&visit.reservation&&visit.reservation.status!=='cancelled') reject('不能解除仍有效的预约约束');
          point.visit={...visit,locked:a.locked};
        } else {
          if(S.fixed(point,completed)) reject('原访问已固定');
          point.visit={...visit,reservation:{type:'entry',date:a.date,start:a.start,end:a.end,status:'pending',url:''}};
        }
      }
      // Applying the whole batch is the only write; failures above/below discard the copy.
      out=T.normalize(out,route); S.refreshClosures(out);
      for(const [di,day] of out.days.entries()) for(const edge of T.legs(out,di)) {
        const match=evidence.find(e=>e.base_version===version&&e.from_id===edge.from.id&&e.to_id===edge.to.id&&
          T.sign({...edge,from:e.from_point,to:e.to_point})===T.sign(edge));
        if(!match||!T.usable(edge.from)||!T.usable(edge.to)) continue;
        const options=match.options.filter(o=>['walk','bus','car'].includes(o.mode)&&o.status==='ok'&&o.source==='amap'&&Number.isFinite(o.duration_s)&&o.duration_s>=0&&
          Number.isFinite(Date.parse(o.queried_at))&&Date.parse(o.queried_at)<=Date.now()+60000&&Date.now()-Date.parse(o.queried_at)<=15*60000);
        if(!options.length) continue;
        const segment=day.transport.find(s=>s.from_id===edge.from.id&&s.to_id===edge.to.id);
        const existing=segment.snapshot?.options||[];
        segment.snapshot={signature:T.sign(edge),options:[...existing.filter(o=>!options.some(n=>n.mode===o.mode)),...clone(options)]};
      }
      const reasons=[],unknown=[];
      const affected=[];
      out.days.forEach((d,di)=>{
        const before=S.calculate(route,di,completed), after=S.calculate(out,di,completed);
        const changed=JSON.stringify(d)!==JSON.stringify(route.days[di]);
        if(!changed) return;
        affected.push(di);
        after.issues.filter(v=>!before.issues.some(o=>o.id===v.id&&o.text===v.text)).forEach(v=>reasons.push(`第 ${di+1} 天：${v.text}`));
        after.unknown.forEach(v=>unknown.push(`第 ${di+1} 天：${v.text}`));
        if(requireComplete) after.issues.forEach(v=>reasons.push(`第 ${di+1} 天：${v.text}`));
        if(requireComplete && after.unknown.length) reasons.push(`第 ${di+1} 天条件不足，暂不能自动重排；请先补齐交通、日期和开放事实`);
        for(const old of before.rows.filter(r=>r.fixed && p.actions.some(a=>a.op!=='lock_visit'))) {
          const next=after.rows.find(r=>r.id===old.id);
          if(!next) {reasons.push('固定访问缺失');continue;}
          if(old.start===null||next.start===null||(old.start!==null&&next.start!==old.start)||(old.departure!==null&&next.departure!==old.departure)) reasons.push('修改影响固定访问的时间或无法确认：'+old.name);
        }
      });
      if(p.actions.some(a=>a.op==='move_place') && root.IterTripWeather) {
        if(requireWeather) reasons.push(...root.IterTripWeather.validate(route,out,affected,completed).reasons);
        else for(const di of affected) {
          const before=root.IterTripWeather.assess(route,di,completed),after=root.IterTripWeather.assess(out,di,completed);
          if(!before.unknown.length&&!after.unknown.length&&after.riskMinutes>before.riskMinutes) reasons.push(`第 ${di+1} 天已知降水暴露增加`);
        }
      } else if(requireWeather) reasons.push('缺少天气评估工具，不能确认避雨调整');
      if(reasons.length) return {route,changed:false,reasons:[...new Set(reasons)],unknown:[...new Set(unknown)]};
      const changed=canonical(out)!==canonical(route);
      if(changed) out.agent_receipts=[...receipts,{id:p.transaction_id,payload}];
      return {route:changed?out:route,changed,replayed:false,reasons:[],unknown:[...new Set(unknown)]};
    } catch(e) { return {route,changed:false,reasons:[e.message||'操作校验失败'],unknown:[]}; }
  }
  root.IterTripAgent={prepare,canonical};
})(typeof globalThis!=='undefined'?globalThis:window);
