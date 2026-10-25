'use strict';
// This module never includes authorization in progress JSON or error messages.
const SYNC_CONFIG='tingjian-github-config',SYNC_SECRET='tingjian-github-auth';
let syncAuth=null,syncBusy=false,syncTimer=null,syncReady=false,syncAgain=false;
const syncStatus=text=>{$('#sync-status').textContent=text;};
function encodeProgress(text){return btoa(Array.from(new TextEncoder().encode(text),c=>String.fromCharCode(c)).join(''));}
function decodeProgress(text){return new TextDecoder('utf-8',{fatal:true}).decode(Uint8Array.from(atob(text.replace(/\s/g,'')),c=>c.charCodeAt(0)));}
async function githubRequest(path,options={}){
  const response=await fetch('https://api.github.com'+path,{...options,headers:{Accept:'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28',Authorization:'Bearer '+syncAuth.token,...options.headers},cache:'no-store',credentials:'omit',redirect:'error',signal:AbortSignal.timeout(20000)});
  if([401,403].includes(response.status))throw new Error('GitHub 授权不可用、已到期或额度暂时受限。请检查授权有效期和 Contents 读写权限。');
  return response;
}
async function verifySyncRepo(){
  const response=await githubRequest('/repos/'+syncAuth.repo);
  if(!response.ok)throw new Error('无法访问进度仓库。请确认仓库已创建，且授权码选中了它。');
  const repo=await response.json();
  if(!repo.private)throw new Error('请使用独立的私有仓库，学习记录不会写入公开仓库。');
  if(!repo.permissions?.push)throw new Error('当前授权没有写入此仓库的权限。');
}
async function runSync(){
  if(!Profiles.canSync||!syncAuth||!syncReady)return;
  if(syncBusy){syncAgain=true;return;}
  syncBusy=true;$('#sync-now').disabled=true;$('#sync-connect').disabled=true;$('#sync-disconnect').disabled=true;
  clearTimeout(syncTimer);syncStatus('正在合并两端的学习记录…');
  try{
    await verifySyncRepo();
    for(let attempt=0;attempt<3;attempt++){
      const path='/repos/'+syncAuth.repo+'/contents/progress.json';
      const response=await githubRequest(path);
      let remote={version:1},sha=null;
      if(response.ok){const file=await response.json();if(file.size>5000000||file.encoding!=='base64'||typeof file.content!=='string')throw new Error('云端记录过大或格式不支持。');remote=ProgressCore.clean(JSON.parse(decodeProgress(file.content)));sha=file.sha;}
      else if(response.status!==404)throw new Error('读取云端记录失败，请稍后重试。');
      const merged=ProgressCore.merge(saved,remote),payload=ProgressCore.stringify(merged);
      if(!sha||payload!==ProgressCore.stringify(remote)){
        const result=await githubRequest(path,{method:'PUT',headers:{'Content-Type':'application/json'},body:JSON.stringify({message:'Sync vocabulary learning progress',content:encodeProgress(payload),...(sha?{sha}:{})})});
        if([409,422].includes(result.status)){if(attempt<2)continue;throw new Error('另一台设备正在同步，请稍后再试；本地记录已保留。');}
        if(!result.ok)throw new Error('上传未完成，请检查仓库 Contents 读写权限后重试。');
      }
      // Changes made while the request was in flight remain in memory and are sent next.
      const latest=ProgressCore.merge(saved,merged);
      if(ProgressCore.stringify(latest)!==payload)syncAgain=true;
      const oldBook=saved.book,oldLesson=saved.lessons[saved.book];
      saved={...saved,...latest};save(false);
      updateSidebar();
      if(!playing&&!quiz){
        if(saved.book!==oldBook&&catalog.books.some(b=>b.id===saved.book))await openBook(saved.book,false);
        else if(view!=='books'){if(view==='study')lesson=saved.lessons[book.id]||0;rebuildGroups();render();}
      }
      syncStatus('已同步 · '+new Date().toLocaleTimeString('zh-CN',{hour:'2-digit',minute:'2-digit'})+' · '+syncAuth.repo);
      return;
    }
  }catch(e){syncAgain=false;syncStatus((e.name==='TimeoutError'||e instanceof TypeError)?'网络暂不可用，记录已保存在本机。联网后可再次同步。':e instanceof SyntaxError?'云端记录无法解析，未覆盖本地记录。':e.message);}
  finally{syncBusy=false;$('#sync-now').disabled=!syncAuth;$('#sync-connect').disabled=false;$('#sync-disconnect').disabled=!syncAuth;if(syncAgain){syncAgain=false;scheduleSync();}}
}
function scheduleSync(){if(!syncAuth||!syncReady||!$('#sync-auto').checked)return;clearTimeout(syncTimer);syncTimer=setTimeout(runSync,20000);}
function persistSyncConfig(){if(!Profiles.canSync)return;try{localStorage.setItem(SYNC_CONFIG,JSON.stringify({repo:$('#sync-repo').value.trim(),auto:$('#sync-auto').checked}));}catch{}}
$('#sync-connect').onclick=async()=>{
  if(!Profiles.canSync)return;
  const repo=$('#sync-repo').value.trim(),token=$('#sync-token').value.trim();
  if(!/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(repo)){syncStatus('请填写“用户名/私有仓库名”。');return;}
  if(!token.startsWith('github_pat_')||token.length<30){syncStatus('请使用仅授权进度仓库的 Fine-grained token，不要填写 GitHub 密码。');return;}
  syncAuth={repo,token};$('#sync-token').value='';
  // Session-only unless the person explicitly chooses to remember on this device.
  try{localStorage.removeItem(SYNC_SECRET);sessionStorage.removeItem(SYNC_SECRET);($('#sync-remember').checked?localStorage:sessionStorage).setItem(SYNC_SECRET,JSON.stringify(syncAuth));}catch{syncStatus('浏览器无法记住授权，本次打开期间仍可同步。');}
  persistSyncConfig();await runSync();
};
$('#sync-now').onclick=runSync;
$('#sync-disconnect').onclick=()=>{if(!Profiles.canSync)return;clearTimeout(syncTimer);syncAuth=null;try{localStorage.removeItem(SYNC_SECRET);sessionStorage.removeItem(SYNC_SECRET);}catch{}$('#sync-token').value='';$('#sync-now').disabled=true;$('#sync-disconnect').disabled=true;syncStatus('已断开。本机与云端学习记录均保留。');};
$('#sync-auto').onchange=()=>{persistSyncConfig();if($('#sync-auto').checked)scheduleSync();else clearTimeout(syncTimer);};
window.addEventListener('tingjian-change',scheduleSync);
window.addEventListener('tingjian-ready',()=>{syncReady=true;if(!Profiles.canSync){$('#sync-owner-panel').classList.add('hidden');$('#sync-local-note').classList.remove('hidden');return;}try{
  const config=JSON.parse(localStorage.getItem(SYNC_CONFIG)||'null');if(config){$('#sync-repo').value=config.repo||'';$('#sync-auto').checked=config.auto!==false;}
  const auth=JSON.parse(sessionStorage.getItem(SYNC_SECRET)||localStorage.getItem(SYNC_SECRET)||'null');
  if(auth&&/^[A-Za-z0-9-]+\/[A-Za-z0-9_.-]+$/.test(auth.repo)&&typeof auth.token==='string'&&auth.token.startsWith('github_pat_')){syncAuth=auth;$('#sync-repo').value=auth.repo;$('#sync-remember').checked=!!localStorage.getItem(SYNC_SECRET);$('#sync-now').disabled=false;$('#sync-disconnect').disabled=false;if($('#sync-auto').checked)runSync();else syncStatus('已绑定 · '+auth.repo);}
}catch{syncStatus('未能读取同步设置，请重新绑定。');}});
function syncOnReturn(){if(document.visibilityState==='visible'&&$('#sync-auto').checked)runSync();}
document.addEventListener('visibilitychange',syncOnReturn);window.addEventListener('online',syncOnReturn);
setInterval(()=>{if(document.visibilityState==='visible'&&$('#sync-auto').checked)runSync();},120000);

if(!Profiles.canSync){$('#sync-owner-panel').classList.add('hidden');$('#sync-local-note').classList.remove('hidden');}
