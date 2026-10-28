(function(root){
  'use strict';
  const dayKey=date=>`${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`;
  const validDay=s=>/^\d{4}-\d{2}-\d{2}$/.test(s)&&!Number.isNaN(Date.parse(s))&&new Date(s).toISOString().slice(0,10)===s;
  const number=v=>Number.isFinite(v)&&v>=0?Math.min(1e10,Math.round(v)):0;
  const text=(v,n)=>typeof v==='string'?v.slice(0,n):'';
  function clean(raw){
    const out={version:1,started:number(raw?.started),days:{}};
    for(const [day,writers]of Object.entries(raw?.days||{})){
      if(!validDay(day)||!writers||typeof writers!=='object')continue;
      const entries={};
      for(const [id,s]of Object.entries(writers)){
        if(!/^[a-f0-9-]{36}$/.test(id)||!s||typeof s!=='object')continue;
        const entry={wordMs:number(s.wordMs),exampleMs:number(s.exampleMs),words:{}};
        for(const [wid,w]of Object.entries(s.words||{})){
          if(!/^[a-f0-9]{24}$/.test(wid)||!w||typeof w!=='object')continue;
          entry.words[wid]={en:text(w.en,160),zh:text(w.zh,300),book:text(w.book,160),times:number(w.times),repeats:number(w.repeats),exampleMs:number(w.exampleMs)};
        }
        entries[id]=entry;
      }
      if(Object.keys(entries).length)out.days[day]=entries;
    }
    // Epoch milliseconds need their own range (not the duration counter bound).
    out.started=Number.isSafeInteger(raw?.started)&&raw.started>0?raw.started:0;
    return out;
  }
  function merge(left,right){
    const a=clean(left),b=clean(right);
    a.started=a.started&&b.started?Math.min(a.started,b.started):a.started||b.started;
    for(const [day,writers]of Object.entries(b.days))for(const [id,y]of Object.entries(writers)){
      const x=(a.days[day]??={})[id];if(!x){a.days[day][id]=y;continue;}
      for(const field of ['wordMs','exampleMs'])x[field]=Math.max(x[field],y[field]);
      for(const [wid,w]of Object.entries(y.words)){
        if(!x.words[wid]){x.words[wid]=w;continue;}
        const old=x.words[wid];for(const field of ['times','repeats','exampleMs'])old[field]=Math.max(old[field],w[field]);
        for(const field of ['en','zh','book'])old[field]=[old[field],w[field]].sort().pop();
      }
    }
    return a;
  }
  function summary(activity,day){
    const out={wordMs:0,exampleMs:0,words:{},times:0,repeats:0,count:0};
    for(const entry of Object.values(activity?.days?.[day]||{})){
      out.wordMs+=entry.wordMs||0;out.exampleMs+=entry.exampleMs||0;
      for(const [id,w]of Object.entries(entry.words||{})){
        const row=out.words[id]??={...w,times:0,repeats:0,exampleMs:0};
        // Stored repeats remains the legacy raw English clip counter for safe old-client merges.
        // Displayed learning rounds use word visits: one automatic triple is one round.
        row.times+=w.times||0;row.repeats+=w.times||0;row.exampleMs+=w.exampleMs||0;
      }
    }
    for(const w of Object.values(out.words)){out.times+=w.times;out.repeats+=w.repeats;if(w.repeats>0)out.count++;}
    out.totalMs=out.wordMs+out.exampleMs;return out;
  }
  // Split actual listening time at local midnight, including a suspended background tab.
  function splitDays(end,ms,emit){
    let start=end-ms;
    while(start<end){const d=new Date(start),next=new Date(d.getFullYear(),d.getMonth(),d.getDate()+1).getTime(),until=Math.min(end,next);emit(dayKey(d),until-start);start=until;}
  }
  // Playback clock is independent of UI rendering. Seeking resets coverage, never earns credit.
  function clock({segments=[],onTime=()=>{},onRepeat=()=>{},now=()=>Date.now()}){
    let time=0,wall=now(),rate=1,running=false,coverage=new Map(),seen=new Set();
    const anchor=(t,r)=>{time=t;rate=r||1;wall=now();};
    function sample(t){
      const at=now(),delta=t-time,elapsed=(at-wall)/1000;
      if(running&&delta>0&&delta<=elapsed*rate+.15){
        const ms=Math.min(delta/rate*1000,Math.max(0,at-wall));
        if(ms>0)onTime(ms,at,time,t);
        for(let i=0;i<segments.length;i++){
          const s=segments[i],part=Math.max(0,Math.min(t,s.end)-Math.max(time,s.start));if(!part)continue;
          const n=(coverage.get(i)||0)+part;coverage.set(i,n);
          if(n>=s.end-s.start-.035){
            // Mark each completed segment only once during this playback pass.
            if(n>=0&&coverage.get('done'+i)!==true){coverage.set('done'+i,true);const first=!seen.has(s.visit);seen.add(s.visit);onRepeat(s.word,first,at-Math.max(0,t-s.end)/rate*1000);}
          }
        }
      }
      time=t;wall=at;
    }
    return {
      sample,
      play(t,r=1){anchor(t,r);running=true;},
      pause(t){sample(t);running=false;},
      seek(t,r=rate){coverage.clear();seen.clear();running=false;anchor(t,r);},
      rate(t,r){sample(t);anchor(t,r);},
      get running(){return running;},get position(){return time;}
    };
  }
  const api={dayKey,validDay,clean,merge,summary,splitDays,clock};
  if(typeof module!=='undefined')module.exports=api;else root.ActivityCore=api;
})(typeof window!=='undefined'?window:globalThis);
