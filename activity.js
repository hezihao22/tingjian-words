'use strict';
const Activity=(()=>{
  const $=s=>document.querySelector(s),writer=crypto.randomUUID(),trackers=new Map();
  let dirty=false,lastFlush=0,selected=ActivityCore.dayKey(new Date()),year=new Date().getFullYear();
  const safe=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const duration=ms=>{const s=Math.floor(ms/1000);return s>=3600?`${Math.floor(s/3600)}小时${Math.floor(s%3600/60)}分`:s>=60?`${Math.floor(s/60)}分${s%60}秒`:`${s}秒`;};
  function entry(day){
    saved.activity??={version:1,started:Date.now(),days:{}};saved.activity.days??={};saved.activity.started||=Date.now();
    return (saved.activity.days[day]??={})[writer]??={wordMs:0,exampleMs:0,words:{}};
  }
  function wordRow(e,w){return e.words[w.id]??={en:w.en,zh:w.zh||w.main||'',book:w.book||'',times:0,repeats:0,exampleMs:0};}
  function flush(){if(!dirty)return;dirty=false;lastFlush=Date.now();save();}
  function changed(){dirty=true;if(Date.now()-lastFlush>=5000)flush();}
  function listen(kind,word,ms,end){
    ActivityCore.splitDays(end,ms,(day,amount)=>{const e=entry(day);e[kind==='example'?'exampleMs':'wordMs']+=Math.round(amount);if(kind==='example'&&word)wordRow(e,word).exampleMs+=Math.round(amount);});changed();
  }
  function completed(w,first,at,visits){
    if(!w||!/^[a-f0-9]{24}$/.test(w.id))return;
    const day=ActivityCore.dayKey(new Date(at)),row=wordRow(entry(day),w),key=day+':'+w.id;
    row.repeats++;if(!visits.has(key)){row.times++;visits.add(key);}changed();
  }
  function detach(audio){const t=trackers.get(audio);if(!t)return;t.clock.pause(audio.currentTime);for(const [event,fn]of t.events)audio.removeEventListener(event,fn);trackers.delete(audio);flush();}
  function attach(audio,{kind='word',word=null,segments=[],visits=new Set()}={}){
    detach(audio);if(!Auth.unlocked)return;
    const session={events:[],clock:null,visits};
    const c=ActivityCore.clock({segments,onTime:(ms,at)=>listen(kind,word,ms,at),onRepeat:(w,first,at)=>completed(w,first,at,visits)});session.clock=c;
    const on=(e,f)=>{audio.addEventListener(e,f);session.events.push([e,f]);};
    if(kind==='word'&&word&&!segments.length)on('loadedmetadata',()=>{segments.push({start:0,end:audio.duration,word,visit:word.id});});
    on('playing',()=>c.play(audio.currentTime,audio.playbackRate));
    on('timeupdate',()=>{if(!audio.seeking)c.sample(audio.currentTime);});
    for(const event of ['pause','waiting','ended','error'])on(event,()=>{if(!audio.seeking)c.pause(audio.currentTime);flush();});
    on('seeking',()=>{
      // Native looping seeks to zero without an ended event. Account for the played tail.
      if(audio.loop&&audio.currentTime<.1&&c.position>audio.duration-.5&&audio.played.length&&audio.played.end(audio.played.length-1)>=audio.duration-.025)c.sample(audio.duration);
      c.seek(audio.currentTime,audio.playbackRate);visits.clear();
    });
    on('seeked',()=>{c.seek(audio.currentTime,audio.playbackRate);if(!audio.paused)c.play(audio.currentTime,audio.playbackRate);});
    on('ratechange',()=>c.rate(audio.currentTime,audio.playbackRate));
    trackers.set(audio,session);if(!audio.paused&&!audio.seeking)c.play(audio.currentTime,audio.playbackRate);
  }
  function beforeSeek(audio){const t=trackers.get(audio);if(t){t.clock.pause(audio.currentTime);t.clock.seek(audio.currentTime,audio.playbackRate);t.visits.clear();flush();}}
  function refresh(){
    if(!$('#profile-dialog').open)return;
    render();
  }
  function render(){
    flush();const now=new Date(),today=ActivityCore.dayKey(now),activity=saved.activity||{},years=new Set([now.getFullYear(),year]);
    for(const day of Object.keys(activity.days||{}))years.add(Number(day.slice(0,4)));
    let totalMs=0,activeDays=0;for(const day of Object.keys(activity.days||{})){if(Number(day.slice(0,4))!==year)continue;const s=ActivityCore.summary(activity,day);totalMs+=s.totalMs;if(s.totalMs>0)activeDays++;}
    $('#activity-title').textContent=Profiles.current().name+'的每日学习';
    $('#activity-year').innerHTML=[...years].sort((a,b)=>b-a).map(y=>`<option ${y===year?'selected':''}>${y}</option>`).join('');
    $('#activity-overview').textContent=`${year} 年 · 已听 ${duration(totalMs)} · ${activeDays} 个学习日`;
    const first=new Date(year,0,1,12),last=new Date(year,11,31,12),start=new Date(year,0,1-first.getDay(),12),weeks=Math.ceil(((last-start)/86400000+1)/7);
    let html='',months='';
    for(let col=0;col<weeks;col++){
      const d=new Date(start);d.setDate(start.getDate()+col*7);const monthDay=new Date(d);monthDay.setDate(d.getDate()+6);
      months+=`<span>${monthDay.getFullYear()===year&&(col===0||monthDay.getMonth()!==new Date(d.getFullYear(),d.getMonth(),d.getDate()-1).getMonth())?monthDay.getMonth()+1+'月':''}</span>`;
      for(let row=0;row<7;row++){
        const cell=new Date(d);cell.setDate(d.getDate()+row);const day=ActivityCore.dayKey(cell);
        if(cell.getFullYear()!==year){html+='<span class="heat-spacer"></span>';continue;}
        const s=ActivityCore.summary(activity,day),level=s.totalMs===0?0:s.totalMs<300000?1:s.totalMs<900000?2:s.totalMs<1800000?3:4;
        html+=`<button class="heat-cell heat-${level}${day===selected?' selected':''}" data-day="${day}" aria-label="${day}，听音 ${duration(s.totalMs)}，${s.count} 个词" aria-pressed="${day===selected}" title="${day} · ${duration(s.totalMs)} · ${s.count} 词" tabindex="${day===selected?'0':'-1'}" ${day>today?'disabled':''}></button>`;
      }
    }
    $('#heat-months').innerHTML=months;$('#heat-grid').innerHTML=html;$('#activity-date').value=selected;$('#activity-date').max=today;
    $('#activity-year').onchange=e=>{year=Number(e.target.value);selected=year===now.getFullYear()?today:year+'-12-31';render();scrollSelected();};
    $('#activity-date').onchange=e=>{if(ActivityCore.validDay(e.target.value)&&e.target.value<=today){selected=e.target.value;year=Number(selected.slice(0,4));render();scrollSelected();}};
    $('#activity-today').onclick=()=>{selected=today;year=now.getFullYear();render();scrollSelected();};
    for(const b of document.querySelectorAll('[data-day]')){
      b.onclick=()=>{selected=b.dataset.day;render();};
      b.onkeydown=e=>{const move={ArrowLeft:-7,ArrowRight:7,ArrowUp:-1,ArrowDown:1}[e.key];if(move===undefined)return;e.preventDefault();const d=new Date(selected+'T12:00:00');d.setDate(d.getDate()+move);const key=ActivityCore.dayKey(d);if(key>today)return;selected=key;year=d.getFullYear();render();$(`[data-day="${selected}"]`)?.focus();};
    }
    details();
  }
  function scrollSelected(){const cell=$(`[data-day="${selected}"]`),scroller=$('#heat-scroll');if(cell)scroller.scrollLeft=cell.offsetLeft-scroller.offsetLeft-scroller.clientWidth/2;}
  function details(){
    const s=ActivityCore.summary(saved.activity,selected);
    $('#activity-day-title').textContent=selected+' · 学习明细';
    $('#activity-metrics').innerHTML=[['不同单词',s.count+' 词'],['单词学习',s.times+' 次'],['学习遍数',s.repeats+' 遍'],['听音时长',duration(s.totalMs)]].map(([name,value])=>`<div><strong>${value}</strong><span>${name}</span></div>`).join('');
    $('#activity-breakdown').textContent=`单词播放 ${duration(s.wordMs)} ＋ 例句 ${duration(s.exampleMs)}`;
    const rows=Object.values(s.words).sort((a,b)=>b.repeats-a.repeats||a.en.localeCompare(b.en));
    $('#activity-words').innerHTML=rows.length?`<table class="activity-word-table"><thead><tr><th>当天的词表</th><th>次数</th><th>遍数</th></tr></thead><tbody>${rows.map(w=>`<tr><td><strong>${safe(w.en)}</strong><p>${safe(w.zh)}</p><small>${safe(w.book)}${w.exampleMs?' · 例句 '+duration(w.exampleMs):''}${!w.repeats?' · 只听了例句':''}</small></td><td>${w.times}</td><td>${w.repeats}</td></tr>`).join('')}</tbody></table>`:'<p class="activity-empty">这一天暂无完整听读的单词或例句记录。开始听一个词，让今天多一点绿色。</p>';
  }
  function open(){selected=ActivityCore.dayKey(new Date());year=new Date().getFullYear();render();requestAnimationFrame(scrollSelected);}
  document.addEventListener('visibilitychange',()=>{for(const [audio,t]of trackers)if(!audio.seeking)t.clock.sample(audio.currentTime);flush();});
  window.addEventListener('pagehide',()=>{for(const [audio,t]of trackers)t.clock.pause(audio.currentTime);flush();});
  window.addEventListener('storage',e=>{if(e.key===Profiles.key&&Auth.unlocked){try{saved.activity=ActivityCore.merge(saved.activity,JSON.parse(e.newValue||'{}').activity);refresh();}catch{}}});
  window.addEventListener('tingjian-ready',()=>{saved.activity??={version:1,started:Date.now(),days:{}};});
  new ResizeObserver(()=>{if($('#profile-dialog').open)requestAnimationFrame(scrollSelected);}).observe($('#heat-scroll'));
  return {attach,detach,beforeSeek,flush,open,refresh,duration};
})();
