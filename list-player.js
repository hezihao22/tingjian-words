'use strict';
// Prepare one native audio resource. No JavaScript timers advance the playlist.
const ListAudio=(()=>{
  const rate=24000;
  function header(samples){
    const bytes=new Uint8Array(44),v=new DataView(bytes.buffer);
    const tag=(i,s)=>[...s].forEach((c,j)=>v.setUint8(i+j,c.charCodeAt(0)));
    tag(0,'RIFF');v.setUint32(4,36+samples*2,true);tag(8,'WAVE');tag(12,'fmt ');
    v.setUint32(16,16,true);v.setUint16(20,1,true);v.setUint16(22,1,true);
    v.setUint32(24,rate,true);v.setUint32(28,rate*2,true);v.setUint16(32,2,true);v.setUint16(34,16,true);
    tag(36,'data');v.setUint32(40,samples*2,true);return bytes;
  }
  async function build(list,index,options){
    const {signal,onProgress,meaning,gap,speed}=options;
    const plans=list.map(w=>WordCore.sequence(w,meaning(w),true).map(p=>({...p,key:index[p.lang]?.[p.text]})));
    let skipped=0;
    for(const seq of plans)for(const p of seq){if(!p.key){if(p.lang==='en')throw new Error('这个单词尚无英文音频。');skipped++;}}
    const keys=[...new Set(plans.flat().filter(p=>p.key).map(p=>p.key))];
    const Offline=window.OfflineAudioContext||window.webkitOfflineAudioContext;
    if(!Offline)throw new Error('当前浏览器无法准备整组音频，请更新 Chrome 或 Edge 后重试。');
    const decoder=new Offline(1,1,rate),decoded=new Map();let next=0,done=0;
    await Promise.all(Array.from({length:Math.min(4,keys.length)},async()=>{
      while(next<keys.length){
        signal.throwIfAborted();const key=keys[next++];
        const response=await fetch('./data/audio/'+key.slice(0,2)+'/'+key+'.mp3',{signal:AbortSignal.any([signal,AbortSignal.timeout(30000)])});
        if(!response.ok)throw new Error('有音频未能加载，请联网后重试。');
        const buffer=await decoder.decodeAudioData(await response.arrayBuffer());signal.throwIfAborted();
        const pcm=new Uint8Array(buffer.length*2),view=new DataView(pcm.buffer),channels=Array.from({length:buffer.numberOfChannels},(_,i)=>buffer.getChannelData(i));
        for(let i=0;i<buffer.length;i++){
          let sample=0;for(const channel of channels)sample+=channel[i];sample=Math.max(-1,Math.min(1,sample/channels.length));
          view.setInt16(i*2,Math.round(sample*(sample<0?32768:32767)),true);
        }
        decoded.set(key,pcm);onProgress?.(++done,keys.length);
      }
    }));
    signal.throwIfAborted();
    const parts=[],segments=[],starts=[];let samples=0;
    const append=(pcm,word,label)=>{const from=samples/rate;parts.push(pcm);samples+=pcm.byteLength/2;segments.push({start:from,end:samples/rate,word,label});};
    // Native playbackRate affects the whole resource; compensate silence lengths
    // so the chosen real-time pauses remain the same at every speech speed.
    const between=new Uint8Array(Math.round(rate*.28*speed)*2),wordGap=new Uint8Array(Math.round(rate*gap/1000*speed)*2);
    plans.forEach((seq,i)=>{
      starts.push(samples/rate);
      for(const p of seq){if(!p.key)continue;append(decoded.get(p.key),i,p.label);append(between,i,'稍作停顿');}
      append(wordGap,i,seq.some(p=>!p.key)?'中文暂无音频 · 稍作停顿':'词间停顿');
    });
    if(samples*2>128*1024*1024)throw new Error('这一组音频过长，请先筛选较少的词再播放。');
    return {blob:new Blob([header(samples),...parts],{type:'audio/wav'}),duration:samples/rate,segments,starts,skipped};
  }
  function at(track,time){
    let low=0,high=track.segments.length-1;
    while(low<high){const mid=(low+high+1)>>1;if(track.segments[mid].start<=time+1/rate)low=mid;else high=mid-1;}
    return track.segments[low];
  }
  return {build,at};
})();

const ListPlayer=(()=>{
  const $=selector=>document.querySelector(selector),$$=selector=>[...document.querySelectorAll(selector)];
  let state=null,scrubbing=false;
  const actions=['play','pause','stop','seekto','seekbackward','seekforward','previoustrack','nexttrack'];
  const clock=n=>{n=Math.max(0,Math.floor(n||0));return Math.floor(n/60)+':'+String(n%60).padStart(2,'0');};
  function follow(word,force=false){
    if(!state||document.visibilityState!=='visible'||!$('#player-follow').checked)return;
    const row=$(`[data-word="${state.list[word].id}"]`);
    if(!row)return;
    if(!force&&state.followedRow===row)return;
    state.followedRow=row;
    const box=row.getBoundingClientRect(),bottom=Math.min(innerHeight,$('#player').getBoundingClientRect().top)-12;
    const top=70,center=(top+Math.max(top,bottom))/2;
    window.scrollBy({top:box.top+box.height/2-center,behavior:force||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function position(){
    if(!state?.track)return;
    try{navigator.mediaSession?.setPositionState({duration:state.track.duration,playbackRate:mediaPlayer.playbackRate,position:Math.min(state.track.duration,Math.max(0,mediaPlayer.currentTime))});}catch{}
  }
  function metadata(segment){
    if(!state?.track||!segment)return;
    if(segment.word===state.metadataWord)return;
    state.metadataWord=segment.word;const word=state.list[segment.word];
    try{if('mediaSession' in navigator&&'MediaMetadata' in window)navigator.mediaSession.metadata=new MediaMetadata({title:word.en+' · '+(segment.word+1)+' / '+state.list.length,artist:'听见单词 · 英文三遍 / 中文一遍',album:state.title,artwork:[{src:new URL('./media-cover.png',location.href).href,sizes:'512x512',type:'image/png'}]});}catch{}
  }
  function render(time=mediaPlayer.currentTime,preview=false){
    if(!state?.track)return;
    const s=ListAudio.at(state.track,time);if(!s)return;
    if(!preview){playing.index=s.word;metadata(s);position();if(scrubbing)return;}
    $('#playing-word').textContent=state.list[s.word].en;
    const stage=(preview?'拖动到 · ':'')+s.label;if($('#playing-stage').textContent!==stage)$('#playing-stage').textContent=stage;
    $('#player-position').textContent=`${s.word+1} / ${state.list.length} 词`;
    $('#player-elapsed').textContent=clock(time);
    $('#player-duration').textContent=clock(state.track.duration);
    $('#player-seek').setAttribute('aria-valuetext',`${clock(time)}，第 ${s.word+1} 个词，${state.list[s.word].en}，${s.label}`);
    if(!preview)$('#player-seek').value=String(time);
    $('#player-prev').disabled=s.word===0;$('#player-next').disabled=s.word===state.list.length-1;
    if(!preview){$$('tr.playing').forEach(r=>r.classList.remove('playing'));$(`[data-word="${state.list[s.word].id}"]`)?.classList.add('playing');follow(s.word);}
  }
  function playbackState(){
    if(!state?.track)return;
    paused=mediaPlayer.paused;$('#player-toggle').textContent=paused?'▶':'Ⅱ';$('#player-toggle').setAttribute('aria-label',paused?'继续播放':'暂停');
    try{if(navigator.mediaSession)navigator.mediaSession.playbackState=paused?'paused':'playing';}catch{}
    position();
  }
  async function resume(){
    if(!state?.track)return;const current=state;
    if(mediaPlayer.currentTime>=state.track.duration-.02)mediaPlayer.currentTime=0;
    try{await mediaPlayer.play();}catch{if(state===current){playbackState();$('#playing-stage').textContent='音频已就绪 · 点 ▶ 开始';toast('整组音频已准备好，请点 ▶ 开始播放。');}}
  }
  function seek(time){
    if(!state?.track||!Number.isFinite(time))return;
    scrubbing=false;const target=Math.max(0,Math.min(state.track.duration,time)),word=ListAudio.at(state.track,target).word;
    state.stream?.prioritize(word);Activity.beforeSeek(mediaPlayer);mediaPlayer.currentTime=target;render();follow(word,true);
  }
  function seekWord(offset){
    if(!state?.track)return;const s=ListAudio.at(state.track,mediaPlayer.currentTime);
    seek(state.track.starts[Math.max(0,Math.min(state.list.length-1,s.word+offset))]);
  }
  function controls(){
    if(!navigator.mediaSession)return;
    const handlers={play:resume,pause:()=>mediaPlayer.pause(),stop:()=>stopPlayback(),seekto:e=>seek(e.seekTime),seekbackward:e=>seek(mediaPlayer.currentTime-(e.seekOffset||10)),seekforward:e=>seek(mediaPlayer.currentTime+(e.seekOffset||10)),previoustrack:()=>seekWord(-1),nexttrack:()=>seekWord(1)};
    for(const [action,handler]of Object.entries(handlers))try{navigator.mediaSession.setActionHandler(action,handler);}catch{}
  }
  function stop(){
    if(!state)return;Activity.detach(mediaPlayer);const old=state;state=null;scrubbing=false;old.abort.abort();
    for(const [name,handler]of old.events)mediaPlayer.removeEventListener(name,handler);
    mediaPlayer.pause();mediaPlayer.loop=false;mediaPlayer.removeAttribute('src');mediaPlayer.load();
    if(old.url)URL.revokeObjectURL(old.url);
    document.body.classList.remove('list-following');
    $('#player-toggle').disabled=false;$('#player-seek-wrap').classList.add('hidden');
    try{if(navigator.mediaSession){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';navigator.mediaSession.setPositionState?.();for(const action of actions)try{navigator.mediaSession.setActionHandler(action,null);}catch{}}}catch{}
  }
  async function start(list,options,ticket,startIndex){
    const current={list:[...list],abort:new AbortController(),events:[],track:null,url:null,stream:null,metadataWord:-1,followedRow:null,title:(book?.name||'单词学习')+' · 第 '+(lesson+1)+' 组'};state=current;
    const alive=()=>state===current&&ticket===session;
    document.body.classList.toggle('list-following',$('#player-follow').checked);
    $('#player-buffer-status').textContent='正在连接音频…';
    $('#player-seek-wrap').classList.remove('hidden');$('#player-seek').disabled=true;$('#player-seek').value='0';
    $('#player-elapsed').textContent='准备中';$('#player-duration').textContent='整组音频';
    $('#player-toggle').disabled=true;$('#player-prev').disabled=true;$('#player-next').disabled=true;
    $('#playing-word').textContent='正在连接音频';$('#playing-stage').textContent='先播前面的词，同时加载后面的词';$('#player-position').textContent=list.length+' 词';
    try{
      const index=await loadAudioIndex();if(!alive())return;
      const stream=StreamAudio.supported();
      const settings={signal:current.abort.signal,gap:Number(saved.settings.gap),speed:Number(saved.settings.rate),meaning,onProgress:(n,total)=>{if(alive())$('#playing-stage').textContent=`正在准备音频 ${n} / ${total} · 完成后开始播放`;}};
      const track=await (stream?StreamAudio.plan(list,index,settings):ListAudio.build(list,index,settings));
      if(!alive())return;current.track=track;
      const begin=()=>{
        if(!alive())return;mediaPlayer.playbackRate=Number(saved.settings.rate);mediaPlayer.currentTime=track.starts[Math.max(0,Math.min(list.length-1,startIndex))]||0;
        $('#player-toggle').disabled=false;$('#player-seek').disabled=false;$('#player-seek').max=String(track.duration);
        controls();render();resume();
      };
      const on=(event,handler)=>{mediaPlayer.addEventListener(event,handler);current.events.push([event,handler]);};
      on('timeupdate',()=>render());on('seeked',()=>render());on('play',playbackState);on('pause',playbackState);on('ratechange',position);
      on('ended',()=>{render(track.duration);playbackState();toast('本组播放完成。可拖动进度重听，或点 ▶ 再听一遍。');});
      on('error',()=>{if(alive()){stopPlayback();toast('整组音频播放失败，请重新点“播放本组”。');}});
      on('waiting',()=>{if(alive()&&!mediaPlayer.paused)$('#playing-stage').textContent='正在缓冲这一段…';});
      if(stream){
        current.stream=await StreamAudio.connect(track,{signal:current.abort.signal,startIndex,onReady:begin,onProgress:(n,total)=>{if(alive())$('#player-buffer-status').textContent=n===total?'本组已全部缓存 · 可安心切到后台':'已缓存 '+n+' / '+total+' 词 · 正在继续加载';},onError:error=>{if(alive()){stopPlayback();toast(error.name==='TimeoutError'?'网络较慢，请重新播放；已缓存的录音会保留。':error.message);}}});
        current.url=current.stream.url;
      }else{current.url=URL.createObjectURL(track.blob);on('loadedmetadata',begin);$('#player-buffer-status').textContent='本组音频已准备完成';}
      if(!alive()){if(current.url)URL.revokeObjectURL(current.url);return;}
      activeAudio=mediaPlayer;mediaPlayer.loop=!!options.loop;mediaPlayer.src=current.url;Activity.attach(mediaPlayer,{segments:track.segments.filter(s=>s.label.startsWith('英文')).map(s=>({start:s.start,end:s.end,visit:s.word,word:{...list[s.word],zh:meaning(list[s.word]),book:book.name}}))});mediaPlayer.playbackRate=Number(saved.settings.rate);mediaPlayer.load();
      if(track.skipped)toast(`${track.skipped} 条中文暂无内置音频，已保留英文播放。`);
    }catch(error){if(alive()){stopPlayback();toast(error.name==='AbortError'||error.name==='TimeoutError'?'音频准备超时，请联网后重试。':error instanceof TypeError?'音频准备失败，请检查网络后重试。':error.message);}}
  }
  $('#player-seek').oninput=e=>{if(state?.track){scrubbing=true;render(Number(e.target.value),true);}};
  $('#player-seek').onchange=e=>seek(Number(e.target.value));
  $('#player-seek').onblur=()=>{if(scrubbing){scrubbing=false;render();}};
  $('#player-follow').onchange=()=>{document.body.classList.toggle('list-following',!!state&&$('#player-follow').checked);if(state?.track)follow(ListAudio.at(state.track,mediaPlayer.currentTime).word,true);};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){if(state)state.followedRow=null;render();playbackState();}});
  return {start,stop,seekWord,seek,get active(){return !!state;},get track(){return state?.track;},toggle:()=>{if(state?.track){if(mediaPlayer.paused)resume();else mediaPlayer.pause();}}};
})();
