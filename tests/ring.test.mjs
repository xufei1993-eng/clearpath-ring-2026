import {test} from 'node:test';
import assert from 'node:assert/strict';
import {startRingVideo} from '../dist/ring.mjs';

// Behavioral WebRTC/HTTP doubles: no account, credentials, or network requests.
const offer='v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n';
const answer='v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=sendonly\r\n';
const session='/api/ring/stream/test_session';
const flush=()=>new Promise(resolve=>setImmediate(resolve));
function observe(operation){const result={settled:false};operation.then(value=>Object.assign(result,{settled:true,value}),error=>Object.assign(result,{settled:true,error}));return result;}
function streamResponse(){return new Response(answer,{status:201,headers:{Location:session,'Content-Type':'application/sdp'}});}

class TrackedTarget extends EventTarget {
  listeners=new Map();
  addEventListener(type,listener,options){super.addEventListener(type,listener,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type,listener,options){super.removeEventListener(type,listener,options);this.listeners.get(type)?.delete(listener);}
  listenerCount(type){return this.listeners.get(type)?.size||0;}
}

function harness(t,{iceState='complete',postResponse}={}){
  const original={RTCPeerConnection:globalThis.RTCPeerConnection,fetch:globalThis.fetch,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const calls=[],timers=new Map(),peers=[],ended=[];
  let nextTimer=0;
  const track={kind:'video',readyState:'live'},stream={getVideoTracks:()=>[track]};
  class Peer extends TrackedTarget {
    constructor(config){super();this.config=config;this.iceGatheringState=iceState;this.connectionState='new';this.transceivers=[];this.remoteSets=0;this.closeCount=0;peers.push(this);}
    addTransceiver(kind,options){this.transceivers.push({kind,...options});}
    async createOffer(){return {type:'offer',sdp:offer};}
    async setLocalDescription(value){this.localDescription=value;}
    async setRemoteDescription(value){this.remoteSets++;this.remoteDescription=value;this.ontrack?.({streams:[stream],track});}
    setState(state){this.connectionState=state;this.onconnectionstatechange?.();}
    close(){this.closeCount++;this.setState('closed');}
  }
  const video=Object.assign(new TrackedTarget(),{readyState:0,videoWidth:0,videoHeight:0,srcObject:null,play:()=>Promise.resolve()});
  globalThis.RTCPeerConnection=Peer;
  globalThis.fetch=async(path,options)=>{
    calls.push({path,...options});
    if(options.method==='POST')return postResponse?await postResponse:streamResponse();
    return new Response(null,{status:204});
  };
  // Virtual timers prove cancellation settles without advancing 45/18 seconds.
  globalThis.setTimeout=(callback,duration)=>{const id=++nextTimer;timers.set(id,{callback,duration});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const controller=new AbortController();
  const start=(options={})=>startRingVideo('ava1.ring.device.test+value',video,message=>ended.push(message),{signal:controller.signal,...options});
  const frame=()=>{video.readyState=2;video.videoWidth=640;video.videoHeight=360;video.dispatchEvent(new Event('loadeddata'));};
  t.after(()=>{controller.abort();Object.assign(globalThis,original);});
  return {video,stream,track,calls,timers,peers,ended,controller,start,frame};
}

test('WHEP sends a complete receive-only offer and releases a decoded live stream once',async t=>{
  const h=harness(t),operation=h.start();
  await flush();
  const peer=h.peers[0];
  assert.deepEqual(peer.config.iceServers,[{urls:'stun:stun.l.google.com:19302'}]);
  assert.deepEqual(peer.transceivers,[{kind:'video',direction:'recvonly'}]);
  assert.equal(h.calls[0].path,'/api/ring/stream?device_id=ava1.ring.device.test%2Bvalue');
  assert.equal(h.calls[0].body,offer);
  assert.equal(h.calls[0].headers['Content-Type'],'application/sdp');
  assert.deepEqual(peer.remoteDescription,{type:'answer',sdp:answer});
  h.frame();
  const close=await operation;
  assert.equal(h.video.srcObject,h.stream);
  assert.equal(h.timers.size,0);
  assert.equal(h.video.listenerCount('loadeddata'),0);
  await close();await close();
  assert.equal(peer.closeCount,1);
  assert.equal(h.video.srcObject,null);
  assert.equal(h.calls.filter(call=>call.method==='DELETE'&&call.path===session).length,1);
  assert.equal(h.ended.length,0);
});

test('aborting ICE gathering rejects immediately and removes its listener and timeout',async t=>{
  const h=harness(t,{iceState:'gathering'}),result=observe(h.start());
  await flush();
  assert.equal(h.peers[0].listenerCount('icegatheringstatechange'),1);
  assert.deepEqual([...h.timers.values()].map(timer=>timer.duration),[45000]);
  h.controller.abort();await flush();
  assert.equal(result.settled,true);
  assert.equal(result.error?.name,'AbortError');
  assert.equal(h.peers[0].listenerCount('icegatheringstatechange'),0);
  assert.equal(h.timers.size,0);
  assert.equal(h.calls.length,0);
  assert.equal(h.peers[0].closeCount,1);
});

test('aborting first-frame waiting rejects immediately and closes its WHEP session',async t=>{
  const h=harness(t),result=observe(h.start());
  await flush();
  assert.equal(h.video.listenerCount('loadeddata'),1);
  assert.deepEqual([...h.timers.values()].map(timer=>timer.duration),[18000]);
  h.controller.abort();await flush();
  assert.equal(result.settled,true);
  assert.equal(result.error?.name,'AbortError');
  assert.equal(h.video.listenerCount('loadeddata'),0);
  assert.equal(h.timers.size,0);
  assert.equal(h.video.srcObject,null);
  assert.equal(h.calls.filter(call=>call.method==='DELETE').length,1);
});

test('connection failure before the first frame rejects without waiting for the frame timeout',async t=>{
  const h=harness(t),result=observe(h.start());
  await flush();
  h.peers[0].setState('failed');await flush();
  assert.equal(result.settled,true);
  assert.match(result.error?.message,/直播已结束/);
  assert.equal(h.video.listenerCount('loadeddata'),0);
  assert.equal(h.timers.size,0);
  assert.equal(h.ended.length,1);
  assert.equal(h.calls.filter(call=>call.method==='DELETE').length,1);
});

test('a late WHEP response after cancellation is deleted without applying its SDP',async t=>{
  let releaseResponse;
  const postResponse=new Promise(resolve=>{releaseResponse=resolve;});
  const h=harness(t,{postResponse}),result=observe(h.start());
  await flush();
  assert.equal(h.calls[0].method,'POST');
  h.controller.abort();await flush();
  assert.equal(result.settled,true);
  assert.equal(result.error?.name,'AbortError');
  assert.equal(h.calls.filter(call=>call.method==='DELETE').length,0);
  releaseResponse(streamResponse());await flush();
  assert.equal(h.calls.filter(call=>call.method==='DELETE'&&call.path===session).length,1);
  assert.equal(h.peers[0].remoteSets,0);
  assert.equal(h.video.srcObject,null);
  assert.equal(h.timers.size,0);
});

test('zero-size, unrelated, or ended video cannot satisfy the Ring first-frame gate',async t=>{
  const h=harness(t),result=observe(h.start());
  await flush();
  h.video.readyState=2;h.video.dispatchEvent(new Event('loadeddata'));await flush();
  assert.equal(result.settled,false);
  h.video.srcObject={getVideoTracks:()=>[h.track]};h.frame();await flush();
  assert.equal(result.settled,false);
  h.video.srcObject=h.stream;h.track.readyState='ended';h.frame();await flush();
  assert.equal(result.settled,false);
  h.track.readyState='live';h.frame();await flush();
  assert.equal(result.settled,true);
  assert.equal(result.error,undefined);
  await result.value();
});

test('a disconnected stream is closed and cleared before its terminal callback',async t=>{
  const h=harness(t),operation=h.start();
  await flush();h.frame();const close=await operation;
  h.peers[0].setState('disconnected');await flush();
  assert.equal(h.video.srcObject,null);
  assert.equal(h.peers[0].connectionState,'closed');
  assert.equal(h.ended.length,1);
  assert.equal(h.calls.filter(call=>call.method==='DELETE').length,1);
  await close();
  assert.equal(h.peers[0].closeCount,1);
});

test('an explicit empty ICE server list still waits for gathering completion before posting',async t=>{
  const h=harness(t,{iceState:'gathering'}),operation=h.start({iceServers:[]});
  await flush();
  assert.deepEqual(h.peers[0].config.iceServers,[]);
  assert.equal(h.calls.length,0);
  h.peers[0].iceGatheringState='complete';
  h.peers[0].dispatchEvent(new Event('icegatheringstatechange'));await flush();
  assert.equal(h.calls[0].method,'POST');
  h.frame();const close=await operation;await close();
});
