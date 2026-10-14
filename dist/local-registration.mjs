import {analyzeFrame} from './vision.mjs';

const loopback=()=>['127.0.0.1','localhost'].includes(globalThis.location?.hostname);
function checkCancelled(signal){if(signal?.aborted)throw new DOMException('已停止本次检查。','AbortError');}

export async function localRegistrationIdentity({signal}={}){
  checkCancelled(signal);
  if(!loopback())return {available:false,reason:'local_only'};
  try{
    const deadline=AbortSignal.timeout(5000),requestSignal=signal?AbortSignal.any([signal,deadline]):deadline;
    const response=await fetch('/api/vision/status',{cache:'no-store',redirect:'error',signal:requestSignal});
    const identity=response.ok?await response.json():{available:false,reason:'unavailable'};checkCancelled(signal);return identity;
  }catch(error){if(signal?.aborted)throw error;return {available:false,reason:'unavailable'};}
}

function identityError(){const error=new Error('本机配准版本已变化，请先导出并刷新后重新评测。');error.name='BackendIdentityError';return error;}
function identityKey(identity){return identity?.sourceSha256&&identity?.protocolSha256?JSON.stringify([identity.sourceSha256,identity.protocolSha256]):null;}

function processedFrame(src,width,signal){
  return new Promise((resolve,reject)=>{
    const image=new Image();let timer;
    const cleanup=()=>{clearTimeout(timer);signal?.removeEventListener('abort',abort);image.onload=image.onerror=null;};
    const fail=error=>{cleanup();reject(error);};
    const abort=()=>fail(new DOMException('已停止本机配准。','AbortError'));
    image.onload=()=>{
      try{
        if(image.naturalWidth!==width||!image.naturalHeight)throw new Error('本机配准分析尺寸不符合约定。');
        const canvas=document.createElement('canvas');canvas.width=image.naturalWidth;canvas.height=image.naturalHeight;
        const context=canvas.getContext('2d',{willReadFrequently:true});context.drawImage(image,0,0,canvas.width,canvas.height);
        const frame=context.getImageData(0,0,canvas.width,canvas.height);cleanup();
        resolve({frame,sourceWidth:image.naturalWidth,sourceHeight:image.naturalHeight});
      }catch(error){fail(error);}
    };
    image.onerror=()=>fail(new Error('本机配准画面无法读取。'));
    signal?.addEventListener('abort',abort,{once:true});timer=setTimeout(()=>fail(new Error('本机配准画面读取超时。')),10000);
    if(signal?.aborted){abort();return;}image.src=src;
  });
}

export function projectPoint(point,matrix,width,height){
  const x=point.x*width,y=point.y*height,denominator=matrix[6]*x+matrix[7]*y+matrix[8];
  if(!Number.isFinite(denominator)||Math.abs(denominator)<1e-8)throw new Error('本机配准坐标无效。');
  const mapped={x:(matrix[0]*x+matrix[1]*y+matrix[2])/denominator/width,y:(matrix[3]*x+matrix[4]*y+matrix[5])/denominator/height};
  if(!Number.isFinite(mapped.x)||!Number.isFinite(mapped.y))throw new Error('本机配准坐标无效。');
  return mapped;
}

function rejectMessage(reason,fallback){
  if(/visible|boundary|cropp|outside_frame/i.test(reason))return '关注区域有部分离开当前画面，不能确认整区状态。请保留足够取景余量并重新标定。';
  return fallback;
}

/** Optional loopback-only processing. No images are sent from the hosted site. */
export async function analyzeLocalPair(reference,current,polygon,{referencePreview,currentPreview,signal,options,expectedIdentity}={}){
  checkCancelled(signal);
  const original=analyzeFrame(reference,current,polygon,options);
  if(!loopback()||!referencePreview||!currentPreview||!['camera_moved','global_scene_change'].includes(original.reason))return original;
  const expected=expectedIdentity===undefined?await localRegistrationIdentity({signal}):expectedIdentity;
  checkCancelled(signal);
  if(!expected?.available)return {...original,localRegistration:{accepted:false,reason:'local_unavailable'}};
  const expectedKey=identityKey(expected);if(!expectedKey)throw identityError();
  const controller=new AbortController(),abort=()=>controller.abort();let timedOut=false;
  signal?.addEventListener('abort',abort,{once:true});const timer=setTimeout(()=>{timedOut=true;abort();},30000);
  try{
    if(signal?.aborted)throw new DOMException('已停止评测。','AbortError');
    const response=await fetch('/api/vision/register',{method:'POST',redirect:'error',headers:{'Content-Type':'application/json'},body:JSON.stringify({reference:referencePreview,current:currentPreview,polygon}),signal:controller.signal});
    if(!response.ok)return {...original,localRegistration:{accepted:false,reason:`local_http_${response.status}`}};
    const registration=await response.json();
    checkCancelled(controller.signal);
    const {reference:processedReference,current:processedCurrent,...provenance}=registration;
    if(identityKey(registration)!==expectedKey)throw identityError();
    if(!registration.accepted)return {...original,message:rejectMessage(registration.reason||'',original.message),localRegistration:provenance};
    if(expected.version&&registration.diagnostics?.opencvVersion!==expected.version)throw identityError();
    const matrix=Array.isArray(registration.matrix?.[0])?registration.matrix.flat():registration.matrix;
    if(!Array.isArray(matrix)||matrix.length!==9||matrix.some(v=>!Number.isFinite(v)))throw new Error('本机配准返回了无效矩阵。');
    if(!/^data:image\/png;base64,/.test(processedReference)||!/^data:image\/png;base64,/.test(processedCurrent))throw new Error('本机配准未返回无损画面。');
    const [ref,cur]=await Promise.all([processedFrame(processedReference,reference.width,controller.signal),processedFrame(processedCurrent,current.width,controller.signal)]);
    checkCancelled(controller.signal);
    if(ref.sourceWidth!==cur.sourceWidth||ref.sourceHeight!==cur.sourceHeight)throw new Error('本机配准画面尺寸不一致。');
    const size=registration.coordinateSize;
    if(!Number.isInteger(size?.width)||!Number.isInteger(size?.height)||size.width<reference.width||size.width>640||size.height>1280||size.height<1)throw new Error('本机配准坐标尺寸不符合约定。');
    if(reference.width!==240||current.width!==240||ref.frame.height!==Math.ceil(size.height*240/size.width))throw new Error('本机配准分析尺寸不符合约定。');
    const assessment=analyzeFrame(ref.frame,cur.frame,polygon,options),map=point=>projectPoint(point,matrix,size.width,size.height);
    const boxes=assessment.boxes.map(box=>{
      const corners=[{x:box.x,y:box.y},{x:box.x+box.width,y:box.y},{x:box.x+box.width,y:box.y+box.height},{x:box.x,y:box.y+box.height}].map(map);
      const minX=Math.max(0,Math.min(...corners.map(p=>p.x))),minY=Math.max(0,Math.min(...corners.map(p=>p.y)));
      const maxX=Math.min(1,Math.max(...corners.map(p=>p.x))),maxY=Math.min(1,Math.max(...corners.map(p=>p.y)));
      return {...box,x:minX,y:minY,width:Math.max(0,maxX-minX),height:Math.max(0,maxY-minY),corners};
    });
    return {...assessment,boxes,displayPolygon:(assessment.displayPolygon||polygon).map(map),coordinateSpace:'current_frame',localRegistration:{...provenance,scope:'registered_ground_roi',original:{status:original.status,reason:original.reason}}};
  }catch(error){
    if(signal?.aborted||error.name==='BackendIdentityError')throw error;
    if(timedOut)return {...original,message:'本机配准超时，本次不能确认区域状态。',localRegistration:{accepted:false,reason:'local_timeout'}};
    return {...original,localRegistration:{accepted:false,reason:'local_processing_error',message:error.message}};
  }finally{clearTimeout(timer);signal?.removeEventListener('abort',abort);}
}
