'use strict';
// Keep the original compressed recordings. MSE owns the continuous audio clock;
// JavaScript fills its buffer ahead, rather than advancing playback with timers.
const StreamAudio=(()=>{
  let timingPromise=null,silencePromise=null,cachePromise=null;
  const memory=new Map();let memoryBytes=0;
  const supported=()=>!!window.MediaSource?.isTypeSupported('audio/mpeg');
  async function checked(url,signal){
    const response=await fetch(url,{signal:signal?AbortSignal.any([signal,AbortSignal.timeout(30000)]):AbortSignal.timeout(30000)});
    if(!response.ok)throw new Error('有音频未能加载，请检查网络后重试。');
    return response;
  }
  function timing(){return timingPromise??=(checked('./data/audio/timing.json?v=7').then(r=>r.json()).catch(e=>{timingPromise=null;throw e;}));}
  function silence(){return silencePromise??=(checked('./data/audio/silence.mp3?v=7').then(r=>r.arrayBuffer()).then(b=>new Uint8Array(b)).catch(e=>{silencePromise=null;throw e;}));}
  function cache(){return cachePromise??=Promise.resolve().then(()=>window.caches?.open('tingjian-recordings-v1')).catch(()=>null);}
  async function recording(key,signal){
    signal.throwIfAborted();
    if(memory.has(key)){const data=memory.get(key);memory.delete(key);memory.set(key,data);return data;}
    const url=new URL('./data/audio/'+key.slice(0,2)+'/'+key+'.mp3',location.href).href;
    const store=await cache();let response=await store?.match(url).catch(()=>null);
    if(!response) {
      response=await checked(url,signal);
      // Caching is best effort; quota/private-mode failures cannot stop playback.
      if(store)store.put(url,response.clone()).catch(()=>{});
    }
    const data=new Uint8Array(await response.arrayBuffer());signal.throwIfAborted();
    if(!memory.has(key)){memory.set(key,data);memoryBytes+=data.length;}
    while(memoryBytes>24*1024*1024){const first=memory.keys().next().value;memoryBytes-=memory.get(first).length;memory.delete(first);}
    return data;
  }
  async function trimCache(){
    try{const store=await cache();if(!store)return;const keys=await store.keys();await Promise.all(keys.slice(0,Math.max(0,keys.length-1500)).map(k=>store.delete(k)));}catch{}
  }
  async function plan(list,index,{meaning,gap,speed}){
    const info=await timing(),frameTime=info.samplesPerFrame/info.sampleRate;
    const segments=[],starts=[],chunks=[];let frames=0,skipped=0;
    const between=Math.round(.28*speed/frameTime),wordGap=Math.round(gap/1000*speed/frameTime);
    list.forEach((word,i)=>{
      const parts=[];starts.push(frames*frameTime);let missing=false;
      const add=(key,count,label)=>{parts.push({key,frames:count});segments.push({start:frames*frameTime,end:(frames+count)*frameTime,word:i,label});frames+=count;};
      for(const p of WordCore.sequence(word,meaning(word),true)){
        const key=index[p.lang]?.[p.text],count=info.frames[key];
        if(!key||!count){if(p.lang==='en')throw new Error('这个单词尚无英文音频。');skipped++;missing=true;continue;}
        add(key,count,p.label);add(null,between,'稍作停顿');
      }
      add(null,wordGap,missing?'中文暂无音频 · 稍作停顿':'词间停顿');
      chunks.push(parts);
    });
    return {duration:frames*frameTime,segments,starts,chunks,skipped,streaming:true};
  }
  async function connect(track,{signal,startIndex,onProgress,onReady,onError}){
    signal.throwIfAborted();
    const source=new MediaSource(),url=URL.createObjectURL(source);
    let buffer=null,queue=Promise.resolve(),priority=startIndex,completed=0,ready=false;
    const pending=new Set(track.chunks.map((_,i)=>i));
    let openedResolve,openedReject;
    const opened=new Promise((resolve,reject)=>{openedResolve=resolve;openedReject=reject;});
    const cancel=()=>openedReject(signal.reason||new DOMException('Cancelled','AbortError'));
    signal.addEventListener('abort',cancel,{once:true});
    source.addEventListener('sourceopen',()=>{try{signal.throwIfAborted();buffer=source.addSourceBuffer('audio/mpeg');buffer.mode='sequence';source.duration=track.duration;openedResolve();}catch(e){openedReject(e);}},{once:true});
    const append=(data,word)=>{
      const task=queue.then(()=>new Promise((resolve,reject)=>{
        signal.throwIfAborted();
        const clean=()=>{buffer.removeEventListener('updateend',done);buffer.removeEventListener('error',fail);signal.removeEventListener('abort',abort);};
        const done=()=>{clean();resolve();},fail=()=>{clean();reject(new Error('音频读取失败，请重新播放。'));},abort=()=>{clean();reject(signal.reason);};
        buffer.addEventListener('updateend',done,{once:true});buffer.addEventListener('error',fail,{once:true});signal.addEventListener('abort',abort,{once:true});
        try{buffer.timestampOffset=track.starts[word];buffer.appendBuffer(data);}catch(e){clean();reject(e);}
      }));
      queue=task.catch(()=>{});return task;
    };
    async function assemble(i,zero){
      const parts=track.chunks[i],keys=[...new Set(parts.filter(p=>p.key).map(p=>p.key))];
      const data=new Map(await Promise.all(keys.map(async key=>[key,await recording(key,signal)])));
      const length=parts.reduce((n,p)=>n+(p.key?data.get(p.key).length:p.frames*zero.length),0);
      const result=new Uint8Array(length);let at=0;
      for(const part of parts){if(part.key){const bytes=data.get(part.key);result.set(bytes,at);at+=bytes.length;}else for(let n=0;n<part.frames;n++){result.set(zero,at);at+=zero.length;}}
      return result;
    }
    function next(){
      for(let n=0;n<track.chunks.length;n++){const i=(priority+n)%track.chunks.length;if(pending.delete(i))return i;}
      return null;
    }
    const pump=(async()=>{
      await opened;const zero=await silence();signal.throwIfAborted();
      await Promise.all(Array.from({length:4},async()=>{
        let i;while((i=next())!==null){
          const bytes=await assemble(i,zero);signal.throwIfAborted();await append(bytes,i);signal.throwIfAborted();
          onProgress(++completed,track.chunks.length);
          if(!ready&&i===startIndex){ready=true;onReady();}
        }
      }));
      signal.throwIfAborted();source.endOfStream();trimCache();
    })().catch(error=>{if(!signal.aborted)onError(error);}).finally(()=>signal.removeEventListener('abort',cancel));
    // The caller attaches this URL only after installing media event handlers.
    return {url,pump,prioritize(word){priority=word;},get completed(){return completed;}};
  }
  function warm(){if(supported())Promise.all([timing(),silence(),loadAudioIndex()]).catch(()=>{});}
  return {supported,plan,connect,warm};
})();
