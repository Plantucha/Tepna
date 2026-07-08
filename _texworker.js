/* SPDX-License-Identifier: Apache-2.0 — texture-test worker (throwaway) */
'use strict';
(function installDomShim(){
  var stub=new Proxy(function(){},{get:function(t,p){if(p==='outerHTML'||p==='innerHTML')return '';if(p===Symbol.toPrimitive||p==='toString')return function(){return '';};return stub;},set:function(){return true;},apply:function(){return stub;},construct:function(){return stub;},has:function(){return true;}});
  var doc=new Proxy({},{get:function(t,p){if(p==='getElementById'||p==='querySelector'||p==='querySelectorAll'||p==='createElement'||p==='getElementsByClassName'||p==='getElementsByTagName')return function(){return stub;};if(p==='documentElement'||p==='head'||p==='body')return stub;if(p==='addEventListener'||p==='removeEventListener')return function(){};if(p==='cookie')return '';return stub;},set:function(){return true;},has:function(){return true;}});
  self.document=doc; self.window=self;
  if(typeof self.navigator==='undefined') self.navigator={userAgent:'texworker'};
  self.localStorage={getItem:function(){return null;},setItem:function(){},removeItem:function(){}};
  self.matchMedia=function(){return {matches:false,addListener:function(){},removeListener:function(){},addEventListener:function(){}};};
})();
importScripts('synth-gen.js','cohort-gen.js','kernel-constants.js','clock.js','pulsedex-dsp.js');
self.onmessage=function(e){
  const m=e.data||{};
  if(m.type==='job'){
    const outN=[];
    try{
      const pf=CohortGen.patient(m.seed>>>0,{only:['rr']});
      (pf.nights||[]).forEach(nt=>{
        if(!(nt.present&&nt.present.PulseDex&&nt.files&&nt.files.rrText)) return;
        const parsed=parseRRInput(nt.files.rrText); const vals=(parsed&&parsed.vals)||[];
        if(vals.length<40) return;
        const clean=artifactClean(vals).clean;
        const rm=rmssd(clean); let a1=null; try{a1=dfaAlpha1(clean);}catch(_){}
        outN.push([nt.cfg.rmssd, +rm.toFixed(2), a1==null?null:+a1.toFixed(3), clean.length]);
      });
    }catch(err){ self.postMessage({type:'done',reqId:m.reqId,err:String(err)}); return; }
    self.postMessage({type:'done',reqId:m.reqId,nights:outN});
  }
};
self.postMessage({type:'ready'});
