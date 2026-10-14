const MAX_FILE_BYTES=250*1024*1024;
const frameNames=['reference','occupied','cleared'];
const abortError=()=>new DOMException('素材读取已取消。','AbortError');
const decodeAdvice='若这是 HEVC / MOV 素材，请在本机转换为 H.264 MP4 后重试。';

function validateInput(file,times,video,analysisWidth,onProgress,signal){
  if(typeof File==='undefined'||!(file instanceof File))throw new TypeError('请选择本地视频文件。');
  if(!file.size)throw new TypeError('视频文件为空。');
  if(file.size>MAX_FILE_BYTES)throw new RangeError('单个视频限 250 MiB；请先在本机裁剪或压缩。');
  if(!times||typeof times!=='object'||Array.isArray(times))throw new TypeError('请提供参考、占用和清空的三个时间点。');
  const targets=Object.fromEntries(frameNames.map(name=>[name,times[name]]));
  if(frameNames.some(name=>typeof targets[name]!=='number'||!Number.isFinite(targets[name])||targets[name]<0)
      ||!(targets.reference<targets.occupied&&targets.occupied<targets.cleared))throw new RangeError('时间点必须严格满足 0 ≤ 参考 < 占用 < 清空，单位为秒。');
  if(!Number.isInteger(analysisWidth)||analysisWidth<32||analysisWidth>1024)throw new RangeError('分析宽度必须是 32 至 1024 的整数。');
  if(!video||typeof video.addEventListener!=='function'||typeof video.pause!=='function'||typeof video.load!=='function')throw new TypeError('需要页面中可显示的视频元素。');
  if(typeof onProgress!=='function')throw new TypeError('onProgress 必须为函数。');
  if(signal!=null&&typeof signal.addEventListener!=='function')throw new TypeError('signal 必须为 AbortSignal。');
  if(!globalThis.crypto?.subtle)throw new Error('当前浏览器缺少本地 SHA-256 支持，请使用 HTTPS 或 localhost 的现代浏览器。');
  return targets;
}

function mediaError(video){
  const code=video.error?.code;
  return new Error(code===2?'本地视频读取失败，请重新选择文件。':`浏览器无法解码此视频${code?`（媒体错误 ${code}）`:''}。${decodeAdvice}`);
}

export async function captureVideoFrames(file,times,video,{signal,analysisWidth=240,onProgress=()=>{}}={}){
  const targets=validateInput(file,times,video,analysisWidth,onProgress,signal);
  const pending=new Set();
  const page=globalThis.window;
  let failure=null,objectUrl=null;
  const stop=error=>{if(failure)return;failure=error;for(const cancel of [...pending])cancel(error);};
  const onAbort=()=>stop(abortError());
  const onPageHide=()=>stop(new DOMException('页面已离开，素材读取已取消。','AbortError'));
  const guard=()=>{if(signal?.aborted)throw abortError();if(failure)throw failure;};
  const report=progress=>{guard();onProgress({total:3,...progress});};

  const waitFor=(operation,duration,message)=>new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;clearTimeout(timeout);pending.delete(cancel);error?reject(error):resolve(value);};
    const cancel=error=>finish(error);
    const timeout=setTimeout(()=>finish(new Error(message)),duration);
    pending.add(cancel);
    // The browser may finish a file read/digest after cancellation; consume its
    // result without letting it revive the cancelled evaluation.
    Promise.resolve(operation).then(value=>finish(null,value),error=>finish(error));
    try{guard();}catch(error){finish(error);}
  });

  const waitMedia=(events,check,duration,message,start)=>new Promise((resolve,reject)=>{
    let settled=false;
    const cleanup=()=>{clearTimeout(timeout);pending.delete(cancel);for(const event of events)video.removeEventListener(event,ready);video.removeEventListener('error',errored);};
    const finish=error=>{if(settled)return;settled=true;cleanup();error?reject(error):resolve();};
    const cancel=error=>finish(error);
    const ready=event=>{try{guard();if(check(event))finish();}catch(error){finish(error);}};
    const errored=()=>finish(mediaError(video));
    const timeout=setTimeout(()=>finish(new Error(message)),duration);
    pending.add(cancel);
    for(const event of events)video.addEventListener(event,ready);
    video.addEventListener('error',errored);
    try{guard();start?.();ready({type:'initial'});}catch(error){finish(error);}
  });

  signal?.addEventListener('abort',onAbort,{once:true});
  page?.addEventListener('pagehide',onPageHide,{once:true});
  try{
    guard();
    objectUrl=URL.createObjectURL(file);
    video.pause();video.srcObject=null;video.preload='auto';video.muted=true;video.playsInline=true;
    report({stage:'loading',completed:0});
    const decoded=()=>video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0;
    await waitMedia(['loadeddata','canplay'],decoded,20000,`视频在 20 秒内未能解码。${decodeAdvice}`,()=>{video.src=objectUrl;video.load();});
    guard();video.pause();
    const duration=video.duration;
    if(!Number.isFinite(duration)||duration<=0)throw new RangeError('视频没有可用的有限时长。');
    if(frameNames.some(name=>targets[name]>=duration))throw new RangeError(`所有时间点必须小于视频时长 ${duration.toFixed(3)} 秒。`);
    // Use the HTML video's displayed dimensions; the browser applies MOV
    // rotation metadata. Never assume encoded width/height from the filename.
    const originalSize={width:video.videoWidth,height:video.videoHeight};
    const ratio=originalSize.width/originalSize.height;
    if(!Number.isFinite(ratio)||ratio<0.25||ratio>4)throw new RangeError('视频宽高比过于极端，请在本机裁剪到 1:4 至 4:1 后重试。');
    const analysisCanvas=document.createElement('canvas');
    analysisCanvas.width=analysisWidth;analysisCanvas.height=Math.round(analysisWidth/ratio);
    const analysisContext=analysisCanvas.getContext('2d',{willReadFrequently:true});
    const previewCanvas=document.createElement('canvas');
    previewCanvas.width=640;previewCanvas.height=Math.round(640/ratio);
    const previewContext=previewCanvas.getContext('2d');
    if(!analysisContext||!previewContext)throw new Error('当前浏览器无法创建本地画面画布。');
    const frames={},previews={},mediaTimes={};
    for(let index=0;index<frameNames.length;index++){
      const name=frameNames[index],target=targets[name];
      report({stage:'seeking',frame:name,completed:index,mediaTime:target});
      if(video.seeking||!decoded()||Math.abs(video.currentTime-target)>1e-7){
        let seeked=false;
        await waitMedia(['seeked','loadeddata'],event=>{
          if(event.type==='seeked')seeked=true;
          return seeked&&!video.seeking&&decoded()&&Math.abs(video.currentTime-target)<=0.1;
        },15000,`无法读取 ${target.toFixed(3)} 秒处的画面。${decodeAdvice}`,()=>{video.currentTime=target;});
      }
      guard();
      const actualTime=video.currentTime;
      if(!decoded()||video.seeking||!Number.isFinite(actualTime)||Math.abs(actualTime-target)>0.1
          ||(index>0&&actualTime<=mediaTimes[frameNames[index-1]]))throw new Error('视频未能按指定先后顺序提供可解码画面，请调整时间点。');
      analysisContext.drawImage(video,0,0,analysisCanvas.width,analysisCanvas.height);
      const image=analysisContext.getImageData(0,0,analysisCanvas.width,analysisCanvas.height);
      frames[name]={data:image.data,width:image.width,height:image.height};
      previewContext.drawImage(video,0,0,previewCanvas.width,previewCanvas.height);
      previews[name]=previewCanvas.toDataURL('image/jpeg',0.82);
      mediaTimes[name]=actualTime;
      report({stage:'capturing',frame:name,completed:index+1,mediaTime:actualTime});
    }
    report({stage:'hashing',completed:3});
    const bytes=await waitFor(file.arrayBuffer(),45000,'本地视频读取超时，请重试。');
    guard();
    const digest=await waitFor(crypto.subtle.digest('SHA-256',bytes),45000,'本地视频指纹计算超时，请重试。');
    guard();
    const fileSha256=Array.from(new Uint8Array(digest),byte=>byte.toString(16).padStart(2,'0')).join('');
    report({stage:'complete',completed:3});
    return {frames,previews,duration,originalSize,mediaTimes,fileSha256};
  }finally{
    signal?.removeEventListener('abort',onAbort);
    page?.removeEventListener('pagehide',onPageHide);
    // The caller serializes use of this shared video. Release local media even
    // when a codec error, seek timeout, page departure, or progress callback fails.
    if(objectUrl){
      try{video.pause();video.srcObject=null;video.removeAttribute('src');video.load();}catch{}
      URL.revokeObjectURL(objectUrl);
    }
  }
}
