import test from 'node:test';
import assert from 'node:assert/strict';
import {projectPoint,localRegistrationIdentity,analyzeLocalPair} from '../dist/local-registration.mjs';

test('identity projection keeps the calibrated normalized point',()=>{
  assert.deepEqual(projectPoint({x:.2,y:.6},[1,0,0,0,1,0,0,0,1],640,1138),{x:.2,y:.6});
});
test('pixel translation maps into the original current image dimensions',()=>{
  const mapped=projectPoint({x:.25,y:.5},[1,0,32,0,1,-57,0,0,1],640,1140);
  assert.ok(Math.abs(mapped.x-.3)<1e-12);assert.ok(Math.abs(mapped.y-.45)<1e-12);
});
test('perspective mapping uses the homogeneous denominator',()=>{
  const p=projectPoint({x:.5,y:.25},[1,0,0,0,1,0,.001,0,1],640,1000);
  assert.ok(Math.abs(p.x-(.5/1.32))<1e-12);assert.ok(Math.abs(p.y-(.25/1.32))<1e-12);
});
test('a vanishing or nonfinite projection cannot become evidence coordinates',()=>{
  assert.throws(()=>projectPoint({x:.5,y:.25},[1,0,0,0,1,0,0,0,0],640,1000));
  assert.throws(()=>projectPoint({x:.5,y:.25},[1,0,0,0,1,0,NaN,0,1],640,1000));
});
test('hosted pages cannot send local image data to a registration endpoint',async()=>{
  const oldLocation=globalThis.location,oldFetch=globalThis.fetch;let calls=0;
  globalThis.location={hostname:'clearpath.example.com'};globalThis.fetch=()=>{calls++;throw new Error('network must not be used');};
  try{
    assert.equal((await localRegistrationIdentity()).reason,'local_only');
    const data=new Uint8ClampedArray(64*64*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=120;data[i+3]=255;}
    const frame={data,width:64,height:64},polygon=[{x:.2,y:.2},{x:.8,y:.2},{x:.8,y:.8},{x:.2,y:.8}];
    const assessment=await analyzeLocalPair(frame,frame,polygon,{referencePreview:'data:image/jpeg;base64,PRIVATE_REFERENCE',currentPreview:'data:image/jpeg;base64,PRIVATE_CURRENT'});
    assert.equal(assessment.status,'clear');assert.equal(calls,0);
  }finally{if(oldLocation===undefined)delete globalThis.location;else globalThis.location=oldLocation;globalThis.fetch=oldFetch;}
});

function uncertainPair(){
  const width=160,height=90,make=color=>{const data=new Uint8ClampedArray(width*height*4);for(let i=0;i<data.length;i+=4)data.set([...color,255],i);return {width,height,data};};
  return [make([150,150,150]),make([230,125,140]),[{x:.3,y:.2},{x:.7,y:.2},{x:.7,y:.95},{x:.3,y:.95}]];
}
const identity={available:true,sourceSha256:'source-A',protocolSha256:'protocol-A'};
const previews={referencePreview:'data:image/jpeg;base64,PRIVATE_REFERENCE',currentPreview:'data:image/jpeg;base64,PRIVATE_CURRENT',expectedIdentity:identity};
function localContext(t,fetcher){
  const old=globalThis.location;globalThis.location={hostname:'127.0.0.1'};
  t.after(()=>{if(old===undefined)delete globalThis.location;else globalThis.location=old;});
  t.mock.method(globalThis,'fetch',fetcher);
}
test('status and frame requests reject redirects and pin the advertised identity',async t=>{
  const requests=[];localContext(t,async(url,options)=>{requests.push({url,options});return {ok:true,json:async()=>url.endsWith('/status')?identity:{...identity,accepted:false,reason:'insufficient_matches'}};});
  assert.deepEqual(await localRegistrationIdentity(),identity);
  const result=await analyzeLocalPair(...uncertainPair(),previews);
  assert.equal(result.localRegistration.reason,'insufficient_matches');
  assert.equal(requests.length,2);for(const request of requests)assert.equal(request.options.redirect,'error');
});
test('a backend change between status and the first frame response is a hard error',async t=>{
  localContext(t,async()=>({ok:true,json:async()=>({...identity,sourceSha256:'source-B',accepted:false})}));
  await assert.rejects(analyzeLocalPair(...uncertainPair(),previews),{name:'BackendIdentityError'});
});
test('a missing backend fingerprint cannot start image processing',async t=>{
  let calls=0;localContext(t,async()=>{calls++;throw new Error('must not send');});
  await assert.rejects(analyzeLocalPair(...uncertainPair(),{...previews,expectedIdentity:{available:true}}),{name:'BackendIdentityError'});
  assert.equal(calls,0);
});
test('an unavailable optional backend preserves uncertainty without sending frames',async t=>{
  let calls=0;localContext(t,async()=>{calls++;throw new Error('must not send');});
  const result=await analyzeLocalPair(...uncertainPair(),{...previews,expectedIdentity:{available:false}});
  assert.equal(result.status,'uncertain');assert.equal(result.localRegistration.reason,'local_unavailable');assert.equal(calls,0);
});
test('an internal processing deadline becomes an explicit uncertain result',async t=>{
  localContext(t,(_url,{signal})=>new Promise((_resolve,reject)=>signal.addEventListener('abort',()=>reject(new DOMException('timed out','AbortError')),{once:true})));
  t.mock.method(globalThis,'setTimeout',fn=>{queueMicrotask(fn);return 0;});
  const result=await analyzeLocalPair(...uncertainPair(),previews);
  assert.equal(result.status,'uncertain');assert.equal(result.localRegistration.reason,'local_timeout');
});
test('external cancellation discards a pending result',async t=>{
  const controller=new AbortController();
  localContext(t,(_url,{signal})=>new Promise((_resolve,reject)=>{signal.addEventListener('abort',()=>reject(new DOMException('cancelled','AbortError')),{once:true});queueMicrotask(()=>controller.abort());}));
  await assert.rejects(analyzeLocalPair(...uncertainPair(),{...previews,signal:controller.signal}),{name:'AbortError'});
});

test('an already cancelled browser-only phase cannot return clear or make a status request',async t=>{
  let calls=0;localContext(t,async()=>{calls++;throw new Error('cancelled work must not make requests');});
  const controller=new AbortController();controller.abort();
  const [reference,,polygon]=uncertainPair();
  await assert.rejects(analyzeLocalPair(reference,reference,polygon,{signal:controller.signal}),{name:'AbortError'});
  await assert.rejects(localRegistrationIdentity({signal:controller.signal}),{name:'AbortError'});
  assert.equal(calls,0);
});

test('accepted results require the frozen OpenCV version, including rejecting a missing version',async t=>{
  let registration;
  localContext(t,async()=>({ok:true,json:async()=>registration}));
  for(const diagnostics of [{opencvVersion:'4.changed'},{}]){
    registration={...identity,accepted:true,diagnostics};
    await assert.rejects(analyzeLocalPair(...uncertainPair(),{...previews,expectedIdentity:{...identity,version:'4.frozen'}}),{name:'BackendIdentityError'});
  }
});

const referencePng='data:image/png;base64,REFERENCE_FIXTURE';
const currentPng='data:image/png;base64,CURRENT_FIXTURE';
function solidFrame(width,height,color=[150,150,150]){
  const data=new Uint8ClampedArray(width*height*4);
  for(let index=0;index<data.length;index+=4)data.set([...color,255],index);
  return {data,width,height};
}
function v3Pair(height=135){
  const polygon=[{x:.3,y:.2},{x:.7,y:.2},{x:.7,y:.95},{x:.3,y:.95}];
  return [solidFrame(240,height),solidFrame(240,height,[230,125,140]),polygon];
}
function pngContext(t,reference,current){
  const oldImage=globalThis.Image,oldDocument=globalThis.document,draws=[];
  const frames=new Map([[referencePng,reference],[currentPng,current]]);
  globalThis.Image=class {
    set src(value){this.frame=frames.get(value);assert.ok(this.frame,'unexpected fixture image');this.naturalWidth=this.frame.width;this.naturalHeight=this.frame.height;queueMicrotask(()=>this.onload?.());}
  };
  globalThis.document={createElement(type){
    assert.equal(type,'canvas');
    const canvas={width:0,height:0};let image;
    canvas.getContext=()=>({
      drawImage(source,x,y,width,height){
        assert.equal(x,0);assert.equal(y,0);
        assert.equal(width,source.naturalWidth,'accepted PNG must not be resized');
        assert.equal(height,source.naturalHeight,'accepted PNG must not be resized');
        assert.equal(canvas.width,width);assert.equal(canvas.height,height);
        image=source;draws.push({width,height});
      },
      getImageData(){return {data:new Uint8ClampedArray(image.frame.data),width:canvas.width,height:canvas.height};},
    });
    return canvas;
  }};
  t.after(()=>{if(oldImage===undefined)delete globalThis.Image;else globalThis.Image=oldImage;if(oldDocument===undefined)delete globalThis.document;else globalThis.document=oldDocument;});
  return draws;
}
function acceptedV3(extra={}){
  return {...identity,accepted:true,reference:referencePng,current:currentPng,
    coordinateSize:{width:640,height:360},matrix:[1,0,32,0,1,18,0,0,1],...extra};
}

test('native 240 PNGs are consumed once and boxes project with the original 640 coordinate basis',async t=>{
  const reference=solidFrame(240,135),current=solidFrame(240,135);
  for(let y=60;y<80;y++)for(let x=84;x<108;x++)current.data.set([210,75,55,255],(y*240+x)*4);
  const draws=pngContext(t,reference,current);
  localContext(t,async()=>({ok:true,json:async()=>acceptedV3({diagnostics:{opencvVersion:'4.frozen'}})}));
  const result=await analyzeLocalPair(...v3Pair(),{...previews,expectedIdentity:{...identity,version:'4.frozen'}});
  assert.equal(result.status,'obstructed');assert.equal(result.coordinateSpace,'current_frame');
  assert.equal(result.localRegistration.accepted,true);
  assert.deepEqual(draws,[{width:240,height:135},{width:240,height:135}]);
  assert.ok(Math.abs(result.displayPolygon[0].x-.35)<1e-12);
  assert.ok(Math.abs(result.displayPolygon[0].y-.25)<1e-12);
  assert.ok(result.boxes.some(box=>Math.abs(box.x-(84/240+.05))<1e-12&&Math.abs(box.y-(60/135+.05))<1e-12));
});

test('v3 ceil height is accepted without rescaling when the original preview rounded down',async t=>{
  const processed=solidFrame(240,190),draws=pngContext(t,processed,processed);
  localContext(t,async()=>({ok:true,json:async()=>acceptedV3({coordinateSize:{width:640,height:505}})}));
  const result=await analyzeLocalPair(...v3Pair(189),previews);
  assert.equal(result.status,'clear');assert.equal(result.localRegistration.accepted,true);
  assert.deepEqual(draws,[{width:240,height:190},{width:240,height:190}]);
  assert.ok(Math.abs(result.displayPolygon[0].y-(.2+18/505))<1e-12);
});

test('an old 640 PNG response is rejected rather than silently resized by the client',async t=>{
  const processed=solidFrame(640,360),draws=pngContext(t,processed,processed);
  localContext(t,async()=>({ok:true,json:async()=>acceptedV3()}));
  const result=await analyzeLocalPair(...v3Pair(),previews);
  assert.equal(result.status,'uncertain');assert.equal(result.localRegistration.reason,'local_processing_error');
  assert.match(result.localRegistration.message,/分析尺寸/);assert.equal(draws.length,0);
});

test('missing or incompatible coordinate dimensions cannot turn accepted PNGs into a clear result',async t=>{
  const processed=solidFrame(240,135);pngContext(t,processed,processed);
  let registration;localContext(t,async()=>({ok:true,json:async()=>registration}));
  for(const coordinateSize of [undefined,{width:640,height:1},{width:640,height:505}]){
    registration=acceptedV3({coordinateSize});
    const result=await analyzeLocalPair(...v3Pair(),previews);
    assert.equal(result.status,'uncertain');assert.equal(result.localRegistration.reason,'local_processing_error');
  }
});

test('cancellation after a response body resolves still discards the response',async t=>{
  const controller=new AbortController();
  localContext(t,async()=>({ok:true,json:async()=>{controller.abort();return {...identity,accepted:false,reason:'late_rejection'};}}));
  await assert.rejects(analyzeLocalPair(...uncertainPair(),{...previews,signal:controller.signal}),{name:'AbortError'});
});
