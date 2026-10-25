(function(root){
  'use strict';
  const safeId=id=>/^[a-f0-9]{24}$/.test(id);
  const stamp=v=>Number.isSafeInteger(v)&&v>=0&&v<=Date.now()+86400000?v:0;
  function clean(raw){
    if(!raw||raw.version!==1)throw new Error('云端记录格式不正确，未覆盖任何记录。');
    const out={version:1,book:null,bookUpdated:stamp(raw.bookUpdated),lessons:{},lessonUpdated:{},records:{},meanings:{},meaningUpdated:{}};
    if(safeId(raw.book))out.book=raw.book;
    for(const [id,value]of Object.entries(raw.lessons||{}))if(safeId(id)&&Number.isInteger(value)&&value>=0&&value<10000){out.lessons[id]=value;out.lessonUpdated[id]=stamp(raw.lessonUpdated?.[id]);}
    for(const [id,value]of Object.entries(raw.records||{})){
      if(!safeId(id)||!value||typeof value!=='object')continue;
      const r={updated:stamp(value.updated),_at:{}};
      for(const key of ['read','listen','star'])if(typeof value[key]==='boolean'){r[key]=value[key];r._at[key]=stamp(value._at?.[key]??value.updated);}
      out.records[id]=r;
    }
    for(const [id,value]of Object.entries(raw.meanings||{}))if(safeId(id)&&typeof value==='string'&&value.length<=80&&/[\u4e00-\u9fff]/.test(value))out.meanings[id]=value;
    for(const id of new Set([...Object.keys(out.meanings),...Object.keys(raw.meaningUpdated||{})]))if(safeId(id))out.meaningUpdated[id]=stamp(raw.meaningUpdated?.[id]);
    return out;
  }
  // Per-field timestamps preserve changes made on different devices. Equal timestamps
  // have a deterministic tie-breaker, including explicit false and meaning resets.
  function choose(a,at,b,bt){return bt>at||(bt===at&&JSON.stringify(b??null)>JSON.stringify(a??null))?[b,bt]:[a,at];}
  function merge(left,right){
    const a=clean(left),b=clean(right),out=clean(a);
    [out.book,out.bookUpdated]=choose(a.book,a.bookUpdated,b.book,b.bookUpdated);
    for(const id of new Set([...Object.keys(a.lessons),...Object.keys(b.lessons)])){
      if(!(id in b.lessons))continue;
      if(!(id in a.lessons)){out.lessons[id]=b.lessons[id];out.lessonUpdated[id]=b.lessonUpdated[id];continue;}
      [out.lessons[id],out.lessonUpdated[id]]=choose(a.lessons[id],a.lessonUpdated[id],b.lessons[id],b.lessonUpdated[id]);
    }
    for(const id of new Set([...Object.keys(a.records),...Object.keys(b.records)])){
      const x=a.records[id]||{_at:{}},y=b.records[id]||{_at:{}},r={_at:{},updated:Math.max(x.updated||0,y.updated||0)};
      for(const k of ['read','listen','star']){
        if(!(k in x)&&!(k in y))continue;
        if(!(k in x)){r[k]=y[k];r._at[k]=y._at[k];}
        else if(!(k in y)){r[k]=x[k];r._at[k]=x._at[k];}
        else [r[k],r._at[k]]=choose(x[k],x._at[k],y[k],y._at[k]);
      }out.records[id]=r;
    }
    for(const id of new Set([...Object.keys(a.meaningUpdated),...Object.keys(b.meaningUpdated)])){
      if(!(id in b.meaningUpdated))continue;
      const [value,time]=!(id in a.meaningUpdated)?[b.meanings[id],b.meaningUpdated[id]]:choose(a.meanings[id],a.meaningUpdated[id],b.meanings[id],b.meaningUpdated[id]);
      out.meaningUpdated[id]=time;if(value===undefined)delete out.meanings[id];else out.meanings[id]=value;
    }return out;
  }
  function canonical(value){if(Array.isArray(value))return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
  const stringify=value=>JSON.stringify(canonical(clean(value)));
  const api={clean,merge,stringify};
  if(typeof module!=='undefined')module.exports=api;else root.ProgressCore=api;
})(typeof window!=='undefined'?window:globalThis);
