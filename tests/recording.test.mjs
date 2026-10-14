import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import vm from 'node:vm';

const source=readFileSync(new URL('../dist/recording.mjs',import.meta.url),'utf8');

// Exercise the browser module through its public controls. Final recorder events
// are delivered separately from stop(), as in the native MediaRecorder API.
function browserFixture({presentation=true,constructorFails=false,recorderSupported=true}={}){
  const elements=new Map(),recorders=[],streams=[],downloads=[],timers=new Map(),microtasks=[],windowEvents=new Map(),drawn=[],written=[],createdUrls=[],revokedUrls=[];
  let timerId=0,animationId=0,clock=1000;
  const animations=new Map();
  const drawing=new Proxy({measureText:value=>({width:String(value).length*7}),
    fillText:value=>written.push(String(value)),
    drawImage:image=>{assert.ok(['scene','overlay'].includes(image.id),'only actual app canvases may be recorded');drawn.push(image.id);},
  },{get:(target,key)=>target[key]??(()=>{})});
  class Element{
    constructor(tag){this.tagName=tag;this.listeners=new Map();this.children=[];this.textContent='';this.style={};this.dataset={};this.hidden=false;this.disabled=false;this.checked=false;this.width=960;this.height=600;}
    set id(value){this._id=value;elements.set(value,this);} get id(){return this._id;}
    setAttribute(){} removeAttribute(name){delete this[name];} append(...items){this.children.push(...items);} replaceChildren(...items){this.children=items;}
    addEventListener(type,listener){this.listeners.set(type,listener);}
    click(){if(this.disabled)return;if(this.tagName==='a'){downloads.push({name:this.download,href:this.href});return;}this.listeners.get('click')?.({target:this});}
    getContext(){return drawing;}
    captureStream(rate){assert.equal(rate,24);const track={stopped:false,stop(){this.stopped=true;}};const stream={track,getTracks:()=>[track]};streams.push(stream);return stream;}
    toBlob(callback){callback(new Blob(['still'],{type:'image/png'}));}
  }
  for(const id of ['presentation-tools','presentation-mode','scene','overlay','stage-source','frame-time','region-label','assessment-title','assessment-description','metric','overlap-value','ring-message']){const element=new Element('div');element.id=id;}
  elements.get('presentation-mode').checked=presentation;
  elements.get('stage-source').textContent='RING PLAYGROUND — SIMULATED LIVE VIEW';
  elements.get('ring-message').textContent='Received decoded Ring Playground frames.';
  elements.get('assessment-title').textContent='Review the current picture';
  elements.get('assessment-description').textContent='Human review is required.';
  elements.get('metric').hidden=true;
  const assessment={dataset:{state:'uncertain'}};
  class Recorder{
    static isTypeSupported(type){return type.startsWith('video/webm');}
    constructor(stream,options){if(constructorFails)throw new Error('Encoder construction failed');this.stream=stream;this.mimeType=options.mimeType||'video/webm';this.state='inactive';this.stopCalls=0;recorders.push(this);}
    start(){this.state='recording';}
    stop(){this.stopCalls++;this.state='inactive';}
    complete(data='valid-video'){this.state='inactive';if(data!==null)this.ondataavailable?.({data:new Blob([data],{type:this.mimeType})});this.onstop?.();}
    fail(){this.onerror?.({error:new Error('Native encoder failed')});}
  }
  const document={
    getElementById(id){assert.ok(!/token|file-name|ring-device|credentials/.test(id),'recording must not read credentials, device names or filenames');return elements.get(id);},
    createElement:tag=>new Element(tag),
    querySelector(selector){assert.equal(selector,'.assessment');return assessment;},querySelectorAll(selector){assert.equal(selector,'.workflow li');return [];},
  };
  vm.runInNewContext(source,{
    location:{search:presentation?'?presentation=1&lang=en':'?lang=en'},URLSearchParams,document,
    window:{addEventListener:(type,listener)=>windowEvents.set(type,listener)},
    MediaRecorder:recorderSupported?Recorder:undefined,Blob,
    URL:{createObjectURL:()=>{const url=`blob:local-${createdUrls.length}`;createdUrls.push(url);return url;},revokeObjectURL:url=>revokedUrls.push(url)},
    requestAnimationFrame:callback=>{animations.set(++animationId,callback);return animationId;},cancelAnimationFrame:id=>animations.delete(id),
    setTimeout:(callback,delay)=>{timers.set(++timerId,{callback,delay});return timerId;},clearTimeout:id=>timers.delete(id),
    queueMicrotask:callback=>microtasks.push(callback),performance:{now:()=>clock},
    fetch(){throw new Error('recording must never upload or fetch');},
    navigator:{mediaDevices:{getUserMedia(){throw new Error('recording must not request a microphone or another camera');},getDisplayMedia(){throw new Error('recording must not capture other apps');}}},
  },{filename:'recording.mjs'});
  return {
    elements,recorders,streams,downloads,timers,drawn,written,assessment,animations,createdUrls,revokedUrls,
    start:()=>elements.get('record-presentation').click(),stop:()=>elements.get('stop-presentation').click(),
    leave:()=>windowEvents.get('pagehide')(),
    render(){const [id,callback]=animations.entries().next().value;animations.delete(id);clock+=150;callback(clock);},
    flushMicrotasks(){while(microtasks.length)microtasks.shift()();},
    get status(){return elements.get('recording-status').textContent;},
  };
}

test('ordinary URL initializes usable tools before presentation mode is enabled',()=>{
  const browser=browserFixture({presentation:false});
  assert.ok(browser.elements.get('record-presentation'));
  assert.equal(browser.elements.get('presentation-tools').hidden,true);
  browser.elements.get('presentation-tools').hidden=false;browser.render();browser.start();
  assert.equal(browser.recorders.length,1);
  assert.ok(browser.drawn.includes('scene'));assert.ok(browser.drawn.includes('overlay'));
});

test('successful final data stays ready until the public download link is explicitly clicked',()=>{
  const browser=browserFixture();browser.start();const recorder=browser.recorders[0];browser.stop();
  assert.equal(browser.elements.get('record-presentation').disabled,true,'wait for final native events before starting another session');
  assert.equal(browser.downloads.length,0);recorder.complete();
  const link=browser.elements.get('download-presentation');
  assert.equal(browser.downloads.length,0);assert.equal(link.hidden,false);assert.match(link.download,/\.webm$/);
  assert.match(browser.status,/Recording ready/);assert.equal(browser.streams[0].track.stopped,true);
  recorder.complete('duplicate-final-event');assert.equal(browser.createdUrls.length,1);
  assert.equal(browser.downloads.length,0);link.click();assert.equal(browser.downloads.length,1);
});

test('native failure followed by final video data never becomes a successful export',()=>{
  const browser=browserFixture();browser.start();const recorder=browser.recorders[0];recorder.fail();
  assert.equal(browser.elements.get('record-presentation').disabled,true);
  recorder.complete('partial-video');assert.equal(browser.downloads.length,0);
  assert.equal(browser.elements.get('download-presentation').hidden,true);
  assert.match(browser.status,/did not complete/);assert.equal(browser.streams[0].track.stopped,true);
  assert.equal(browser.elements.get('record-presentation').disabled,false);
});

test('an empty recorder result does not claim that a recording was saved',()=>{
  const browser=browserFixture();browser.start();browser.stop();browser.recorders[0].complete('');
  assert.equal(browser.downloads.length,0);assert.match(browser.status,/No recording was exported/);
  assert.equal(browser.elements.get('download-presentation').hidden,true);
});

test('page departure abandons pending output and releases the stream and timeout',()=>{
  const browser=browserFixture();browser.start();browser.leave();
  assert.equal(browser.recorders[0].stopCalls,1);assert.equal(browser.streams[0].track.stopped,true);
  assert.equal(browser.timers.size,0);assert.equal(browser.animations.size,0);
  browser.recorders[0].complete('late-final-data');assert.equal(browser.downloads.length,0);
  assert.equal(browser.elements.get('download-presentation').hidden,true);
  assert.doesNotMatch(browser.status,/Recording ready/);
});

test('a late final event from a failed session cannot corrupt its replacement',()=>{
  const browser=browserFixture();browser.start();const failed=browser.recorders[0];
  failed.fail();failed.complete('partial');browser.start();const replacement=browser.recorders[1];
  failed.complete('very-late-data');assert.equal(browser.downloads.length,0);
  assert.equal(replacement.state,'recording');assert.equal(browser.streams[1].track.stopped,false);
  browser.stop();replacement.complete('replacement-video');assert.equal(browser.downloads.length,0);
  browser.elements.get('download-presentation').click();assert.equal(browser.downloads.length,1);
});

test('automatic stop reserves a margin below the three minute export limit',()=>{
  const browser=browserFixture();browser.start();
  const deadline=[...browser.timers.values()].find(timer=>timer.delay>=100000);
  assert.ok(deadline&&deadline.delay<=170000,'leave at least ten seconds for final media events and editing');
  deadline.callback();assert.equal(browser.recorders[0].stopCalls,1);
  browser.recorders[0].complete();assert.equal(browser.downloads.length,0);
  assert.equal(browser.elements.get('download-presentation').hidden,false);
  browser.elements.get('download-presentation').click();assert.equal(browser.downloads.length,1);
});

test('a ready download persists without a revoke timeout until a successful replacement',()=>{
  const browser=browserFixture();browser.start();browser.stop();browser.recorders[0].complete();
  const link=browser.elements.get('download-presentation'),firstUrl=link.href;
  assert.equal(browser.timers.size,0,'finished recording has no delayed Blob revocation');
  assert.deepEqual(browser.revokedUrls,[]);browser.start();
  assert.equal(link.href,firstUrl,'starting a new attempt preserves the last complete recording');
  browser.stop();browser.recorders[1].complete('second-recording');
  assert.notEqual(link.href,firstUrl);assert.deepEqual(browser.revokedUrls,[firstUrl]);
  assert.equal(browser.downloads.length,0);link.click();assert.equal(browser.downloads.length,1);
});

test('failure and delayed old events cannot replace the previous valid download',()=>{
  const browser=browserFixture();browser.start();browser.stop();const good=browser.recorders[0];good.complete();
  const link=browser.elements.get('download-presentation'),goodUrl=link.href;
  browser.start();const failed=browser.recorders[1];failed.fail();failed.complete('partial');good.complete('late-good');
  assert.equal(link.href,goodUrl);assert.equal(link.hidden,false);assert.deepEqual(browser.revokedUrls,[]);
  assert.equal(browser.createdUrls.length,1);assert.equal(browser.downloads.length,0);
});

test('page departure revokes and removes the completed download link',()=>{
  const browser=browserFixture();browser.start();browser.stop();browser.recorders[0].complete();
  const link=browser.elements.get('download-presentation'),url=link.href;browser.leave();
  assert.deepEqual(browser.revokedUrls,[url]);assert.equal(link.hidden,true);assert.equal(link.href,undefined);
});

test('saving a still remains an immediate explicit-click download',()=>{
  const browser=browserFixture();browser.elements.get('save-presentation-still').click();
  assert.equal(browser.downloads.length,1);assert.match(browser.downloads[0].name,/\.png$/);
  assert.equal(browser.elements.get('download-presentation').hidden,true);
});

test('encoder construction failure releases the already acquired canvas stream',()=>{
  const browser=browserFixture({constructorFails:true});browser.start();
  assert.equal(browser.streams.length,1);assert.equal(browser.streams[0].track.stopped,true);
  assert.equal(browser.downloads.length,0);assert.equal(browser.elements.get('record-presentation').disabled,false);
});

test('unsupported recording does not request capture or announce success',()=>{
  const browser=browserFixture({recorderSupported:false});browser.start();
  assert.equal(browser.streams.length,0);assert.equal(browser.downloads.length,0);
  assert.match(browser.status,/does not support local recording/);
});

test('rendering preserves the actual source label and keeps synthetic footage explicit',()=>{
  const browser=browserFixture();browser.written.length=0;
  browser.elements.get('stage-source').textContent='SYNTHETIC SAMPLE — NOT RING';browser.render();
  assert.ok(browser.written.some(text=>text.includes('SYNTHETIC SAMPLE')));
  assert.ok(browser.written.join(' ').includes('NOT REAL-WORLD EVIDENCE'));
  assert.ok(browser.drawn.every(id=>['scene','overlay'].includes(id)));
});
