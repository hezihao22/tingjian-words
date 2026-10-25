'use strict';
// A profile is a browser-local learning space, not an authenticated account.
const Profiles=(()=>{
  const prefix='tingjian-profile-',selection='tingjian-active-profile';
  const valid=id=>id==='default'||/^p-[a-f0-9-]{36}$/.test(id||'');
  const read=id=>{try{const p=JSON.parse(localStorage.getItem(prefix+id));return p&&p.id===id&&valid(id)&&typeof p.name==='string'?p:null;}catch{return null;}};
  let active='default';
  try{const id=sessionStorage.getItem(selection)||localStorage.getItem(selection);if(valid(id)&&(id==='default'||read(id)))active=id;}catch{}
  try{sessionStorage.setItem(selection,active);}catch{}
  const fallback={id:'default',name:'我的学习'};
  const list=()=>{
    const found=[read('default')||fallback];
    try{for(let i=0;i<localStorage.length;i++){const key=localStorage.key(i);if(key?.startsWith(prefix)){const id=key.slice(prefix.length);if(id!=='default'){const p=read(id);if(p)found.push(p);}}}}catch{}
    return found;
  };
  const write=(id,name)=>{
    name=name.trim();if(!name||name.length>20)throw new Error('请输入 1–20 个字的用户名。');
    if(list().some(p=>p.id!==id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('本机已有这个用户名，请直接切换或换一个名字。');
    localStorage.setItem(prefix+id,JSON.stringify({id,name}));return id;
  };
  const select=id=>{
    if(!list().some(p=>p.id===id))throw new Error('未找到这个用户，请刷新后重试。');
    // Each tab holds its own profile. Other tabs cannot change its save destination.
    sessionStorage.setItem(selection,id);localStorage.setItem(selection,id);
    location.reload();
  };
  return Object.freeze({id:active,key:active==='default'?'tingjian-v1':'tingjian-v1:'+active,
    canSync:active==='default',list,current:()=>read(active)||(active==='default'?fallback:{id:active,name:'本机用户'}),
    rename:name=>write(active,name),create:name=>write('p-'+crypto.randomUUID(),name),select});
})();
function showProfiles(){
  stopPlayback();
  const current=Profiles.current();
  document.querySelector('#profile-name').value=current.name;
  document.querySelector('#profile-message').textContent='';
  const container=document.querySelector('#profile-list');container.replaceChildren();
  for(const p of Profiles.list()){
    const button=document.createElement('button');button.type='button';button.className='profile-option';
    const name=document.createElement('strong');name.textContent=p.name;
    const note=document.createElement('span');note.textContent=p.id===Profiles.id?'当前用户':p.id==='default'?'原有学习档案':'独立本机档案';
    button.append(name,note);button.disabled=p.id===Profiles.id;
    button.onclick=()=>{try{Profiles.select(p.id);}catch{document.querySelector('#profile-message').textContent='无法切换，请允许浏览器保存网站数据。';}};
    container.append(button);
  }
  document.querySelector('#profile-dialog').showModal();
}
function refreshProfileName(){
  document.querySelector('#profile-button-name').textContent=Profiles.current().name;
  document.querySelector('#profile-btn').title='当前用户：'+Profiles.current().name+' · 切换用户';
  document.querySelector('#data-profile-name').textContent=Profiles.current().name;
}
document.querySelector('#profile-btn').onclick=showProfiles;
document.querySelector('#profile-rename').onsubmit=e=>{e.preventDefault();try{Profiles.rename(document.querySelector('#profile-name').value);refreshProfileName();showProfiles();document.querySelector('#profile-message').textContent='用户名已更新，原有进度和绑定均保留。';}catch(error){document.querySelector('#profile-message').textContent=error.message;}};
document.querySelector('#profile-create').onsubmit=e=>{e.preventDefault();try{Profiles.select(Profiles.create(document.querySelector('#profile-new-name').value));}catch(error){document.querySelector('#profile-message').textContent=error.message;}};
window.addEventListener('storage',e=>{if(e.key?.startsWith('tingjian-profile-'))refreshProfileName();});
refreshProfileName();
