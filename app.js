'use strict';
const $ = (s, root=document) => root.querySelector(s);
const $$ = (s, root=document) => [...root.querySelectorAll(s)];
const esc = s => String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
const KEY=Profiles.key;
let audioIndex=null,audioIndexRequest=null;
const mediaPlayer=new Audio();
mediaPlayer.preload='auto';
const defaults=()=>({version:1,book:null,bookUpdated:0,lessons:{},lessonUpdated:{},records:{},meanings:{},meaningUpdated:{},settings:{engine:'recorded',rate:.9,gap:1200,voiceEn:'',voiceZh:''}});
let saved=defaults();
let storageOK=true;
try { const raw=JSON.parse(localStorage.getItem(KEY)||'null'); if(raw?.version===1) saved={...saved,...raw,settings:{...saved.settings,...raw.settings}}; } catch { storageOK=false; }
let catalog,book,words=[],groups=[],lesson=0,view='study',tab='table',wordQuery='',hideMeaning=false,quiz=null,bookQuery='',category='',editWord=null;
let bookRequest=0, toastTimer, searchOpen=false;
function toast(message){$('#toast').textContent=message;$('#toast').classList.remove('hidden');clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('#toast').classList.add('hidden'),6500);}
function save(notify=true){try{localStorage.setItem(KEY,JSON.stringify(saved));if(notify)window.dispatchEvent(new Event('tingjian-change'));}catch{toast('浏览器无法保存记录，请使用设置中的“导出学习记录”备份。');}}
const record=w=>saved.records[w.id]||{};
const meaning=w=>saved.meanings[w.id]??w.main;
const review=w=>{const r=record(w);return !!r.star||r.listen===false||r.read===false;};
const mastered=w=>record(w).read===true&&record(w).listen===true;
const current=()=>view==='review'?groups[lesson]||[]:groups[lesson]||[];
const shown=()=>current().filter(w=>!wordQuery||`${w.en} ${meaning(w)} ${w.full}`.toLowerCase().includes(wordQuery.toLowerCase()));
const label=n=>String(n+1).padStart(2,'0');
const categoryLabel=c=>({'大学英语六级词汇':'六级','GRE词汇':'GRE','托福词汇':'托福','考研英语':'考研'}[c]||c);
function updateRecord(w,patch){const r=record(w),now=Date.now(),at={...r._at};for(const k of ['read','listen','star']){if(typeof r[k]==='boolean'&&!at[k])at[k]=r.updated||0;if(k in patch)at[k]=now;}saved.records[w.id]={...r,...patch,_at:at,updated:now};save();updateSidebar();}
function updateSidebar(){
  $('#book-count').textContent=catalog?.books.length||'…';
  $('#review-count').textContent=words.filter(review).length;
  if(book){$('#side-book').textContent=book.name;$('#side-category').textContent=`${categoryLabel(book.category)} · ${book.count.toLocaleString()} 个词`;}
  ['study','books','review'].forEach(v=>$('#nav-'+v).classList.toggle('active',view===v));
}
function rebuildGroups(){groups=WordCore.chunks(view==='review'?words.filter(review):words);lesson=Math.max(0,Math.min(lesson,groups.length-1));}
async function openBook(id,userAction=true){
  const ticket=++bookRequest;
  stopPlayback();quiz=null;view='study';tab='table';wordQuery='';
  $('#main').innerHTML='<div class="loading">正在打开词书…</div>';
  try{
    const r=await fetch('./data/books/'+encodeURIComponent(id)+'.json?v=7');if(!r.ok)throw new Error('词书读取失败');
    const rows=await r.json();if(ticket!==bookRequest)return;
    words=rows.map(w=>({id:w[0],en:w[1],uk:w[2],us:w[3],full:w[4],main:w[5],source:w[6]||'DictionaryData'}));
    book=catalog.books.find(b=>b.id===id);if(userAction&&saved.book!==id)saved.bookUpdated=Date.now();saved.book=id;lesson=saved.lessons[id]||0;rebuildGroups();save();updateSidebar();render();StreamAudio.warm();
  }catch(error){if(ticket===bookRequest){$('#main').innerHTML='<div class="empty"><h2>暂时无法读取词书</h2><p>请检查网络或本地服务，然后重试。你的学习记录仍保留在当前设备。</p><button class="btn primary" id="retry-book">重新读取</button></div>';$('#retry-book').onclick=()=>openBook(id);}}
}
function changeView(next){bookRequest++;stopPlayback();quiz=null;view=next;tab='table';wordQuery='';lesson=next==='study'?(saved.lessons[book.id]||0):0;rebuildGroups();updateSidebar();render();}
function setLesson(next){stopPlayback();quiz=null;lesson=Math.max(0,Math.min(groups.length-1,next));wordQuery='';if(view==='study'){saved.lessons[book.id]=lesson;saved.lessonUpdated??={};saved.lessonUpdated[book.id]=Date.now();save();}render();}
function hero(){return `<div class="hero study-heading"><div><h1>${view==='review'?'待复习的词':'单词学习'}</h1>${view==='review'?'<p>当前词书中未听懂、未看懂或收藏的词</p>':''}</div><div class="hero-actions"><button class="btn secondary" id="quick-quiz">◉ 听音选义</button><button class="btn primary" id="quick-play">▶ 播放本组</button></div></div>`;}
function banner(){const complete=words.filter(mastered).length;return `<section class="book-banner"><div class="book-info"><span class="book-label">词书</span><h2 title="${esc(book.name)}">${esc(book.name)}</h2><button id="inline-change-book" class="text-btn">换书 ↗</button></div><span class="book-progress" title="同时已听懂和已看懂的词数">已掌握 ${complete} / ${words.length.toLocaleString()} 词</span></section>`;}
function lessonNav(){if(!groups.length)return '';return `<div class="lesson-header"><div class="group-picker"><button class="group-step" data-lesson="${lesson-1}" aria-label="上一组" ${lesson===0?'disabled':''}>‹</button><select id="lesson-select" aria-label="选择学习分组">${groups.map((g,i)=>`<option value="${i}" ${i===lesson?'selected':''}>第 ${label(i)} 组 · ${g.length} 词</option>`).join('')}</select><button class="group-step" data-lesson="${lesson+1}" aria-label="下一组" ${lesson>=groups.length-1?'disabled':''}>›</button></div><span class="group-range">${lesson*50+1}–${lesson*50+current().length} 词 <span> / 共 ${groups.length} 组</span></span></div>`;}
function render(){
  updateSidebar();if(view==='books'){renderLibrary();return;}
  if(!book)return;
  $('#main').innerHTML=hero()+banner()+lessonNav()+(!groups.length?`<div class="empty"><h2>这本词书暂时没有待复习的词</h2><p>听选中没听懂的词会自动来到这里，也可以点单词旁的星号收藏。</p><button id="back-study" class="btn primary">返回学习</button></div>`:`<div class="tabs" role="tablist" aria-label="学习方式"><button role="tab" aria-selected="${tab==='table'}" class="tab ${tab==='table'?'active':''}" data-tab="table">单词表 <small>${current().length}</small></button><button role="tab" aria-selected="${tab==='play'}" class="tab ${tab==='play'?'active':''}" data-tab="play">随身听</button><button role="tab" aria-selected="${tab==='quiz'}" class="tab ${tab==='quiz'?'active':''}" data-tab="quiz">听音选义</button></div><section id="tab-content"></section>`);
  $('#quick-play').onclick=()=>startPlayback(current(),{chinese:true,mode:'group'});
  $('#quick-quiz').onclick=()=>{stopPlayback();tab='quiz';quiz=null;render();};
  $('#inline-change-book').onclick=()=>changeView('books');
  if($('#back-study'))$('#back-study').onclick=()=>changeView('study');
  if(!groups.length)return;
  $('#lesson-select').onchange=e=>setLesson(Number(e.target.value));
  $$('[data-lesson]').forEach(b=>b.onclick=()=>setLesson(Number(b.dataset.lesson)));
  $$('[data-tab]').forEach(b=>b.onclick=()=>{stopPlayback();quiz=null;tab=b.dataset.tab;render();});
  renderTab();
}
function renderTab(){if(tab==='table')renderTable();else if(tab==='play')renderPlay();else renderQuiz();}
function renderTable(){
  const target=$('#tab-content');
  target.innerHTML=`<div class="table-toolbar ${searchOpen?'search-open':''}"><div><input type="search" id="word-search" placeholder="查找本组单词或释义" aria-label="查找本组单词或释义" value="${esc(wordQuery)}"><button id="toggle-word-search" class="mobile-search" aria-label="展开或收起单词搜索" aria-expanded="${searchOpen}">⌕</button><label><input id="hide-meaning" type="checkbox" ${hideMeaning?'checked':''}>隐藏释义</label></div><button id="table-play" class="btn soft">▶ 播放${wordQuery?'筛选结果':'本组'} <span>EN ×3 + 中 ×1</span></button></div><div id="word-rows"></div>`;
  $('#toggle-word-search').onclick=()=>{searchOpen=!searchOpen;$('.table-toolbar').classList.toggle('search-open',searchOpen);$('#toggle-word-search').setAttribute('aria-expanded',String(searchOpen));if(searchOpen)$('#word-search').focus();else{wordQuery='';$('#word-search').value='';renderRows();$('#table-play').innerHTML='▶ 播放本组 <span>EN ×3 + 中 ×1</span>';}};
  $('#word-search').oninput=e=>{wordQuery=e.target.value;renderRows();$('#table-play').innerHTML=`▶ 播放${wordQuery?'筛选结果':'本组'} <span>EN ×3 + 中 ×1</span>`;};
  $('#hide-meaning').onchange=e=>{hideMeaning=e.target.checked;renderRows();};
  $('#table-play').onclick=()=>startPlayback(shown(),{chinese:true,mode:'group'});
  renderRows();
}
function renderRows(){
  const list=shown(),missing=current().filter(w=>!meaning(w)).length;
  $('#word-rows').innerHTML=(missing?`<details class="notice"><summary>${missing} 词待补释义</summary><p>仍可听英文；点击 ✎ 补充中文后即可参与听选。中文音频取词库首个义项；新补释义用于显示和听选。</p></details>`:'')+(list.length?`<table class="word-table"><thead><tr><th>#</th><th>单词 · 点击听三遍</th><th>主要释义</th><th>理解状态</th><th>复习</th></tr></thead><tbody>${list.map(w=>{const r=record(w);return `<tr data-word="${esc(w.id)}"><td class="cell-number">${String(lesson*50+current().indexOf(w)+1).padStart(2,'0')}</td><td class="cell-word"><div class="word-line"><button class="word-button" data-speak="${w.id}" title="朗读 ${esc(w.en)} 三遍">${esc(w.en)}</button><button class="speaker" data-speak="${w.id}" aria-label="朗读 ${esc(w.en)} 三遍">♪</button></div><span class="phonetic">${esc(w.us||w.uk||'暂无音标')}</span></td><td class="cell-meaning">${hideMeaning?`<button class="text-btn reveal" data-reveal="${w.id}">点击查看释义</button>`:meaningCell(w)}</td><td class="cell-status"><button class="status-btn ${r.read===true?'known':''}" data-read="${w.id}" title="切换是否看懂">${r.read===true?'✓ 已看懂':r.read===false?'再看一遍':'标记看懂'}</button><span class="listen-status ${r.listen===true?'ok':r.listen===false?'no':''}">${r.listen===true?'◉ 已听懂':r.listen===false?'◉ 待练听力':'◌ 尚未听选'}</span></td><td class="cell-star"><button data-star="${w.id}" class="flag-btn ${r.star?'selected':''}" aria-label="${r.star?'取消收藏':'加入复习'} ${esc(w.en)}" aria-pressed="${!!r.star}">${r.star?'★':'☆'}</button></td></tr>`;}).join('')}</tbody></table>`:'<div class="empty">这一组没有匹配的词，试试其他关键词。</div>')+`<div class="table-bottom"><span>第 ${lesson+1} / ${groups.length} 组 · ${list.length} 个词 <span>｜看懂和听懂分别记录</span></span><div class="row"><button class="btn secondary" id="prev-lesson" ${lesson===0?'disabled':''}>上一组</button><button class="btn secondary" id="next-lesson" ${lesson>=groups.length-1?'disabled':''}>下一组 →</button></div></div>`;
  bindRows();$('#prev-lesson').onclick=()=>setLesson(lesson-1);$('#next-lesson').onclick=()=>setLesson(lesson+1);
}
function meaningCell(w){return `<div class="meaning-main"><span class="${meaning(w)?'':'no-meaning'}">${esc(meaning(w)||'待补释义')}</span><button class="edit" data-edit="${w.id}" aria-label="编辑 ${esc(w.en)} 的主要释义">✎</button></div>${w.full?`<button class="full-meaning" title="完整释义 · ${esc(w.source)}" data-full="${w.id}">${esc(w.full)}</button>`:''}`;}
function bindRows(){
  const get=id=>words.find(w=>w.id===id);
  $$('[data-speak]').forEach(b=>b.onclick=()=>startPlayback([get(b.dataset.speak)],{chinese:false,mode:'single'}));
  $$('[data-read]').forEach(b=>b.onclick=()=>{const w=get(b.dataset.read);updateRecord(w,{read:record(w).read!==true});renderRows();refreshBanner();});
  $$('[data-star]').forEach(b=>b.onclick=()=>{const w=get(b.dataset.star);updateRecord(w,{star:!record(w).star});renderRows();});
  $$('[data-edit]').forEach(b=>b.onclick=()=>editMeaning(get(b.dataset.edit)));
  $$('[data-full]').forEach(b=>b.onclick=()=>b.classList.toggle('expanded'));
  $$('[data-reveal]').forEach(b=>b.onclick=()=>{b.parentElement.innerHTML=meaningCell(get(b.dataset.reveal));bindRows();});
}
function refreshBanner(){const old=$('.book-banner');if(old){old.outerHTML=banner();$('#inline-change-book').onclick=()=>changeView('books');}}
function renderPlay(){const n=current().filter(w=>!meaning(w)).length;$('#tab-content').innerHTML=`<div class="play-panel"><span class="sound-orb">♫</span><div class="eyebrow">A LITTLE LISTENING, EVERY DAY</div><h2>给耳朵一点熟悉的时间。</h2><p>第 ${label(lesson)} 组 · ${current().length} 个词<br>每个词读三遍英文，再读一遍主要中文意思。</p><div class="sequence"><span>英文 × 3</span>→<span>中文 × 1</span>→<span>下一个词</span></div><div class="row" style="justify-content:center;margin-top:25px"><label class="muted"><input type="checkbox" id="shuffle-play"> 随机顺序</label><label class="muted"><input type="checkbox" id="loop-play"> 循环本组</label></div><button id="begin-play" class="btn primary">▶ 开始听这一组</button>${n?`<p style="margin-top:17px">${n} 个词缺少中文释义，将只读英文。</p>`:''}<p style="margin-top:20px">边听边加载，拖动进度可跳听；提示“本组已全部缓存”后，切到后台更稳妥。速度与停顿可在设置中调整。</p></div>`;
  $('#begin-play').onclick=()=>startPlayback($('#shuffle-play').checked?WordCore.shuffle(current()):current(),{chinese:true,mode:'group',loop:$('#loop-play').checked});
}
function renderLibrary(){
  $('#main').innerHTML=`<div class="hero"><div><div class="eyebrow">YOUR NEXT CHAPTER</div><h1>挑一本，开始听。</h1><p>六级、考研、GRE、托福，找到适合你的词书。选中后自动分成每组 50 词。</p></div><span class="tag">${catalog.books.length} 本本地词书</span></div><div class="library-toolbar"><input type="search" id="book-search" placeholder="搜索词书名称、作者或出版社" aria-label="搜索词书" value="${esc(bookQuery)}"><select id="category-select" aria-label="词书类别"><option value="">全部类别</option>${catalog.categories.map(c=>`<option value="${c.id}" ${category===c.id?'selected':''}>${esc(categoryLabel(c.name))}</option>`).join('')}</select></div><div id="book-results"></div>`;
  $('#book-search').oninput=e=>{bookQuery=e.target.value;renderBooks();};$('#category-select').onchange=e=>{category=e.target.value;renderBooks();};renderBooks();
}
function renderBooks(){const found=catalog.books.filter(b=>(!category||b.categoryId===category)&&`${b.name} ${b.author} ${b.publisher}`.toLowerCase().includes(bookQuery.toLowerCase()));
  $('#book-results').innerHTML=`<p class="library-count">找到 ${found.length} 本词书 · 数量按实际去重词条计算 · 缺少释义的词可手动补充</p>`+(found.length?`<div class="book-grid">${found.map(b=>`<button class="book-card" data-book="${b.id}"><span class="book-card-icon">Aa</span><h3>${esc(b.name)}</h3><p>${esc(categoryLabel(b.category))} · ${b.count.toLocaleString()} 词 · ${b.lessons} 组</p><p>${esc(b.author||b.publisher||'DictionaryData')}</p><div class="book-card-bottom"><span>${b.missing?`${b.missing} 词待补释义`:'中文释义齐全'}</span><span>${book?.id===b.id?'继续学习':'选择词书'} ↗</span></div></button>`).join('')}</div>`:'<div class="empty">没有找到这本词书，试试更短的关键词。</div>');
  $$('[data-book]').forEach(b=>b.onclick=()=>openBook(b.dataset.book));
}
function renderQuiz(){
  const eligible=current().filter(w=>meaning(w));const target=$('#tab-content');
  if(!quiz){target.innerHTML=`<div class="play-panel"><span class="sound-orb">◉</span><div class="eyebrow">LISTEN FIRST. UNDERSTAND NEXT.</div><h2>先听声音，再认意思。</h2><p>英文先藏起来。听完读音，选出对应的中文意思。<br>不确定就选“还没听懂”，这一次只是认识它的开始。</p><button id="begin-quiz" class="btn primary" ${eligible.length?'':'disabled'}>开始本组听选 · ${eligible.length} 词</button><p style="margin-top:18px">答错的词自动加入复习 · 不需要输入或拼写${eligible.length<current().length?`<br>${current().length-eligible.length} 个词缺少释义，暂不出题`:''}</p></div>`;
    $('#begin-quiz').onclick=()=>{quiz={queue:WordCore.shuffle(eligible),index:0,correct:0,answered:false,heard:false,choice:null};prepareQuestion();};return;
  }
  if(quiz.index>=quiz.queue.length){target.innerHTML=`<div class="quiz-summary play-panel"><span class="tag">本组听选完成</span><div class="big-number">${quiz.correct}<span style="font-size:26px;color:#abb49a"> / ${quiz.queue.length}</span></div><h2>又有一些声音，熟悉了。</h2><p>本轮选对 ${quiz.correct} 词；${quiz.queue.length-quiz.correct} 词需要再听一遍。<br>听选结果已保存，不熟悉的词已加入复习。</p><div class="row"><button id="quiz-again" class="btn secondary">再练一轮</button><button id="quiz-review" class="btn primary">去复习没听懂的词 →</button></div></div>`;$('#quiz-again').onclick=()=>{quiz=null;renderQuiz();};$('#quiz-review').onclick=()=>changeView('review');return;}
  const w=quiz.queue[quiz.index];
  target.innerHTML=`<div class="quiz-card"><div class="quiz-top"><span>第 ${label(lesson)} 组 · 听音选义</span><span>${quiz.index+1} / ${quiz.queue.length} · 已选对 ${quiz.correct} 词</span></div><button class="sound-orb" id="quiz-speaker" aria-label="再听三遍">♫</button><h2>${quiz.answered?'让声音和意思连起来。':'这个声音，是什么意思？'}</h2><p id="quiz-audio-state">${quiz.answered?'答案已揭晓':quiz.heard?'请选择中文意思，也可以再听三遍':'正在准备读音…'}</p><button id="quiz-replay" class="text-btn quiz-replay">↻ 再听三遍</button><div class="choices">${quiz.options.map((opt,i)=>`<button class="choice ${quiz.answered?(opt===meaning(w)?'correct':opt===quiz.choice?'wrong':''):''}" data-answer="${i}" ${quiz.answered||!quiz.heard?'disabled':''}><span>${String.fromCharCode(65+i)}</span>${esc(opt)}</button>`).join('')}</div>${quiz.answered?`<div class="quiz-feedback"><span class="tag">${quiz.choice===meaning(w)?'✓ 听懂了':'下次，再听懂它'}</span><div><strong>${esc(w.en)}</strong><span class="phonetic">${esc(w.us||w.uk)}</span></div><p>${esc(meaning(w))}</p><button class="btn primary" id="quiz-next">${quiz.index+1===quiz.queue.length?'查看本组结果':'下一个词 →'}</button></div>`:`<button id="quiz-unknown" class="text-btn" ${!quiz.heard?'disabled':''}>还没听懂，看看答案</button>`}</div>`;
  $('#quiz-speaker').onclick=playQuestion;$('#quiz-replay').onclick=playQuestion;
  $$('[data-answer]').forEach(b=>b.onclick=()=>answerQuiz(quiz.options[Number(b.dataset.answer)]));
  if($('#quiz-unknown'))$('#quiz-unknown').onclick=()=>answerQuiz(null);
  if($('#quiz-next'))$('#quiz-next').onclick=()=>{stopPlayback();quiz.index++;quiz.answered=false;quiz.heard=false;quiz.choice=null;prepareQuestion();};
}
function prepareQuestion(){if(quiz.index<quiz.queue.length){const w=quiz.queue[quiz.index];quiz.options=WordCore.choices(w,words,meaning);if(quiz.options.length<2){toast('这本词书可用的不同释义太少，暂时无法生成听选题。');quiz=null;renderQuiz();return;}}renderQuiz();if(quiz&&quiz.index<quiz.queue.length)playQuestion();}
function playQuestion(){if(!quiz||quiz.index>=quiz.queue.length)return;const q=quiz;const index=q.index;startPlayback([q.queue[index]],{chinese:false,mode:'quiz',onHeard:()=>{if(quiz===q&&q.index===index){q.heard=true;if(tab==='quiz')renderQuiz();}}});}
function answerQuiz(choice){if(!quiz||quiz.answered||!quiz.heard)return;stopPlayback();const w=quiz.queue[quiz.index];quiz.answered=true;quiz.choice=choice;const correct=choice===meaning(w);quiz.correct+=correct?1:0;updateRecord(w,{listen:correct});renderQuiz();refreshBanner();}

// One audio owner for the whole app; cancellation invalidates every pending continuation.
let session=0,activeAudio=null,cancelSpeech=null,paused=false,playing=null;
const abortError=()=>new DOMException('Cancelled','AbortError');
function stopPlayback(){session++;ListPlayer.stop();paused=false;if(cancelSpeech){cancelSpeech();cancelSpeech=null;}if(activeAudio){activeAudio.pause();activeAudio=null;}playing=null;$('#player').classList.add('hidden');$$('tr.playing').forEach(r=>r.classList.remove('playing'));}
async function gate(ticket,ms=0){let elapsed=0;while(ticket===session&&(paused||elapsed<ms)){const before=performance.now(),wasPaused=paused;await new Promise(r=>setTimeout(r,60));if(!paused&&!wasPaused)elapsed+=performance.now()-before;}if(ticket!==session)throw abortError();}
async function loadAudioIndex(){if(audioIndex)return audioIndex;return audioIndexRequest??=(fetch('./data/audio/index.json?v=7').then(r=>{if(!r.ok)throw new Error('音频目录暂未加载，请联网后重试。');return r.json();}).then(data=>audioIndex=data).catch(error=>{audioIndexRequest=null;throw error;}));}
async function speak(text,lang,ticket,onHeard){
  await gate(ticket);const index=await loadAudioIndex();await gate(ticket);
  const key=index[lang]?.[text];
  if(!key)throw new Error('这条自定义内容还没有内置音频。词库原有释义可直接播放。');
  return new Promise((resolve,reject)=>{
    const a=mediaPlayer;activeAudio=a;let finished=false,timer;
    const finish=error=>{if(finished)return;finished=true;clearTimeout(timer);a.onended=null;a.onerror=null;a.onplaying=null;a.onwaiting=null;if(activeAudio===a)activeAudio=null;cancelSpeech=null;error?reject(error):resolve();};
    cancelSpeech=()=>{a.pause();finish(abortError());};
    a.onended=()=>finish();a.onerror=()=>finish(new Error('音频加载失败，请检查网络后重试。'));
    a.onplaying=()=>{clearTimeout(timer);if(paused)a.pause();else onHeard?.();};
    a.onwaiting=()=>{clearTimeout(timer);timer=setTimeout(()=>{if(!paused){a.pause();finish(new Error('音频加载超时，请检查网络后重试。'));}},30000);};
    a.src='./data/audio/'+key.slice(0,2)+'/'+key+'.mp3';a.playbackRate=Number(saved.settings.rate);
    timer=setTimeout(()=>{a.pause();finish(new Error('音频加载超时，请联网后重试。'));},30000);
    a.play().then(()=>{if(ticket!==session){a.pause();finish(abortError());return;}if(paused)a.pause();}).catch(()=>finish(new Error('请再次点击播放按钮，让浏览器允许声音播放。')));
  });
}
async function startPlayback(list,options={},start=0){
  stopPlayback();if(!list.length){toast('当前没有可播放的词。');return;}
  const ticket=session;let skipped=0;playing={list:[...list],options,index:start};$('#player').classList.remove('hidden');$('#player-toggle').textContent='Ⅱ';$('#player-toggle').setAttribute('aria-label','暂停');
  $('#player-prev').disabled=list.length<2;$('#player-next').disabled=list.length<2;
  if(options.mode==='group'){await ListPlayer.start(list,options,ticket,start);return;}
  try{
    do{
      for(let i=start;i<list.length;i++){
        await gate(ticket);playing.index=i;const w=list[i];
        $('#playing-word').textContent=options.mode==='quiz'?'听音选义 · 英文已隐藏':w.en;
        $('#player-position').textContent=`${i+1} / ${list.length} 词`;
        $$('tr.playing').forEach(r=>r.classList.remove('playing'));$(`[data-word="${w.id}"]`)?.classList.add('playing');
        const seq=WordCore.sequence(w,meaning(w),options.chinese!==false);
        for(const part of seq){await gate(ticket);if(part.lang==='zh'&&!(await loadAudioIndex()).zh[part.text]){skipped++;$('#playing-stage').textContent='自定义释义暂无音频，已跳过中文';continue;}$('#playing-stage').textContent=part.label;await speak(part.text,part.lang,ticket,options.onHeard);await gate(ticket,280);}
        if(options.chinese!==false&&!meaning(w))$('#playing-stage').textContent='缺少释义，已跳过中文';
        await gate(ticket,Number(saved.settings.gap));
      }
      start=0;
    }while(options.loop&&ticket===session);
    if(ticket===session){stopPlayback();if(options.mode==='group')toast(skipped?`这一组播放完成，${skipped} 条自定义释义暂无音频，已跳过中文。`:'这一组播放完成。可以再听一遍，或试试听音选义。');}
  }catch(error){if(ticket===session){stopPlayback();if(error.name!=='AbortError'){toast(error.message);if(options.mode==='quiz'&&$('#quiz-audio-state'))$('#quiz-audio-state').textContent='播放未成功，请点击“再听三遍”重试，或在设置中更换语音。';}}}
}
$('#player-toggle').onclick=()=>{if(ListPlayer.active){ListPlayer.toggle();return;}if(!playing)return;paused=!paused;$('#player-toggle').textContent=paused?'▶':'Ⅱ';$('#player-toggle').setAttribute('aria-label',paused?'继续':'暂停');if(activeAudio){if(paused)activeAudio.pause();else activeAudio.play().catch(()=>{stopPlayback();toast('恢复播放失败，请重新开始。');});}};
$('#player-prev').onclick=()=>{if(ListPlayer.active){ListPlayer.seekWord(-1);return;}if(playing){const p=playing;startPlayback(p.list,p.options,Math.max(0,p.index-1));}};
$('#player-next').onclick=()=>{if(ListPlayer.active){ListPlayer.seekWord(1);return;}if(playing){const p=playing;if(p.index+1>=p.list.length){stopPlayback();return;}startPlayback(p.list,p.options,p.index+1);}};
$('#player-stop').onclick=stopPlayback;
function editMeaning(w){stopPlayback();editWord=w;$('#meaning-title').textContent=w.en+' · 主要释义';$('#meaning-source').textContent='完整释义（'+w.source+'）：'+(w.full||'词库未提供');$('#meaning-input').value=meaning(w);$('#meaning-dialog').showModal();}
$('#close-meaning').onclick=()=>$('#meaning-dialog').close();
$('#meaning-form').onsubmit=e=>{e.preventDefault();const text=$('#meaning-input').value.trim();if(!/[\u4e00-\u9fff]/.test(text)){toast('请输入包含中文的简短释义。');return;}saved.meanings[editWord.id]=text;saved.meaningUpdated??={};saved.meaningUpdated[editWord.id]=Date.now();save();$('#meaning-dialog').close();renderRows();toast(audioIndex?.zh[text]?'已保存，显示、听选和中文朗读将使用这条释义。':'已保存，用于显示和听选。这条自定义释义尚无内置音频，播放时将跳过中文。');};
$('#reset-meaning').onclick=()=>{delete saved.meanings[editWord.id];saved.meaningUpdated??={};saved.meaningUpdated[editWord.id]=Date.now();save();$('#meaning-dialog').close();renderRows();};
$('#nav-study').onclick=()=>book&&changeView('study');$('#nav-books').onclick=()=>catalog&&changeView('books');$('#nav-review').onclick=()=>book&&changeView('review');$('#change-book').onclick=()=>changeView('books');
$('#settings-btn').onclick=()=>{stopPlayback();$('#speech-rate').value=saved.settings.rate;$('#speech-gap').value=saved.settings.gap;$('#settings-dialog').showModal();};
$('#mobile-settings').onclick=()=>$('#settings-btn').click();
for(const [id,key]of [['speech-rate','rate'],['speech-gap','gap']])$('#'+id).onchange=e=>{stopPlayback();saved.settings[key]=Number(e.target.value);save();};
$('#test-en').onclick=()=>startPlayback([{id:'test-en',en:'Hello. A little listening, every day.',main:''}],{chinese:false,mode:'single'});
$('#test-zh').onclick=async()=>{stopPlayback();const ticket=session;try{await speak('每天一小组，慢慢听得懂。','zh',ticket);toast('中文试听完成。');}catch(e){if(e.name!=='AbortError')toast(e.message);}};
$('#settings-dialog').addEventListener('close',stopPlayback);
$('#export-data').onclick=()=>{const url=URL.createObjectURL(new Blob([JSON.stringify(saved,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download='听见单词-'+Profiles.current().name.replace(/[\\/:*?"<>|]/g,'_')+'-学习记录-'+new Date().toISOString().slice(0,10)+'.json';a.click();setTimeout(()=>URL.revokeObjectURL(url),500);};
$('#import-data').onclick=()=>$('#import-file').click();
function validateBackup(raw){
  const clean={...defaults(),...ProgressCore.clean(raw)};
  if(!catalog.books.some(b=>b.id===clean.book))clean.book=null;
  const s=raw.settings||{};if([.75,.9,1,1.15].includes(s.rate))clean.settings.rate=s.rate;if([500,1200,2000,3000].includes(s.gap))clean.settings.gap=s.gap;
  return clean;
}
$('#import-file').onchange=async e=>{const file=e.target.files[0];if(!file)return;try{if(file.size>10000000)throw new Error('记录文件过大。');const clean=validateBackup(JSON.parse(await file.text()));if(!confirm('恢复记录将替换当前用户的学习记录和自定义释义，不影响其他用户。确认恢复吗？'))return;stopPlayback();saved=clean;save();$('#settings-dialog').close();await openBook(saved.book||book.id);toast('学习记录已恢复。');}catch(error){toast('恢复失败：'+error.message);}finally{e.target.value='';}};
window.addEventListener('beforeunload',stopPlayback);
document.addEventListener('keydown',e=>{if(e.code==='Space'&&playing&&!['INPUT','TEXTAREA','SELECT','BUTTON'].includes(document.activeElement.tagName)){e.preventDefault();$('#player-toggle').click();}});
async function init(){try{
  saved.settings.engine='recorded';
  const r=await fetch('./data/catalog.json?v=7');if(!r.ok)throw new Error();catalog=await r.json();const preferred=catalog.books.find(b=>b.name.includes('六级')&&b.name.includes('正序'))||catalog.books.find(b=>b.category==='大学英语六级词汇')||catalog.books[0];await openBook(catalog.books.some(b=>b.id===saved.book)?saved.book:preferred.id,false);window.dispatchEvent(new Event('tingjian-ready'));loadAudioIndex().catch(()=>{});if(!storageOK)toast('未能读取上次记录，已打开默认词书。');
}catch{ $('#main').innerHTML='<div class="empty"><h2>暂时无法打开词库</h2><p>请检查网络后刷新。使用本地版本时，请先双击 start.bat。</p><button class="btn primary" id="retry-init">重新加载</button></div>';$('#retry-init').onclick=init;}}
init();
