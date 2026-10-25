(function(root) {
  const chunks = (words, size=50) => Array.from({length:Math.ceil(words.length/size)}, (_,i)=>words.slice(i*size,(i+1)*size));
  const shuffle = (items, random=Math.random) => {
    const arr=[...items];
    for(let i=arr.length-1;i>0;i--) { const j=Math.floor(random()*(i+1)); [arr[i],arr[j]]=[arr[j],arr[i]]; }
    return arr;
  };
  function choices(word, pool, meaning, random=Math.random) {
    const answer=meaning(word);
    const other=[...new Set(pool.filter(w=>w.id!==word.id).map(meaning).filter(m=>m && m!==answer))];
    return shuffle([answer,...shuffle(other,random).slice(0,3)],random);
  }
  function sequence(word, meaning, chinese=true) {
    const result=Array.from({length:3},(_,i)=>({text:word.en,lang:'en',label:`英文 ${i+1} / 3`}));
    if(chinese && meaning) result.push({text:meaning,lang:'zh',label:'中文释义 1 / 1'});
    return result;
  }
  const api={chunks,shuffle,choices,sequence};
  if(typeof module!=='undefined') module.exports=api;
  else root.WordCore=api;
})(typeof window!=='undefined'?window:globalThis);
