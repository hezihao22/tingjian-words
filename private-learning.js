'use strict';
const PrivateLearning=(()=>{
  const $=s=>document.querySelector(s),$$=s=>[...document.querySelectorAll(s)];
  const repoName='hezihao22/tingjian-progress';
  let authorized=false,pack=null,loading=null,epoch=0,controller=new AbortController(),selection={reading:0,interview:0};
  let audio=null,playTicket=0,playContext=null,followed=null,recorder=null,recordStream=null,recordURL=null,recordTimer=null,recordPending=false,recordEpoch=0;
  const urls=new Map(),answers=new Map();let urlBytes=0;
  const eligible=()=>Auth.unlocked&&Profiles.canSync&&Profiles.current().name==='何子豪';
  const busy=()=>recordPending||!!recorder||!!audio&&!audio.paused;
  const escape=s=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  const mark=(id,field)=>{const r=record({id});updateRecord({id},{[field]:r[field]!==true});};
  function stopRecording(discard=false){
    recordEpoch++;recordPending=false;clearTimeout(recordTimer);
    if(recorder){if(discard)recorder.onstop=null;if(recorder.state!=='inactive')recorder.stop();recorder=null;}
    recordStream?.getTracks().forEach(t=>t.stop());recordStream=null;
    if($('#record-start'))$('#record-start').disabled=false;if($('#record-stop'))$('#record-stop').disabled=true;
    if(discard&&recordURL){URL.revokeObjectURL(recordURL);recordURL=null;}
  }
  function stop(){
    const owned=!!playContext||!$('#practice-player').classList.contains('hidden');
    Activity.detach(audio);playTicket++;audio?.pause();audio?.removeAttribute('src');audio?.load();playContext=null;followed=null;
    $('#practice-player')?.classList.add('hidden');$$('.practice-current').forEach(e=>e.classList.remove('practice-current'));
    stopRecording();$('#record-replay')?.pause();
    try{if(owned&&navigator.mediaSession){navigator.mediaSession.metadata=null;navigator.mediaSession.playbackState='none';navigator.mediaSession.setPositionState?.();for(const a of ['play','pause','stop','seekto','seekbackward','seekforward','previoustrack','nexttrack'])try{navigator.mediaSession.setActionHandler(a,null);}catch{}}}catch{}
  }
  function clear(){
    epoch++;controller.abort();controller=new AbortController();stop();stopRecording(true);authorized=false;pack=null;loading=null;answers.clear();
    for(const x of urls.values())URL.revokeObjectURL(x.url);urls.clear();urlBytes=0;
    document.body.classList.remove('owner-access');$('#nav-reading')?.classList.add('hidden');$('#nav-interview')?.classList.add('hidden');
    if(typeof view!=='undefined'&&['reading','interview','professional'].includes(view)&&book)changeView('study');
  }
  async function request(path){
    if(!authorized||!eligible()||!syncAuth||syncAuth.repo!==repoName)throw new Error('请先登录何子豪，并绑定自己的私有进度仓库。');
    const current=epoch;
    const response=await githubRequest('/repos/'+repoName+'/contents/learning/'+path,{headers:{Accept:'application/vnd.github.raw+json'},signal:controller.signal});
    if(current!==epoch)throw new DOMException('Cancelled','AbortError');
    if(!response.ok)throw new Error(response.status===404?'学习材料暂未就绪，请稍后重新打开。':'专属内容读取失败，请检查网络和 GitHub 绑定。');
    return response;
  }
  async function load(){
    if(pack)return pack;
    if(loading)return loading;
    const current=epoch;
    const pending=request('data.json').then(r=>r.json()).then(data=>{
      if(current!==epoch)throw new DOMException('Cancelled','AbortError');
      if(data.version!==1||data.audioFolder!=='audio-neural'||!Array.isArray(data.words)||!Array.isArray(data.readings)||!Array.isArray(data.interviews))throw new Error('学习材料格式不正确。');
      pack=data;return data;
    }).finally(()=>{if(loading===pending)loading=null;});loading=pending;return pending;
  }
  function authorize(repo){
    if(!eligible()||(repo.full_name||repo.repository_full_name)!==repoName||!(repo.private===true||repo.visibility==='private')){clear();return;}
    authorized=true;document.body.classList.add('owner-access');$('#nav-reading').classList.remove('hidden');$('#nav-interview').classList.remove('hidden');
    if(book&&!playing&&!quiz&&!busy()&&['study','review'].includes(view))render();
  }
  async function refreshAccess(){
    if(!eligible()||typeof syncAuth==='undefined'||!syncAuth||syncAuth.repo!==repoName){clear();return;}
    try{authorize(await verifySyncRepo());}catch{clear();}
  }
  function go(next){if(!authorized)return;changeView(next);}
  function centerRow(element,force=false){
    if(!element||document.visibilityState!=='visible'||!$('#practice-follow').checked)return;
    if(!force&&element===followed)return;followed=element;
    const rect=element.getBoundingClientRect(),bottom=Math.min(innerHeight,$('#practice-player').getBoundingClientRect().top)-12;
    window.scrollBy({top:rect.top+rect.height/2-(65+bottom)/2,behavior:force||matchMedia('(prefers-reduced-motion: reduce)').matches?'instant':'smooth'});
  }
  function currentPart(){
    if(!playContext?.starts)return -1;let index=0;
    for(let i=1;i<playContext.starts.length;i++)if(audio.currentTime+1e-5>=playContext.starts[i])index=i;
    return index;
  }
  function updateAudio(){
    if(!playContext)return;
    const i=currentPart(),item=playContext.elements?.[i];
    if(item){$$('.practice-current').forEach(e=>e.classList.remove('practice-current'));const row=$(item);row?.classList.add('practice-current');centerRow(row);}
    $('#practice-now').textContent=playContext.labels?.[i]||playContext.title;
    try{if(navigator.mediaSession){navigator.mediaSession.playbackState=audio.paused?'paused':'playing';if(Number.isFinite(audio.duration)&&audio.duration>0)navigator.mediaSession.setPositionState({duration:audio.duration,playbackRate:audio.playbackRate,position:Math.min(audio.duration,audio.currentTime)});}}catch{}
  }
  async function fileURL(name){
    if(!/^[a-z0-9-]+\.mp3$/.test(name))throw new Error('音频路径不正确。');
    if(urls.has(name))return urls.get(name).url;
    const current=epoch,response=await request('audio-neural/'+name),bytes=await response.arrayBuffer();
    if(current!==epoch)throw new DOMException('Cancelled','AbortError');
    const url=URL.createObjectURL(new Blob([bytes],{type:'audio/mpeg'}));
    if(urls.has(name)){URL.revokeObjectURL(url);return urls.get(name).url;}
    urls.set(name,{url,size:bytes.byteLength});urlBytes+=bytes.byteLength;
    // Keep private recordings only in memory and revoke them at logout.
    for(const [key,value]of urls){if(urlBytes<=40*1024*1024)break;if(value.url===audio.src||key===name)continue;URL.revokeObjectURL(value.url);urlBytes-=value.size;urls.delete(key);}
    return url;
  }
  function mediaControls(title){
    try{
      if(!navigator.mediaSession)return;
      navigator.mediaSession.metadata=new MediaMetadata({title,artist:'听见单词 · 专属英语练习',artwork:[{src:new URL('./media-cover.png',location.href).href,sizes:'512x512',type:'image/png'}]});
      const seek=seconds=>{Activity.beforeSeek(audio);audio.currentTime=Math.max(0,Math.min(audio.duration||0,seconds));followed=null;updateAudio();};
      const handlers={play:()=>audio.play().catch(()=>toast('请点播放器继续播放。')),pause:()=>audio.pause(),stop:()=>stop(),seekto:e=>seek(e.seekTime),seekbackward:e=>seek(audio.currentTime-(e.seekOffset||10)),seekforward:e=>seek(audio.currentTime+(e.seekOffset||10)),previoustrack:()=>seek(playContext?.starts?.[Math.max(0,currentPart()-1)]||0),nexttrack:()=>seek(playContext?.starts?.[Math.min((playContext?.starts?.length||1)-1,currentPart()+1)]||0)};
      for(const [name,handler]of Object.entries(handlers))try{navigator.mediaSession.setActionHandler(name,handler);}catch{}
    }catch{}
  }
  async function play(name,title,options={}){
    stopPlayback();const ticket=++playTicket,current=epoch;
    $('#practice-player').classList.remove('hidden');$('#practice-now').textContent='正在读取录音…';$('#practice-hint').textContent='首次需要从私有仓库读取，之后本次打开可重复听';
    try{
      const url=await fileURL(name);if(ticket!==playTicket||current!==epoch)return;
      playContext={title,...options};audio.src=url;audio.loop=$('#practice-loop').checked;audio.playbackRate=Number($('#practice-rate').value);
      audio.onloadedmetadata=()=>{if(ticket===playTicket){if(options.start)audio.currentTime=options.start;updateAudio();}};
      if(options.activity){const a=options.activity;Activity.attach(audio,{kind:a.kind||'word',word:a.word||null,segments:a.segments||[]});}
      mediaControls(title);await audio.play();if(ticket!==playTicket)return;
      $('#practice-now').textContent=title;$('#practice-hint').textContent='神经网络合成语音 · 可拖动、循环、调速';updateAudio();
    }catch(error){if(ticket===playTicket){$('#practice-hint').textContent=error.name==='AbortError'?'播放已取消':error.message||'读取失败，请重试。';}}
  }
  const wordRows=list=>list.map((w,i)=>`<article class="term-card" id="term-${escape(w.id)}"><span class="term-number">${i+1}</span><div><button class="term-title" data-word-audio="${escape(w.id)}">${escape(w.en)} ♪</button><p>${escape(w.zh)}</p><p class="example-en">${escape(w.example)}</p><p class="example-zh">${escape(w.translation)}</p><div class="row"><button class="text-btn" data-example-audio="${escape(w.id)}">听例句</button><button class="status-btn ${record(w).listen?'known':''}" data-term-known="${escape(w.id)}">${record(w).listen?'✓ 已听懂':'标记听懂'}</button><button class="text-btn" data-term-star="${escape(w.id)}">${record(w).star?'★ 已收藏':'☆ 加入复习'}</button></div></div></article>`).join('');
  async function renderPage(next){
    stopRecording(true);
    const current=epoch;$('#main').innerHTML='<div class="loading">正在读取你的专属学习材料…</div>';
    try{await load();if(!authorized||current!==epoch||view!==next)return;
      if(next==='professional'){renderWords();return;}
      const kind=next==='reading'?'reading':'interview',lessons=kind==='reading'?pack.readings:pack.interviews;
      selection[kind]=Math.min(selection[kind],lessons.length-1);const lesson=lessons[selection[kind]];
      $('#main').innerHTML=`<section class="practice-heading"><div class="eyebrow">${kind==='reading'?'LISTEN · READ · UNDERSTAND':'LISTEN · REPEAT · SPEAK'}</div><h1>${kind==='reading'?'专业短听短读':'面试问答'}</h1><p>${kind==='reading'?'先不看原文听一遍，再对照阅读，最后重听和回答两道题。':'先整篇听，再逐段循环跟读，最后用自己的话回答。'}</p></section><div class="lesson-menu"><label>选择${kind==='reading'?'短文':'问题'}<select id="practice-select">${lessons.map((l,i)=>`<option value="${i}" ${i===selection[kind]?'selected':''}>${escape(l.title)}${record({id:l.id})[kind==='reading'?'listen':'read']?' ✓':''}</option>`).join('')}</select></label><button class="btn secondary" id="practice-next">下一${kind==='reading'?'篇':'题'} →</button></div><section class="practice-paper"><h2>${escape(lesson.question)}</h2><div class="practice-actions"><button id="practice-whole" class="btn primary">▶ ${kind==='reading'?'听整篇':'听完整回答'}</button><button id="practice-question" class="btn secondary">听题目</button><label><input id="practice-hide-en" type="checkbox"> 隐藏英文</label><label><input id="practice-hide-zh" type="checkbox" ${kind==='reading'?'checked':''}> 隐藏中文</label></div><div class="paragraphs">${lesson.parts.map((p,i)=>`<article class="practice-paragraph" id="paragraph-${i}"><div class="paragraph-head"><span>第 ${i+1} 段</span><button class="text-btn" data-part="${i}">▶ 听这一段</button></div><p class="paragraph-en">${escape(p.en)}</p><p class="paragraph-zh ${kind==='reading'?'hidden':''}">${escape(p.zh)}</p></article>`).join('')}</div>${lesson.note?`<details class="practice-note"><summary>范本使用提示</summary><p>${escape(lesson.note)}</p></details>`:''}<div id="practice-exercises"></div>${kind==='interview'?`<section class="record-box"><h3>轮到我说</h3><p>模仿一段，或自己回答。录音只在本次页面中回听，不上传 GitHub；换页前可下载保存。</p><div class="row"><button id="record-start" class="btn secondary">● 开始录音</button><button id="record-stop" class="btn secondary" disabled>■ 停止</button><a id="record-download" class="text-btn hidden" download="英语练习.webm">下载录音</a></div><p id="record-message" role="status"></p><audio id="record-replay" controls class="hidden"></audio></section>`:''}<button id="practice-complete" class="btn soft">${record({id:lesson.id})[kind==='reading'?'listen':'read']?'✓ 已'+(kind==='reading'?'听懂':'练习'):'标记已'+(kind==='reading'?'听懂':'练习')}</button><p class="practice-source">${kind==='reading'?'原创英语练习材料':'按本人简历编写的面试练习范本'} · 非招聘真题 · 神经网络合成录音</p></section>`;
      $('#practice-select').onchange=e=>{stopPlayback();selection[kind]=Number(e.target.value);renderPage(next);};
      $('#practice-next').onclick=()=>{stopPlayback();selection[kind]=(selection[kind]+1)%lessons.length;renderPage(next);window.scrollTo(0,0);};
      $('#practice-hide-en').onchange=e=>$$('.paragraph-en').forEach(p=>p.classList.toggle('hidden',e.target.checked));$('#practice-hide-zh').onchange=e=>$$('.paragraph-zh').forEach(p=>p.classList.toggle('hidden',e.target.checked));
      $('#practice-whole').onclick=()=>play(lesson.audio,lesson.title,{starts:lesson.parts.map(p=>p.start),elements:lesson.parts.map((_,i)=>'#paragraph-'+i),labels:lesson.parts.map((_,i)=>lesson.title+' · 第 '+(i+1)+' 段')});
      $('#practice-question').onclick=()=>play(lesson.questionAudio,lesson.question);
      $$('[data-part]').forEach(button=>button.onclick=()=>{const i=Number(button.dataset.part);play(lesson.parts[i].audio,lesson.title+' · 第 '+(i+1)+' 段',{starts:[0],elements:['#paragraph-'+i]});});
      $('#practice-complete').onclick=()=>{mark(lesson.id,kind==='reading'?'listen':'read');$('#practice-complete').textContent=record({id:lesson.id})[kind==='reading'?'listen':'read']?'✓ 已'+(kind==='reading'?'听懂':'练习'):'标记已'+(kind==='reading'?'听懂':'练习');};
      if(kind==='reading')renderExercises(lesson);else{$('#record-start').onclick=startRecording;$('#record-stop').onclick=()=>stopRecording();$('#record-replay').onplay=()=>audio.pause();}
    }catch(error){if(current!==epoch||view!==next)return;$('#main').innerHTML=`<div class="empty"><h2>暂时无法打开专属内容</h2><p>${escape(error.message)}</p><button id="private-retry" class="btn primary">重新读取</button></div>`;$('#private-retry').onclick=()=>renderPage(next);}
  }
  function termSegments(w,offset,visit){const gap=Math.round(.3/(576/24000))*(576/24000),length=(w.duration-2*gap)/3;return [0,1,2].map(i=>({start:offset+i*(length+gap),end:offset+i*(length+gap)+length,visit,word:{...w,book:'专业词组'}}));}
  function renderWords(){
    $('#main').innerHTML=`<section class="practice-heading"><div class="eyebrow">PUBLIC ADMINISTRATION · POLICY</div><h1>专业词组</h1><p>50 个常用词组，把专业释义放回句子里听。</p></section><div class="practice-actions"><button id="professional-all" class="btn primary">▶ 听本组 · EN ×3 + 中 ×1</button><button id="professional-back" class="btn secondary">返回原词书</button><label><input id="professional-review" type="checkbox"> 只看待复习</label></div><section id="term-list">${wordRows(pack.words)}</section>`;
    $('#professional-all').onclick=()=>{if($('#professional-review').checked){$('#professional-review').checked=false;$('#term-list').innerHTML=wordRows(pack.words);bind();}play(pack.wordAudio.audio,'专业词组 · 50 词',{activity:{segments:pack.words.flatMap((w,i)=>termSegments(w,pack.wordAudio.starts[i],i))},starts:pack.wordAudio.starts,elements:pack.words.map(w=>'#term-'+w.id),labels:pack.words.map((w,i)=>(i+1)+' / 50 · '+w.en)});};
    $('#professional-back').onclick=()=>changeView('study');
    const bind=()=>{
      $$('[data-word-audio]').forEach(b=>b.onclick=()=>{const w=pack.words.find(w=>w.id===b.dataset.wordAudio);play(w.audio,w.en+' · 英文三遍',{activity:{segments:termSegments(w,0,0)},starts:[0],elements:['#term-'+w.id]});});
      $$('[data-example-audio]').forEach(b=>b.onclick=()=>{const w=pack.words.find(w=>w.id===b.dataset.exampleAudio);play(w.exampleAudio,w.en+' · 例句',{activity:{kind:'example',word:{...w,book:'专业词组'}},starts:[0],elements:['#term-'+w.id]});});
      $$('[data-term-known]').forEach(b=>b.onclick=()=>{mark(b.dataset.termKnown,'listen');b.textContent=record({id:b.dataset.termKnown}).listen?'✓ 已听懂':'标记听懂';b.classList.toggle('known',!!record({id:b.dataset.termKnown}).listen);});
      $$('[data-term-star]').forEach(b=>b.onclick=()=>{mark(b.dataset.termStar,'star');b.textContent=record({id:b.dataset.termStar}).star?'★ 已收藏':'☆ 加入复习';});
    };bind();$('#professional-review').onchange=e=>{stopPlayback();$('#term-list').innerHTML=wordRows(e.target.checked?pack.words.filter(w=>record(w).listen!==true||record(w).star):pack.words);bind();};
  }
  function renderExercises(lesson){
    $('#practice-exercises').innerHTML='<h3>听懂了吗？</h3>'+lesson.questions.map((q,i)=>`<fieldset class="reading-question"><legend>${i+1}. ${escape(q.question)}</legend>${q.options.map((o,j)=>`<button class="choice reading-choice" data-q="${i}" data-a="${j}">${escape(o)}</button>`).join('')}<p id="q-feedback-${i}" role="status"></p></fieldset>`).join('')+'<details class="practice-note"><summary>顺手练一练笔试表达</summary><p>用三句英文概括本文：问题是什么？主要解释是什么？对政策研究有什么启发？也可以选择一句译成中文，再对照原文。</p></details>';
    $$('[data-q]').forEach(b=>b.onclick=()=>{const i=Number(b.dataset.q),a=Number(b.dataset.a),q=lesson.questions[i];answers.set(lesson.id+':'+i,a);$$(`[data-q="${i}"]`).forEach(x=>{x.classList.toggle('correct',Number(x.dataset.a)===q.answer);x.classList.toggle('wrong',x===b&&a!==q.answer);});$('#q-feedback-'+i).textContent=(a===q.answer?'✓ 答对了。':'再听一遍。')+q.explanation;});
  }
  async function startRecording(){
    if(recordPending||recorder)return;audio.pause();$('#record-replay').pause();
    if(!navigator.mediaDevices?.getUserMedia||!window.MediaRecorder){$('#record-message').textContent='此浏览器暂不支持录音，请用手机 Edge / Chrome，或使用系统录音应用。';return;}
    const ticket=++recordEpoch;recordPending=true;$('#record-start').disabled=true;$('#record-message').textContent='请允许麦克风权限…';
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:true});
      if(ticket!==recordEpoch||!authorized||view!=='interview'){stream.getTracks().forEach(t=>t.stop());return;}
      recordPending=false;recordStream=stream;
      const mime=['audio/webm;codecs=opus','audio/mp4','audio/webm'].find(t=>MediaRecorder.isTypeSupported(t));
      const r=new MediaRecorder(stream,mime?{mimeType:mime}:undefined),chunks=[],replay=$('#record-replay');recorder=r;
      r.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
      r.onstop=()=>{if(!authorized||!document.contains(replay))return;if(recordURL)URL.revokeObjectURL(recordURL);recordURL=URL.createObjectURL(new Blob(chunks,{type:r.mimeType}));replay.src=recordURL;replay.classList.remove('hidden');$('#record-download').href=recordURL;$('#record-download').download='英语练习.'+(r.mimeType.includes('mp4')?'m4a':'webm');$('#record-download').classList.remove('hidden');$('#record-message').textContent='录音已就绪，可回听或下载。';};
      r.onerror=()=>{stopRecording(true);if($('#record-message'))$('#record-message').textContent='录音未完成，请检查麦克风后重试。';};
      r.start();$('#record-stop').disabled=false;$('#record-message').textContent='正在录音 · 最长 3 分钟，完成后点停止';recordTimer=setTimeout(()=>stopRecording(),180000);
    }catch(error){if(ticket===recordEpoch){stopRecording(true);$('#record-message').textContent=error.name==='NotAllowedError'?'没有获得麦克风权限，可在浏览器中允许后重试。':'无法启动麦克风，请检查设备后重试。';}}
  }
  audio=$('#practice-audio');audio.ontimeupdate=updateAudio;audio.onplay=()=>{if(recorder||recordPending)stopRecording();$('#record-replay')?.pause();updateAudio();};audio.onpause=updateAudio;audio.onseeked=()=>{followed=null;updateAudio();};
  audio.onerror=()=>{if(playContext)$('#practice-hint').textContent='音频播放失败，请再次点击对应段落。';};
  $('#practice-close').onclick=stop;$('#practice-loop').onchange=e=>audio.loop=e.target.checked;$('#practice-rate').onchange=e=>{audio.playbackRate=Number(e.target.value);updateAudio();};$('#practice-follow').onchange=()=>{followed=null;updateAudio();};
  document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'){followed=null;updateAudio();}});
  window.addEventListener('beforeunload',clear);
  window.addEventListener('tingjian-profile-name',()=>{refreshAccess();});
  return {authorize,refreshAccess,clear,stop,render:renderPage,go,get authorized(){return authorized;},get busy(){return busy();}};
})();
