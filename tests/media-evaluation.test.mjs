import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {captureVideoFrames} from '../dist/media-evaluation.mjs';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const observe=operation=>{const result={settled:false};operation.then(value=>Object.assign(result,{settled:true,value}),error=>Object.assign(result,{settled:true,error}));return result;};
const targets={reference:1,occupied:5,cleared:10};
const bytes=new TextEncoder().encode('local-video-test');
const file=()=>new File([bytes],'phone.MOV',{type:'video/quicktime'});

class TrackedTarget extends EventTarget {
  listeners=new Map();
  addEventListener(type,listener,options){super.addEventListener(type,listener,options);if(!this.listeners.has(type))this.listeners.set(type,new Set());this.listeners.get(type).add(listener);}
  removeEventListener(type,listener,options){super.removeEventListener(type,listener,options);this.listeners.get(type)?.delete(listener);}
  listenerCount(){return [...this.listeners.values()].reduce((total,items)=>total+items.size,0);}
}

function harness(t,behavior={}){
  const original={document:globalThis.document,window:globalThis.window,setTimeout:globalThis.setTimeout,clearTimeout:globalThis.clearTimeout};
  const urlOriginal={createObjectURL:URL.createObjectURL,revokeObjectURL:URL.revokeObjectURL};
  const timers=new Map(),created=[],revoked=[],captures=[],progress=[];
  let timerId=0;
  class Video extends TrackedTarget {
    src='';srcObject=null;readyState=0;videoWidth=0;videoHeight=0;duration=NaN;seeking=false;_time=0;frameTime=0;pauseCount=0;
    pause(){this.pauseCount++;}
    get currentTime(){return this._time;}
    set currentTime(value){
      this._time=value;this.seeking=true;
      if(behavior.seekMode==='hang')return;
      queueMicrotask(()=>{this._time=value+(behavior.seekOffset||0);this.frameTime=this._time;this.seeking=false;this.dispatchEvent(new Event('seeked'));});
    }
    load(){
      if(!this.src){this.readyState=0;this.videoWidth=0;this.videoHeight=0;return;}
      if(behavior.loadMode==='hang')return;
      queueMicrotask(()=>{
        if(behavior.loadMode==='error'){this.error={code:4};this.dispatchEvent(new Event('error'));return;}
        this.readyState=2;this.videoWidth=behavior.width||1080;this.videoHeight=behavior.height||1920;
        this.duration=behavior.duration??24.175;this._time=0;this.frameTime=0;
        this.dispatchEvent(new Event('loadeddata'));
      });
    }
    removeAttribute(name){if(name==='src')this.src='';}
  }
  const video=new Video(),page=new TrackedTarget(),controller=new AbortController();
  globalThis.window=page;
  globalThis.document={createElement(tag){
    assert.equal(tag,'canvas');
    const canvas={width:0,height:0,time:null,getContext(){return {
      drawImage(source){canvas.time=source.frameTime;captures.push({time:canvas.time,width:canvas.width,height:canvas.height});},
      getImageData(){const data=new Uint8ClampedArray(canvas.width*canvas.height*4);data[0]=Math.round(canvas.time*10);return {data,width:canvas.width,height:canvas.height};},
    };},toDataURL(type,quality){assert.equal(type,'image/jpeg');assert.equal(quality,0.82);return 'data:image/jpeg;base64,'+Buffer.from(`${canvas.width}x${canvas.height}@${canvas.time}`).toString('base64');}};
    return canvas;
  }};
  URL.createObjectURL=selected=>{created.push(selected);return 'blob:local-evaluation-test';};
  URL.revokeObjectURL=url=>revoked.push(url);
  globalThis.setTimeout=(callback,duration)=>{const id=++timerId;timers.set(id,{callback,duration});return id;};
  globalThis.clearTimeout=id=>timers.delete(id);
  const start=(selected=file(),times=targets,options={})=>captureVideoFrames(selected,times,video,{signal:controller.signal,onProgress:value=>progress.push(value),...options});
  const fireTimeout=duration=>{const timer=[...timers.values()].find(item=>item.duration===duration);assert.ok(timer,`missing ${duration}ms timer`);timer.callback();};
  t.after(()=>{controller.abort();Object.assign(globalThis,original);Object.assign(URL,urlOriginal);});
  return {video,page,controller,created,revoked,timers,captures,progress,start,fireTimeout};
}

test('captures decoded seeked frames using displayed portrait dimensions and hashes original bytes',async t=>{
  const h=harness(t,{seekOffset:0.02});
  const result=await h.start();
  assert.deepEqual(result.originalSize,{width:1080,height:1920});
  assert.equal(result.duration,24.175);
  assert.deepEqual(result.mediaTimes,{reference:1.02,occupied:5.02,cleared:10.02});
  for(const [index,name] of ['reference','occupied','cleared'].entries()){
    assert.equal(result.frames[name].width,240);assert.equal(result.frames[name].height,427);
    assert.ok(result.frames[name].data instanceof Uint8ClampedArray);
    assert.equal(result.frames[name].data[0],[10,50,100][index]);
    const preview=Buffer.from(result.previews[name].split(',')[1],'base64').toString();
    assert.equal(preview,`640x1138@${result.mediaTimes[name]}`);
  }
  assert.equal(result.fileSha256,createHash('sha256').update(bytes).digest('hex'));
  assert.deepEqual(h.captures.map(item=>item.time),[1.02,1.02,5.02,5.02,10.02,10.02]);
  assert.equal(h.progress.at(-1).stage,'complete');
  assert.equal(h.video.src,'');assert.equal(h.video.srcObject,null);
  assert.deepEqual(h.revoked,['blob:local-evaluation-test']);
  assert.equal(h.video.listenerCount(),0);assert.equal(h.page.listenerCount(),0);assert.equal(h.timers.size,0);
});

test('zero reference time uses the loaded first frame without waiting for an impossible seek event',async t=>{
  const h=harness(t),result=await h.start(file(),{reference:0,occupied:2,cleared:4},{analysisWidth:320});
  assert.equal(result.mediaTimes.reference,0);
  assert.equal(result.frames.reference.width,320);assert.equal(result.frames.reference.height,569);
  assert.equal(result.frames.reference.data[0],0);
});

test('invalid and unordered times are rejected before creating a media URL',async t=>{
  const h=harness(t);
  for(const times of [null,[],{reference:-1,occupied:2,cleared:3},{reference:1,occupied:1,cleared:3},{reference:3,occupied:2,cleared:1},{reference:0,occupied:NaN,cleared:3},{reference:0,occupied:2,cleared:Infinity},{reference:'0',occupied:2,cleared:3}])await assert.rejects(h.start(file(),times));
  assert.equal(h.created.length,0);
});

test('a time equal to duration is rejected and loaded media is released',async t=>{
  const h=harness(t,{duration:10});
  await assert.rejects(h.start(file(),{reference:0,occupied:5,cleared:10}),/小于视频时长/);
  assert.equal(h.captures.length,0);assert.equal(h.revoked.length,1);
  assert.equal(h.video.listenerCount(),0);assert.equal(h.timers.size,0);
});

test('oversized or empty files are rejected without reading bytes or loading media',async t=>{
  const h=harness(t);
  class OversizedFile extends File {get size(){return 250*1024*1024+1;}async arrayBuffer(){throw new Error('must not read');}}
  await assert.rejects(h.start(new OversizedFile(['x'],'large.mov')),/250 MiB/);
  await assert.rejects(h.start(new File([],'empty.mov')),/为空/);
  assert.equal(h.created.length,0);
});

test('unsupported HEVC MOV decode errors include a local H264 conversion path',async t=>{
  const h=harness(t,{loadMode:'error'});
  await assert.rejects(h.start(),/在本机转换为 H.264 MP4/);
  assert.equal(h.revoked.length,1);assert.equal(h.video.src,'');
  assert.equal(h.video.listenerCount(),0);assert.equal(h.timers.size,0);
});

test('load timeout rejects and removes event handlers and its object URL',async t=>{
  const h=harness(t,{loadMode:'hang'}),result=observe(h.start());
  await flush();h.fireTimeout(20000);await flush();
  assert.equal(result.settled,true);assert.match(result.error.message,/20 秒/);
  assert.equal(h.video.listenerCount(),0);assert.equal(h.timers.size,0);assert.equal(h.revoked.length,1);
});

test('aborting a seek rejects immediately without capturing an old frame',async t=>{
  const h=harness(t,{seekMode:'hang'}),result=observe(h.start());
  await flush();assert.ok([...h.timers.values()].some(item=>item.duration===15000));
  h.controller.abort();await flush();
  assert.equal(result.settled,true);assert.equal(result.error.name,'AbortError');
  assert.equal(h.captures.length,0);assert.equal(h.video.listenerCount(),0);assert.equal(h.timers.size,0);
  assert.equal(h.revoked.length,1);
});

test('page departure aborts pending loading and unregisters page and media listeners',async t=>{
  const h=harness(t,{loadMode:'hang'}),result=observe(h.start());
  await flush();h.page.dispatchEvent(new Event('pagehide'));await flush();
  assert.equal(result.settled,true);assert.equal(result.error.name,'AbortError');
  assert.equal(h.video.listenerCount(),0);assert.equal(h.page.listenerCount(),0);
  assert.equal(h.timers.size,0);assert.equal(h.revoked.length,1);
});

test('cancellation during an unresolved local byte read settles before the hash timeout',async t=>{
  const h=harness(t);
  class PendingFile extends File {arrayBuffer(){return new Promise(()=>{});}}
  const result=observe(h.start(new PendingFile(['x'],'pending.mov')));
  await flush();assert.equal(h.progress.at(-1).stage,'hashing');
  h.controller.abort();await flush();
  assert.equal(result.settled,true);assert.equal(result.error.name,'AbortError');
  assert.equal(h.timers.size,0);assert.equal(h.revoked.length,1);
});

test('extreme aspect ratios and invalid analysis widths fail without producing evidence frames',async t=>{
  const h=harness(t,{width:10000,height:100});
  await assert.rejects(h.start(),/宽高比过于极端/);
  assert.equal(h.captures.length,0);assert.equal(h.revoked.length,1);
  for(const analysisWidth of [0,31,1025,240.5,NaN])await assert.rejects(h.start(file(),targets,{analysisWidth}),/分析宽度/);
});
