(function(){"use strict";var store=window.__aipmAnnoStore;var K_AUTH="aipm-anno-auth";var CODE_PARAM="aipm_auth_code";var session=null;var listeners=[];var mePromise=null;function readSession(){try{var raw=localStorage.getItem(K_AUTH);if(!raw)return null;var parsed=JSON.parse(raw);if(!parsed||typeof parsed.token!=="string"||!parsed.user)return null;return parsed;}catch(e){return null;}}
function writeSession(next){session=next;try{if(next===null)localStorage.removeItem(K_AUTH);else localStorage.setItem(K_AUTH,JSON.stringify(next));}catch(e){}
notify();}
function notify(){listeners.forEach(function(cb){try{cb(user());}catch(e){}});}
function token(){return session?session.token:null;}
function user(){return session?session.user:null;}
function isLoggedIn(){return session!==null;}
var ADMIN_LOGINS=["huangyincan"];function isAdmin(){if(session===null)return false;if(session.admin===true)return true;var login=session.user&&session.user.login;return typeof login==="string"&&ADMIN_LOGINS.indexOf(login.toLowerCase())!==-1;}
function onChange(cb){listeners.push(cb);return function(){var i=listeners.indexOf(cb);if(i!==-1)listeners.splice(i,1);};}
function forget(){writeSession(null);mePromise=null;}
function consumeAuthCode(){var url=new URL(location.href);var code=url.searchParams.get(CODE_PARAM);if(!code)return Promise.resolve(false);url.searchParams.delete(CODE_PARAM);try{history.replaceState(history.state,"",url.toString());}catch(e){}
return store.request("/api/auth/session",{method:"POST",body:{code:code}}).then(function(res){if(!res.ok||!res.body||!res.body.token)return false;writeSession({token:res.body.token,user:res.body.user,admin:res.body.admin===true});return true;});}
function ready(){session=readSession();return consumeAuthCode().then(function(){if(session===null)return null;if(mePromise===null){mePromise=store.request("/api/auth/me",{token:session.token}).then(function(res){if(res.status===401){forget();return null;}
if(res.ok&&res.body&&res.body.user){writeSession({token:session.token,user:res.body.user,admin:res.body.admin===true});return res.body.user;}
return session.user;});}
return mePromise;}).then(function(){return user();});}
function login(returnTo){var target=returnTo||location.href;location.assign(store.ANNO_API_BASE+"/api/auth/github/start?return="+
encodeURIComponent(target));}
function logout(){var t=token();var done=function(){forget();};if(t===null){done();return Promise.resolve();}
return store.request("/api/auth/logout",{method:"POST",token:t}).then(done,done);}
function loginForDraft(draft){if(draft)store.saveDraft(draft);login(location.href);}
window.__aipmAnnoAuth={ready:ready,token:token,user:user,isLoggedIn:isLoggedIn,isAdmin:isAdmin,onChange:onChange,login:login,loginForDraft:loginForDraft,logout:logout,forget:forget,CODE_PARAM:CODE_PARAM};})();