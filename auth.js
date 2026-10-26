'use strict';
// Browser-local login. Private learning authorization is enforced separately by GitHub.
const Auth=(()=>{
  const $=s=>document.querySelector(s),key=id=>'tingjian-password:'+id,sessionKey=id=>'tingjian-login:'+id;
  let unlocked=false,resolveLogin=null;
  const hex=bytes=>[...bytes].map(x=>x.toString(16).padStart(2,'0')).join('');
  const unhex=text=>Uint8Array.from(text.match(/../g)||[],x=>parseInt(x,16));
  function credential(id){try{return JSON.parse(localStorage.getItem(key(id))||'null');}catch{return null;}}
  async function derive(password,salt,iterations){
    const base=await crypto.subtle.importKey('raw',new TextEncoder().encode(password),'PBKDF2',false,['deriveBits']);
    return hex(new Uint8Array(await crypto.subtle.deriveBits({name:'PBKDF2',salt:unhex(salt),iterations,hash:'SHA-256'},base,256)));
  }
  async function verify(id,password){const c=credential(id);return !!c&&c.version===1&&await derive(password,c.salt,c.iterations)===c.hash;}
  async function setPassword(id,password,confirm){
    if(password.length<6||password.length>128)throw new Error('密码请设置为 6–128 个字符。');
    if(password!==confirm)throw new Error('两次输入的密码不一致。');
    const salt=hex(crypto.getRandomValues(new Uint8Array(16))),iterations=210000;
    const hash=await derive(password,salt,iterations);
    localStorage.setItem(key(id),JSON.stringify({version:1,salt,iterations,hash}));return hash;
  }
  function remember(id){const c=credential(id);sessionStorage.setItem(sessionKey(id),c.hash);}
  function show(){
    document.body.classList.add('login-locked');
    const c=credential(Profiles.id),current=Profiles.current();
    $('#login-heading').textContent=c?'登录学习空间':'为已有用户设置密码';
    $('#login-note').textContent=c?'登录仅适用于此浏览器；本标签页内保持登录。':'这次升级需要补充密码，原有词书、学习进度和绑定均保留。';
    $('#login-select').replaceChildren(...Profiles.list().map(p=>{const o=document.createElement('option');o.value=p.id;o.textContent=p.name;o.selected=p.id===Profiles.id;return o;}));
    $('#login-name').value=current.name;$('#login-name').readOnly=!!c;
    $('#login-confirm-wrap').classList.toggle('hidden',!!c);$('#login-confirm').required=!c;
    $('#login-password').autocomplete=c?'current-password':'new-password';$('#login-submit').textContent=c?'登录':'设置密码并进入';
    $('#login-dialog').showModal();
  }
  function unlock(){unlocked=true;document.body.classList.remove('login-locked');$('#login-dialog').close();$('#login-password').value='';$('#login-confirm').value='';refreshProfileName();resolveLogin?.();resolveLogin=null;}
  function requireLogin(){
    const c=credential(Profiles.id);try{if(c&&sessionStorage.getItem(sessionKey(Profiles.id))===c.hash){unlocked=true;return Promise.resolve();}}catch{}
    return new Promise(resolve=>{resolveLogin=resolve;show();});
  }
  $('#login-dialog').addEventListener('cancel',e=>e.preventDefault());
  $('#login-select').onchange=e=>Profiles.select(e.target.value);
  $('#login-form').onsubmit=async e=>{
    e.preventDefault();$('#login-submit').disabled=true;$('#login-error').textContent='';
    try{
      const password=$('#login-password').value;
      if(credential(Profiles.id)){if(!await verify(Profiles.id,password))throw new Error('密码不正确，请重试。');}
      else{const name=$('#login-name').value.trim();if(!name)throw new Error('请输入用户名。');if(Profiles.list().some(p=>p.id!==Profiles.id&&p.name.toLocaleLowerCase()===name.toLocaleLowerCase()))throw new Error('已有这个用户名，请选择对应用户登录。');await setPassword(Profiles.id,password,$('#login-confirm').value);Profiles.rename(name);}
      remember(Profiles.id);unlock();
    }catch(error){$('#login-error').textContent=error.message||'未能登录，请允许浏览器保存网站数据。';}
    finally{$('#login-submit').disabled=false;}
  };
  $('#login-new-form').onsubmit=async e=>{
    e.preventDefault();const button=$('#login-new-form button');button.disabled=true;
    try{
      const name=$('#login-new-name').value.trim(),password=$('#login-new-password').value;
      if(password!==$('#login-new-confirm').value||password.length<6)throw new Error('请输入至少 6 位密码，并确认两次输入一致。');
      const id=Profiles.create(name);await setPassword(id,password,$('#login-new-confirm').value);remember(id);Profiles.select(id,true);
    }catch(error){$('#login-new-error').textContent=error.message;}finally{button.disabled=false;}
  };
  $('#profile-logout').onclick=()=>{stopPlayback();PrivateLearning.clear();sessionStorage.removeItem(sessionKey(Profiles.id));unlocked=false;location.reload();};
  $('#password-form').onsubmit=async e=>{
    e.preventDefault();const button=$('#password-form button');button.disabled=true;
    try{if(!await verify(Profiles.id,$('#password-old').value))throw new Error('原密码不正确。');await setPassword(Profiles.id,$('#password-new').value,$('#password-confirm').value);remember(Profiles.id);$('#password-form').reset();$('#password-message').textContent='本机密码已更新；其他设备的密码不受影响。';}
    catch(error){$('#password-message').textContent=error.message;}finally{button.disabled=false;}
  };
  window.addEventListener('storage',e=>{if(e.key===key(Profiles.id)&&unlocked&&credential(Profiles.id)?.hash!==sessionStorage.getItem(sessionKey(Profiles.id))){stopPlayback();PrivateLearning.clear();sessionStorage.removeItem(sessionKey(Profiles.id));location.reload();}});
  return {requireLogin,get unlocked(){return unlocked;}};
})();
