(function(){
"use strict";

function hashSeed(seedValue){
  const text=String(seedValue==null?"":seedValue);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){
    hash^=text.charCodeAt(i);
    hash=Math.imul(hash,16777619);
  }
  hash^=hash>>>16;
  hash=Math.imul(hash,2246822507);
  hash^=hash>>>13;
  hash=Math.imul(hash,3266489909);
  hash^=hash>>>16;
  return (hash>>>0)||1831565813;
}

function create(seedValue){
  let state=hashSeed(seedValue);
  function nextUint32(){
    state=(state+1831565813)>>>0;
    let value=state;
    value=Math.imul(value^(value>>>15),value|1);
    value^=value+Math.imul(value^(value>>>7),value|61);
    return (value^(value>>>14))>>>0;
  }
  function next(){
    return nextUint32()/4294967296;
  }
  return Object.freeze({nextUint32,next});
}

function sequence(seedValue,count){
  const total=Math.max(0,Number.isInteger(count)?count:6);
  const random=create(seedValue);
  const values=[];
  for(let i=0;i<total;i++)values.push(random.nextUint32());
  return values;
}

function verify(seedValue){
  const first=sequence(seedValue,6);
  const second=sequence(seedValue,6);
  const alternate=sequence(String(seedValue)+"|WP002_ALTERNATE",6);
  return Object.freeze({
    repeatable:first.every((value,index)=>value===second[index]),
    different:first.some((value,index)=>value!==alternate[index]),
    sequence:first
  });
}

window.PRNG=Object.freeze({hashSeed,create,sequence,verify});
})();
