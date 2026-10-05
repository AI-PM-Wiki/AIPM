(function(){"use strict";var ANNO_API_BASE=location.hostname==="localhost"||location.hostname==="127.0.0.1"?"http://127.0.0.1:8788":"https://anno-api.nvc.ac";var PALETTE=[{id:"yellow",label:"重点",when:"值得记住的重点内容",key:"1"},{id:"green",label:"定义",when:"定义与术语的界定",key:"2"},{id:"blue",label:"结论",when:"关键结论与判断",key:"3"},{id:"pink",label:"数据",when:"数据、指标与事实",key:"4"},{id:"purple",label:"警示",when:"坑、风险与注意事项",key:"5"}];var DEFAULT_COLOR="yellow";var K_LOCAL="aipm-anno-local";var K_MAP="aipm-anno-map";var K_DRAFT="aipm-anno-draft";var K_LAST_COLOR="aipm-anno-last-color";var K_PREFS="aipm-anno-prefs";var K_SMART="aipm-anno-smart";var ANNO_STYLES=["underline","highlight","both"];var DEFAULT_STYLE="highlight";var COMMENT_SORTS=["hot","newest"];var LOCAL_WARN_BYTES=3*1024*1024;function QuotaError(message){this.name="QuotaError";this.message=message;}
QuotaError.prototype=Object.create(Error.prototype);function readJson(key,fallback){try{var raw=localStorage.getItem(key);if(!raw)return fallback;var parsed=JSON.parse(raw);return parsed===null||parsed===undefined?fallback:parsed;}catch(e){return fallback;}}
function writeJson(key,value){var text=JSON.stringify(value);try{localStorage.setItem(key,text);}catch(e){throw new QuotaError("浏览器本地存储已满,这条「仅本机」批注没能保存。请打开面板导出 JSON 备份后清理旧批注。");}
return text.length;}
function uid(){if(window.crypto&&window.crypto.randomUUID)return window.crypto.randomUUID();return"l-"+Date.now().toString(36)+"-"+Math.random().toString(36).slice(2,10);}
function request(path,opts){opts=opts||{};var headers={Accept:"application/json"};if(opts.body!==undefined)headers["Content-Type"]="application/json";if(opts.token)headers.Authorization="Bearer "+opts.token;return fetch(ANNO_API_BASE+path,{method:opts.method||"GET",headers:headers,body:opts.body===undefined?undefined:JSON.stringify(opts.body)}).then(function(res){return res.text().then(function(text){var body=null;try{body=text?JSON.parse(text):null;}catch(e){body=null;}
return{ok:res.ok,status:res.status,body:body,headers:res.headers};});}).catch(function(){return{ok:false,status:0,body:{error:"network"},headers:null};});}
function loadLocalAll(){var data=readJson(K_LOCAL,null);if(!data||typeof data!=="object"||typeof data.pages!=="object"){return{version:1,pages:{}};}
return data;}
function localList(page){var all=loadLocalAll();var list=all.pages[page];return Array.isArray(list)?list.slice():[];}
function saveLocalPage(page,list){var all=loadLocalAll();if(list.length===0)delete all.pages[page];else all.pages[page]=list;return writeJson(K_LOCAL,all);}
function localBytes(){try{return(localStorage.getItem(K_LOCAL)||"").length;}catch(e){return 0;}}
function localAdd(anno){var list=localList(anno.page);list.push(anno);saveLocalPage(anno.page,list);return anno;}
function localUpdate(page,id,patch){var list=localList(page);var found=null;var next=list.map(function(a){if(a.id!==id)return a;found=Object.assign({},a,patch,{updatedAt:new Date().toISOString()});return found;});if(found===null)return null;saveLocalPage(page,next);return found;}
function localRemove(page,id){var list=localList(page);var next=list.filter(function(a){return a.id!==id;});if(next.length===list.length)return false;saveLocalPage(page,next);forgetServerId(id);return true;}
function loadMap(){var m=readJson(K_MAP,{});return m&&typeof m==="object"?m:{};}
function rememberServerId(localId,serverId){var m=loadMap();m[localId]=serverId;writeJson(K_MAP,m);}
function serverIdOf(localId){return loadMap()[localId]||null;}
function forgetServerId(localId){var m=loadMap();if(m[localId]===undefined)return;delete m[localId];writeJson(K_MAP,m);}
function saveDraft(draft){try{writeJson(K_DRAFT,Object.assign({},draft,{savedAt:new Date().toISOString()}));}catch(e){}}
function peekDraft(){return readJson(K_DRAFT,null);}
function clearDraft(){try{localStorage.removeItem(K_DRAFT);}catch(e){}}
function lastColor(){var c=null;try{c=localStorage.getItem(K_LAST_COLOR);}catch(e){c=null;}
return PALETTE.some(function(p){return p.id===c;})?c:DEFAULT_COLOR;}
function setLastColor(id){try{localStorage.setItem(K_LAST_COLOR,id);}catch(e){}}
function prefs(){var p=readJson(K_PREFS,{});return{showLocal:p.showLocal!==false,showPrivate:p.showPrivate!==false,showPublic:p.showPublic!==false,showCommentsLocal:p.showCommentsLocal!==false,showCommentsPrivate:p.showCommentsPrivate!==false,showCommentsPublic:p.showCommentsPublic!==false,collapsedLocal:p.collapsedLocal===true,collapsedPrivate:p.collapsedPrivate===true,collapsedPublic:p.collapsedPublic===true,commentSort:COMMENT_SORTS.indexOf(p.commentSort)>=0?p.commentSort:"hot",lastStyle:ANNO_STYLES.indexOf(p.lastStyle)>=0?p.lastStyle:DEFAULT_STYLE};}
function setPrefs(patch){writeJson(K_PREFS,Object.assign(prefs(),patch));}
function smartState(){var s=readJson(K_SMART,null);if(!s||typeof s!=="object"||!s.pages||typeof s.pages!=="object"){return{version:1,pages:{}};}
return s;}
function smartDone(page){return Object.prototype.hasOwnProperty.call(smartState().pages,page);}
function markSmartDone(page){var state=smartState();state.pages[page]=new Date().toISOString();try{writeJson(K_SMART,state);}catch(e){}}
function exportPayload(){return{format:"aipm-annotations-local",version:1,exportedAt:new Date().toISOString(),pages:loadLocalAll().pages};}
function importPayload(text){var data=JSON.parse(text);if(!data||typeof data.pages!=="object")throw new Error("不是本机批注的导出文件");var all=loadLocalAll();var added=0;Object.keys(data.pages).forEach(function(page){var incoming=Array.isArray(data.pages[page])?data.pages[page]:[];var existing=Array.isArray(all.pages[page])?all.pages[page]:[];var ids={};existing.forEach(function(a){ids[a.id]=true;});incoming.forEach(function(a){if(!a||typeof a.id!=="string"||ids[a.id])return;existing.push(a);added++;});all.pages[page]=existing;});writeJson(K_LOCAL,all);return added;}
window.__aipmAnnoStore={ANNO_API_BASE:ANNO_API_BASE,PALETTE:PALETTE,DEFAULT_COLOR:DEFAULT_COLOR,QuotaError:QuotaError,LOCAL_WARN_BYTES:LOCAL_WARN_BYTES,request:request,uid:uid,localList:localList,localAdd:localAdd,localUpdate:localUpdate,localRemove:localRemove,localBytes:localBytes,rememberServerId:rememberServerId,serverIdOf:serverIdOf,forgetServerId:forgetServerId,saveDraft:saveDraft,peekDraft:peekDraft,clearDraft:clearDraft,ANNO_STYLES:ANNO_STYLES,DEFAULT_STYLE:DEFAULT_STYLE,COMMENT_SORTS:COMMENT_SORTS,lastColor:lastColor,setLastColor:setLastColor,prefs:prefs,setPrefs:setPrefs,smartDone:smartDone,markSmartDone:markSmartDone,exportPayload:exportPayload,importPayload:importPayload};})();