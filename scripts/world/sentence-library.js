(function(root,factory){
"use strict";
var api=factory();
if(typeof module!=="undefined"&&module.exports)module.exports=api;
if(root)root.SentenceLibrary=api;
})(typeof globalThis!=="undefined"?globalThis:this,function(){
"use strict";

var NORMALIZER_VERSION="advisor-input-normalizer-v1";
var LIBRARY_VERSION="advisor-sentence-library-v1";
var MAX_INPUT_LENGTH=512;
var MAX_CANDIDATES=8;
var MATCH_TYPE_RANK={exact:3,phrase:2,pattern:1};

function deepFreeze(value){
  if(!value||typeof value!=="object"||Object.isFrozen(value))return value;
  Object.freeze(value);
  Object.keys(value).forEach(function(key){deepFreeze(value[key]);});
  return value;
}

function normalizeWhitespace(value){return value.replace(/\s+/g," ").trim();}

function normalizeInput(input){
  if(input===null||input===undefined)return "";
  var source=String(input);
  if(source.length>MAX_INPUT_LENGTH)return null;
  var normalized=source.normalize?source.normalize("NFKC"):source;
  return normalizeWhitespace(
    normalized
      .replace(/[\u2018\u2019]/g,"'")
      .toLowerCase()
      .replace(/[^\p{L}\p{N}'\s-]+/gu," ")
      .replace(/\s*-\s*/g,"-")
  );
}

function canonicalize(value){
  if(Array.isArray(value))return value.map(canonicalize);
  if(value&&typeof value==="object"){
    var result={};
    Object.keys(value).sort().forEach(function(key){
      if(value[key]!==undefined)result[key]=canonicalize(value[key]);
    });
    return result;
  }
  return value;
}

function stableStringify(value){return JSON.stringify(canonicalize(value));}

function exactRule(id,intentId,forms,priority,confidence,variables){
  return {id:id,intentId:intentId,type:"exact",forms:forms,priority:priority,confidence:confidence,variables:variables||null};
}
function phraseRule(id,intentId,forms,priority,confidence){
  return {id:id,intentId:intentId,type:"phrase",forms:forms,priority:priority,confidence:confidence};
}
function patternRule(id,intentId,source,variableNames,priority,confidence){
  return {id:id,intentId:intentId,type:"pattern",source:source,variableNames:variableNames,priority:priority,confidence:confidence};
}

var RULES=[
  exactRule("greeting-core","advisor.greeting",["hello","hi","hey","greetings","good morning","good evening"],100,1),
  exactRule("status-core","advisor.status.question",["how are you","how do you feel","are you okay","how are things"],100,1),
  exactRule("schedule-core","advisor.schedule.question",["what are you doing today","what is your schedule","what's your schedule","when do you work","what are you doing"],100,1),
  exactRule("inventory-core","advisor.inventory.question",["what do you have","what are you carrying","show me your inventory","what is in your inventory","what's in your inventory"],100,1),
  exactRule("travel-market-exact","advisor.travel.suggest",["go to the market"],110,1,{place:"market"}),
  phraseRule("warning-core","advisor.warning",["be careful","watch out","stay alert"],85,0.9),
  patternRule("reminder-topic","advisor.reminder","^(?:please )?(?:remember|don't forget|do not forget) (.+)$",["topic"],80,0.88),
  patternRule("information-topic","advisor.info.request","^(?:please )?(?:tell me about|what do you know about|explain) (.+)$",["topic"],82,0.9),
  patternRule("location-question","advisor.info.location","^(?:please )?where is (.+)$",["place"],82,0.9),
  patternRule("travel-place","advisor.travel.suggest","^(?:please )?(?:go to|travel to|head to|visit|walk to) (.+)$",["place"],78,0.86),
  patternRule("interaction-person","advisor.interaction.request","^(?:please )?(?:talk to|speak with|speak to) (.+)$",["person"],78,0.86),
  patternRule("interaction-topic","advisor.interaction.request","^(?:please )?(?:ask|question) (.+?) about (.+)$",["person","topic"],84,0.91),
  patternRule("warning-target","advisor.warning","^(?:please )?(?:avoid|stay away from) (.+)$",["target"],76,0.84),
  patternRule("ambiguous-find-place","advisor.travel.suggest","^find (.+)$",["target"],40,0.62),
  patternRule("ambiguous-find-person","advisor.interaction.request","^find (.+)$",["target"],40,0.62),
  patternRule("ambiguous-check-info","advisor.info.request","^check on (.+)$",["target"],38,0.6),
  patternRule("ambiguous-check-interaction","advisor.interaction.request","^check on (.+)$",["target"],38,0.6)
];

RULES.forEach(function(rule,index){
  rule.index=index;
  if(rule.forms)rule.forms=rule.forms.map(function(form){return normalizeInput(form);});
  if(rule.type==="pattern")rule.regex=new RegExp(rule.source,"u");
});

function publicRule(rule){
  return {
    id:rule.id,
    intentId:rule.intentId,
    type:rule.type,
    forms:rule.forms?rule.forms.slice():undefined,
    pattern:rule.source||undefined,
    variableNames:rule.variableNames?rule.variableNames.slice():undefined,
    priority:rule.priority,
    confidence:rule.confidence
  };
}
var PUBLIC_RULES=RULES.map(publicRule);
deepFreeze(PUBLIC_RULES);

function candidateFromRule(rule,variables){
  return {
    intentId:rule.intentId,
    ruleId:rule.id,
    matchType:rule.type,
    priority:rule.priority,
    confidence:rule.confidence,
    variables:variables||{}
  };
}

function compareCandidates(a,b){
  if(a.priority!==b.priority)return b.priority-a.priority;
  if(a.confidence!==b.confidence)return b.confidence-a.confidence;
  if(MATCH_TYPE_RANK[a.matchType]!==MATCH_TYPE_RANK[b.matchType])return MATCH_TYPE_RANK[b.matchType]-MATCH_TYPE_RANK[a.matchType];
  if(a.ruleIndex!==b.ruleIndex)return a.ruleIndex-b.ruleIndex;
  return a.intentId.localeCompare(b.intentId);
}

function phraseContains(text,phrase){
  return (" "+text+" ").indexOf(" "+phrase+" ")!==-1;
}

function match(input){
  var rawInput=input===null||input===undefined?"":String(input);
  var baseMetrics={
    maxInputLength:MAX_INPUT_LENGTH,
    libraryEntries:RULES.length,
    rulesEvaluated:0,
    formComparisons:0,
    patternEvaluations:0,
    fullWorldScan:false,
    externalLlmUsed:false,
    simulationMutation:false
  };
  if(rawInput.length>MAX_INPUT_LENGTH){
    return deepFreeze({
      normalizerVersion:NORMALIZER_VERSION,
      libraryVersion:LIBRARY_VERSION,
      normalizedInput:null,
      rejected:"input-too-long",
      candidates:[],
      selectedIntentId:null,
      ambiguity:{isAmbiguous:false,reason:"input-rejected",candidateIntentIds:[]},
      metrics:baseMetrics
    });
  }

  var normalized=normalizeInput(rawInput);
  var rawCandidates=[];
  RULES.forEach(function(rule){
    baseMetrics.rulesEvaluated+=1;
    if(rule.type==="exact"){
      for(var i=0;i<rule.forms.length;i+=1){
        baseMetrics.formComparisons+=1;
        if(normalized===rule.forms[i]){
          var exactCandidate=candidateFromRule(rule,rule.variables?Object.assign({},rule.variables):{});
          exactCandidate.ruleIndex=rule.index;
          rawCandidates.push(exactCandidate);
          break;
        }
      }
      return;
    }
    if(rule.type==="phrase"){
      for(var j=0;j<rule.forms.length;j+=1){
        baseMetrics.formComparisons+=1;
        if(phraseContains(normalized,rule.forms[j])){
          var phraseCandidate=candidateFromRule(rule,{});
          phraseCandidate.ruleIndex=rule.index;
          rawCandidates.push(phraseCandidate);
          break;
        }
      }
      return;
    }
    baseMetrics.patternEvaluations+=1;
    var found=rule.regex.exec(normalized);
    if(!found)return;
    var vars={};
    for(var k=0;k<rule.variableNames.length;k+=1){
      vars[rule.variableNames[k]]=normalizeWhitespace(found[k+1]||"");
    }
    var patternCandidate=candidateFromRule(rule,vars);
    patternCandidate.ruleIndex=rule.index;
    rawCandidates.push(patternCandidate);
  });

  rawCandidates.sort(compareCandidates);
  var seen={};
  var candidates=[];
  rawCandidates.forEach(function(candidate){
    var copy={
      intentId:candidate.intentId,
      ruleId:candidate.ruleId,
      matchType:candidate.matchType,
      priority:candidate.priority,
      confidence:candidate.confidence,
      variables:candidate.variables
    };
    var key=candidate.intentId+"\u0000"+stableStringify(candidate.variables);
    if(seen[key])return;
    seen[key]=true;
    if(candidates.length<MAX_CANDIDATES)candidates.push(copy);
  });

  var top=candidates[0]||null;
  var conflictIntents=[];
  if(top){
    candidates.forEach(function(candidate){
      if(candidate.priority===top.priority&&candidate.confidence===top.confidence&&conflictIntents.indexOf(candidate.intentId)===-1){
        conflictIntents.push(candidate.intentId);
      }
    });
  }
  conflictIntents.sort();
  var isAmbiguous=conflictIntents.length>1;

  return deepFreeze({
    normalizerVersion:NORMALIZER_VERSION,
    libraryVersion:LIBRARY_VERSION,
    normalizedInput:normalized,
    rejected:null,
    candidates:candidates,
    selectedIntentId:top&&!isAmbiguous?top.intentId:null,
    ambiguity:{
      isAmbiguous:isAmbiguous,
      reason:isAmbiguous?"top-score-conflict":(top?"resolved":"no-match"),
      candidateIntentIds:isAmbiguous?conflictIntents:[]
    },
    metrics:baseMetrics
  });
}

function inspect(input){
  var result=match(input);
  return deepFreeze({
    input:input===null||input===undefined?"":String(input),
    result:result,
    byteStableSignature:stableStringify(result)
  });
}

var API={
  NORMALIZER_VERSION:NORMALIZER_VERSION,
  LIBRARY_VERSION:LIBRARY_VERSION,
  MAX_INPUT_LENGTH:MAX_INPUT_LENGTH,
  MAX_CANDIDATES:MAX_CANDIDATES,
  normalizeInput:normalizeInput,
  match:match,
  inspect:inspect,
  serializeMatchResult:stableStringify,
  getLibrarySnapshot:function(){return PUBLIC_RULES;}
};
return deepFreeze(API);
});
