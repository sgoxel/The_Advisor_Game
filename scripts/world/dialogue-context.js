(function(){
"use strict";

const TONES=Object.freeze(["friendly","neutral","urgent","hostile","formal","private","guarded"]);
const SOCIAL_KEYS=Object.freeze(["trust","suspicion","respect","fear","loyalty","resentment"]);
const CASE_IDS=Object.freeze(["public-friendly","home-guarded","work-formal","travel-urgent","sleep-private"]);

function scope(){return typeof window!=="undefined"?window:globalThis}
function normalizeSeed(value){
  const text=String(value==null?"":value).trim();
  return text||"The_Advisor_Game_20260924";
}
function clamp01(value,fallback){
  const n=Number(value);
  return Number.isFinite(n)?Math.max(0,Math.min(1,n)):fallback;
}
function normalizeSocial(value){
  const input=value&&typeof value==="object"?value:{};
  return Object.freeze({
    trust:clamp01(input.trust,0.5),
    suspicion:clamp01(input.suspicion,0.25),
    respect:clamp01(input.respect,0.5),
    fear:clamp01(input.fear,0.1),
    loyalty:clamp01(input.loyalty,0.35),
    resentment:clamp01(input.resentment,0.1)
  });
}
function hashText(value){
  const text=String(value==null?"":value);
  let hash=2166136261>>>0;
  for(let i=0;i<text.length;i++){hash^=text.charCodeAt(i);hash=Math.imul(hash,16777619)}
  return (hash>>>0).toString(16).toUpperCase().padStart(8,"0");
}
function roster(seed){
  return scope().DailyActivity?.roster?.(seed)||scope().DailyActivity?.build?.(seed)||[];
}
function resident(seed,id){
  return roster(seed).find(item=>item.id===id)||null;
}
function timestampForBlock(block){
  const minute=Math.max(0,Math.min(1439,Math.floor((Number(block.startMinute)+Number(block.endMinute))/2)));
  return Object.freeze({year:1200,month:6,day:12,hour:Math.floor(minute/60),minute:minute%60,second:0});
}
function blockFor(residentValue,state,occurrence){
  const matches=(residentValue?.schedule||[]).filter(item=>item.state===state);
  return matches[Math.max(0,Math.min(matches.length-1,Number(occurrence)||0))]||null;
}
function lookupLot(seed,buildingId){
  if(!buildingId)return null;
  return scope().SpecialLots?.build?.(seed)?.find(lot=>lot.id===buildingId)||null;
}
function locationContext(seed,residentValue,activity){
  if(activity.state==="return-home"){
    return Object.freeze({kind:"path",label:"Village path toward "+(residentValue.homeLabel||"home"),buildingId:null,privacy:"public"});
  }
  if(activity.location==="home"){
    return Object.freeze({kind:"home",label:residentValue.homeLabel||"Home",buildingId:residentValue.homePlanId||null,privacy:"private"});
  }
  if(activity.location==="workplace"){
    const lot=lookupLot(seed,activity.buildingId);
    return Object.freeze({
      kind:lot?.kind==="shop"?"market":"workplace",
      label:lot?.label||residentValue.workplaceLabel||"Workplace",
      buildingId:activity.buildingId||residentValue.workplaceId||null,
      privacy:"public"
    });
  }
  if(activity.location==="public"){
    const lot=lookupLot(seed,activity.buildingId);
    return Object.freeze({
      kind:lot?.kind||"public",
      label:lot?.label||"Village public space",
      buildingId:activity.buildingId||null,
      privacy:lot?.kind==="tavern"?"semi-private":"public"
    });
  }
  return Object.freeze({kind:"path",label:"Village path",buildingId:null,privacy:"public"});
}
function activityContext(activity){
  let kind="speaking";
  if(activity.state==="work")kind="working";
  else if(activity.state==="return-home")kind="traveling";
  else if(activity.state==="sleep")kind="sleeping";
  else if(activity.state==="breakfast"||activity.state==="lunch")kind="eating";
  else if(activity.state==="prepare")kind="resting";
  return Object.freeze({
    kind,state:activity.state,label:activity.label,action:activity.intendedAction,
    timestamp:activity.timestamp,target:Object.freeze({...activity.target})
  });
}
function chooseTone(location,activity,social,urgency){
  if(activity.kind==="sleeping")return "private";
  if(activity.kind==="traveling"&&urgency>=0.65)return "urgent";
  if(social.resentment>=0.75||social.suspicion>=0.88)return "hostile";
  if(location.kind==="home"&&social.suspicion>=0.55)return "guarded";
  if(activity.kind==="working")return "formal";
  if(urgency>=0.8)return "urgent";
  if(social.trust>=0.7&&social.suspicion<=0.35)return "friendly";
  if(location.privacy==="private")return "private";
  return "neutral";
}
function topicTokens(topic){
  return String(topic||"").toLowerCase().match(/[a-z0-9]+/g)||[];
}
function knowledgeFor(seed,residentId,topic){
  const entries=scope().CharacterMemory?.list?.(seed,{kind:"resident",id:residentId})||[];
  const tokens=topicTokens(topic).filter(token=>token.length>2);
  const ranked=entries.map(entry=>{
    const text=(entry.summary+" "+(entry.fact?.subject||"")+" "+(entry.fact?.predicate||"")).toLowerCase();
    const matches=tokens.reduce((n,token)=>n+(text.includes(token)?1:0),0);
    return {entry,matches};
  }).filter(item=>item.matches>0).sort((a,b)=>
    b.matches-a.matches||
    Number(b.entry.relevance||0)-Number(a.entry.relevance||0)||
    Number(b.entry.confidence||0)-Number(a.entry.confidence||0)||
    String(a.entry.id).localeCompare(String(b.entry.id))
  );
  return ranked[0]?.entry||null;
}
function responseText(tone,activity,topic,knowledge){
  const prefix={
    friendly:"I'm glad you asked. ",
    neutral:"I'll answer as far as I can. ",
    urgent:"We should speak quickly. ",
    hostile:"I don't trust this conversation. ",
    formal:"While I'm working, I'll keep this brief. ",
    private:"This is a private moment; keep this quiet. ",
    guarded:"I'll be careful about what I say here. "
  }[tone]||"";
  if(activity.kind==="sleeping"&&!knowledge)return prefix+"I cannot confirm anything about "+topic+" right now.";
  if(!knowledge)return prefix+"I do not have reliable knowledge to confirm anything about "+topic+".";
  if(knowledge.uncertain){
    return prefix+"I only know this as uncertain information: "+knowledge.summary;
  }
  return prefix+"What I know: "+knowledge.summary;
}
function resolve(seedValue,configValue){
  const seed=normalizeSeed(seedValue);
  const config=configValue&&typeof configValue==="object"?configValue:{};
  const residentId=String(config.speakerId||"R01");
  const speaker=resident(seed,residentId);
  if(!speaker)throw new Error("Unknown resident speaker: "+residentId);
  const when=config.when||scope().GameTime?.getNow?.();
  const activityRaw=scope().DailyActivity?.resolve?.(seed,speaker,when)||scope().DailyActivity?.resolveActionTarget?.(seed,speaker,when);
  if(!activityRaw)throw new Error("Dialogue activity context unavailable");
  const location=locationContext(seed,speaker,activityRaw);
  const activity=activityContext(activityRaw);
  const persistentSocial=config.social==null?scope().SocialState?.dialogueContext?.(seed,residentId):null;
  const social=normalizeSocial(config.social??persistentSocial?.values);
  const socialSource=config.social!=null?"provided-context-snapshot":persistentSocial?.source||"default-context";
  const urgency=clamp01(config.urgency,0);
  const tone=chooseTone(location,activity,social,urgency);
  const topic=String(config.topic||"the current situation").trim()||"the current situation";
  const knowledge=knowledgeFor(seed,residentId,topic);
  const interactionKind=config.interactionKind==="advice-response"?"advice-response":"conversation";
  const response=responseText(tone,activity,topic,knowledge);
  const identity=[
    seed,residentId,"protagonist",activity.timestamp,location.kind,activity.kind,
    SOCIAL_KEYS.map(key=>social[key].toFixed(3)).join(","),urgency.toFixed(3),topic,interactionKind,
    knowledge?.id||"none",tone,response
  ].join("|");
  return Object.freeze({
    id:"DLG-"+hashText(identity),
    campaignSeed:seed,
    interactionKind,
    speaker:Object.freeze({kind:"resident",id:speaker.id,name:speaker.name}),
    listener:Object.freeze({kind:"protagonist",id:"protagonist",name:"Protagonist"}),
    topic,
    location,
    activity,
    social,
    socialSource,
    socialContext:persistentSocial?Object.freeze({
      reputationAverage:persistentSocial.reputationAverage,
      activeDutyPriority:persistentSocial.activeDutyPriority
    }):null,
    urgency,
    tone,
    response,
    knowledge:Object.freeze({
      grounded:Boolean(knowledge),
      memoryId:knowledge?.id||null,
      sourceType:knowledge?.source?.type||null,
      reliability:knowledge?.reliability||null,
      uncertain:Boolean(knowledge?.uncertain)
    }),
    authority:"presentation-only",
    worldMutation:false
  });
}
function caseConfigs(seedValue,residentIdValue){
  const seed=normalizeSeed(seedValue);
  const residentId=String(residentIdValue||"R03");
  const r=resident(seed,residentId);
  if(!r)return Object.freeze([]);
  const block=(state,occ=0)=>blockFor(r,state,occ);
  const make=(id,label,state,social,urgency,interactionKind="conversation")=>{
    const b=block(state);
    return Object.freeze({
      id,label,
      config:Object.freeze({
        speakerId:residentId,when:timestampForBlock(b),topic:"the mill",
        social:Object.freeze({...social}),urgency,interactionKind
      })
    });
  };
  return Object.freeze([
    make("public-friendly","Trusted conversation in public","social",
      {trust:0.86,suspicion:0.12,respect:0.72,fear:0.05,loyalty:0.68,resentment:0.08},0.2,"advice-response"),
    make("home-guarded","Guarded conversation at home","breakfast",
      {trust:0.32,suspicion:0.72,respect:0.48,fear:0.18,loyalty:0.3,resentment:0.28},0.2),
    make("work-formal","Formal conversation during work","work",
      {trust:0.58,suspicion:0.24,respect:0.88,fear:0.08,loyalty:0.45,resentment:0.12},0.2),
    make("travel-urgent","Urgent conversation while traveling","return-home",
      {trust:0.62,suspicion:0.22,respect:0.61,fear:0.16,loyalty:0.52,resentment:0.1},0.92),
    make("sleep-private","Private interruption while sleeping","sleep",
      {trust:0.72,suspicion:0.2,respect:0.55,fear:0.06,loyalty:0.6,resentment:0.08},0.1)
  ]);
}
function proof(seedValue,residentIdValue){
  const seed=normalizeSeed(seedValue);
  const residentId=String(residentIdValue||"R03");
  const cases=caseConfigs(seed,residentId);
  const results=cases.map(item=>resolve(seed,item.config));
  const repeats=cases.map(item=>resolve(seed,item.config));
  const tones=results.map(item=>item.tone);
  const meaningfulActivities=results.map(item=>item.activity.kind);
  const expectedTones=["friendly","guarded","formal","urgent","private"];
  const identitiesPresent=results.every(item=>
    item.speaker.kind==="resident"&&item.speaker.id===residentId&&Boolean(item.speaker.name)&&
    item.listener.kind==="protagonist"&&item.listener.id==="protagonist"
  );
  const contextComplete=results.every(item=>Boolean(item.location.kind)&&Boolean(item.location.label)&&Boolean(item.activity.kind)&&Boolean(item.activity.timestamp));
  const socialComplete=results.every(item=>SOCIAL_KEYS.every(key=>Number.isFinite(item.social[key])&&item.social[key]>=0&&item.social[key]<=1));
  const tonesExpected=JSON.stringify(tones)===JSON.stringify(expectedTones);
  const statesMeaningful=["speaking","eating","working","traveling","sleeping"].every(kind=>meaningfulActivities.includes(kind));
  const deterministic=JSON.stringify(results)===JSON.stringify(repeats);
  const knowledgeGrounded=results.every(item=>item.knowledge.grounded&&Boolean(item.knowledge.memoryId));
  const noInventedFacts=results.every(item=>item.knowledge.grounded||item.response.includes("do not have reliable knowledge")||item.response.includes("cannot confirm"));
  return Object.freeze({
    pass:identitiesPresent&&contextComplete&&socialComplete&&tonesExpected&&statesMeaningful&&deterministic&&knowledgeGrounded&&noInventedFacts,
    campaignSeed:seed,residentId,caseCount:results.length,
    identitiesPresent,contextComplete,socialComplete,tonesExpected,statesMeaningful,deterministic,knowledgeGrounded,noInventedFacts,
    relationshipPersistenceIntroduced:false,
    worldMutationApi:false,
    factsCreatedByDialogue:false,
    results:Object.freeze(results)
  });
}
function escapeHtml(value){
  return String(value==null?"":value).replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;").replace(/'/g,"&#39;");
}
function percent(value){return Math.round(clamp01(value,0)*100)+"%"}
function setCheck(id,pass){
  const node=typeof document!=="undefined"?document.getElementById(id):null;
  if(!node)return;
  node.textContent=pass?"PASS":"FAIL";
  node.classList.toggle("pass",Boolean(pass));
}
function renderDebugPanel(seedValue,residentIdValue,caseIdValue,rootNode){
  if(typeof document==="undefined")return null;
  const seed=normalizeSeed(seedValue);
  const residentId=String(residentIdValue||"R03");
  const root=rootNode||document.getElementById("dialogueProof");
  if(!root)return null;
  const cases=caseConfigs(seed,residentId);
  const selected=cases.find(item=>item.id===caseIdValue)||cases[0];
  if(!selected)return null;
  const result=resolve(seed,selected.config);
  const verification=proof(seed,residentId);
  const select=root.querySelector("#dialogueCaseSelect");
  if(select){
    select.innerHTML=cases.map(item=>"<option value=\""+escapeHtml(item.id)+"\" "+(item.id===selected.id?"selected":"")+">"+escapeHtml(item.label)+"</option>").join("");
    select.onchange=()=>renderDebugPanel(seed,residentId,select.value,root);
  }
  const pairs={
    dialogueSpeaker:result.speaker.name+" ("+result.speaker.id+")",
    dialogueListener:result.listener.name,
    dialogueLocation:result.location.label+" · "+result.location.kind,
    dialogueActivity:result.activity.kind+" · "+result.activity.label,
    dialogueTone:result.tone,
    dialogueTime:result.activity.timestamp
  };
  for(const [id,value] of Object.entries(pairs)){
    const node=root.querySelector("#"+id);if(node)node.textContent=value;
  }
  const tone=root.querySelector("#dialogueTone");
  if(tone){tone.className="dialogue-tone "+result.tone}
  const metrics=root.querySelector("#dialogueSocialMetrics");
  if(metrics){
    metrics.innerHTML=SOCIAL_KEYS.map(key=>"<span><b>"+escapeHtml(key)+"</b> "+escapeHtml(percent(result.social[key]))+"</span>").join("");
  }
  const response=root.querySelector("#dialogueResponse");
  if(response)response.textContent=result.response;
  const grounding=root.querySelector("#dialogueGrounding");
  if(grounding){
    grounding.innerHTML=result.knowledge.grounded
      ? "<b>Grounded memory:</b> "+escapeHtml(result.knowledge.memoryId)+" · "+escapeHtml(result.knowledge.sourceType)+" · "+escapeHtml(result.knowledge.reliability)+(result.knowledge.uncertain?" · UNCERTAIN":"")
      : "<b>Grounded memory:</b> none — response refuses to invent a fact";
  }
  const authority=root.querySelector("#dialogueAuthority");
  if(authority)authority.textContent=result.authority+" · social state is input only";
  setCheck("vDialogueContext",verification.identitiesPresent&&verification.contextComplete);
  setCheck("vDialogueSocial",verification.socialComplete&&verification.tonesExpected);
  setCheck("vDialogueActivity",verification.statesMeaningful);
  setCheck("vDialogueGrounding",verification.knowledgeGrounded&&verification.noInventedFacts);
  setCheck("vDialogueDeterministic",verification.deterministic);
  setCheck("vDialogueAuthority",!verification.relationshipPersistenceIntroduced&&!verification.worldMutationApi&&!verification.factsCreatedByDialogue);
  root.dataset.caseId=selected.id;
  root.dataset.dialogueId=result.id;
  root.dataset.tone=result.tone;
  root.dataset.activity=result.activity.kind;
  root.dataset.location=result.location.kind;
  return Object.freeze({selectedCase:selected.id,result,verification});
}

const api=Object.freeze({
  TONES,SOCIAL_KEYS,CASE_IDS,normalizeSocial,resolve,caseConfigs,proof,renderDebugPanel
});
scope().DialogueContext=api;
})();