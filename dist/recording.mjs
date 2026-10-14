/** Local presentation export: records actual app canvases and visible state only.
 * No microphone, screen capture, credentials, filenames, fetch, or upload. */
const query=new URLSearchParams(location.search);
init();
function init(){
  const host=document.getElementById('presentation-tools');if(!host)return;
  const english=query.get('lang')==='en',text=(en,zh)=>english?en:zh;
  const heading=document.createElement('h3');heading.textContent=text('Record this demonstration','录制本次演示');
  const description=document.createElement('p');description.textContent=text('Exports the actual picture, marked area and current result. No microphone, credentials or other apps are recorded. Keep private details out of the picture.','只导出真实画面、标区和当前状态；不录制麦克风、凭据或其他应用。请确认画面没有私人信息。');
  const controls=document.createElement('div');controls.className='calibration-buttons';
  const start=document.createElement('button'),stop=document.createElement('button'),still=document.createElement('button'),status=document.createElement('p'),download=document.createElement('a');
  start.id='record-presentation';stop.id='stop-presentation';still.id='save-presentation-still';
  for(const button of [start,stop,still]){button.type='button';button.className='button quiet';controls.append(button);}
  start.textContent=text('Start recording','开始录制');stop.textContent=text('Stop recording','停止录制');still.textContent=text('Save current slide','保存当前画面');stop.disabled=true;
  status.id='recording-status';status.setAttribute('role','status');status.textContent=text('Local export · auto-stop at 2:50','本机导出 · 2分50秒自动停止');
  download.id='download-presentation';download.className='button secondary';download.textContent=text('Download recording','下载录像');download.hidden=true;
  const canvas=document.createElement('canvas');canvas.id='presentation-preview';canvas.width=1280;canvas.height=720;canvas.setAttribute('aria-label',text('Actual ClearPath presentation export preview','真实ClearPath演示导出预览'));canvas.style.cssText='display:block;width:100%;height:auto;margin:14px 0;border-radius:12px;background:#f6f8f2;';
  host.replaceChildren(heading,description,controls,status,download,canvas);host.hidden=!document.getElementById('presentation-mode')?.checked;
  const p=canvas.getContext('2d',{alpha:false}),scene=document.getElementById('scene'),overlay=document.getElementById('overlay');let active=null,animation=0,lastRenderedAt=-Infinity,recordingUrl=null;
  const read=id=>document.getElementById(id)?.textContent?.trim()||'';
  function font(size,weight=400){p.font=`${weight} ${size}px -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif`;}
  function write(value,x,y,maxWidth,size=20,weight=400,color='#233c34',limit=4){font(size,weight);p.fillStyle=color;let line='',row=0;for(const word of String(value).split(/\s+/)){const next=line?line+' '+word:word;if(p.measureText(next).width>maxWidth&&line){p.fillText(line,x,y+row*(size*1.38));line=word;row++;if(row>=limit)return;}else line=next;}p.fillText(line,x,y+row*(size*1.38));}
  function pill(value,x,y,color='#dfe9df',foreground='#244b3c'){font(14,600);const w=Math.min(1180,p.measureText(value).width+28);p.fillStyle=color;p.beginPath();p.roundRect(x,y-20,w,30,15);p.fill();p.fillStyle=foreground;p.fillText(value,x+14,y);}
  function render(now=performance.now()){
    if(host.hidden){animation=requestAnimationFrame(render);return;}
    if(now-lastRenderedAt<1000/(active?24:8)){animation=requestAnimationFrame(render);return;}lastRenderedAt=now;
    p.fillStyle='#f5f7f0';p.fillRect(0,0,1280,720);p.fillStyle='#193a2e';p.fillRect(0,0,1280,92);write('ClearPath',42,56,260,35,600,'#f5f7f0');write('NOTICE  /  REVIEW  /  CHECK AGAIN',830,52,410,15,500,'#c8dbcb');
    const source=read('stage-source'),ring=/RING/.test(source)&&!/NOT RING/.test(source),synthetic=/SAMPLE|SYNTHETIC/.test(source);
    pill(source||'NO SOURCE SELECTED',40,125,ring?'#d6e6f0':'#e2e9df');
    const area={x:40,y:156,width:730,height:480};p.fillStyle='#1c2c26';p.beginPath();p.roundRect(area.x,area.y,area.width,area.height,16);p.fill();
    if(scene?.width&&scene?.height){const scale=Math.min(area.width/scene.width,area.height/scene.height),w=scene.width*scale,h=scene.height*scale,x=area.x+(area.width-w)/2,y=area.y+(area.height-h)/2;p.drawImage(scene,x,y,w,h);p.drawImage(overlay,x,y,w,h);}
    write(read('frame-time'),42,662,716,16,500,'#52665a',1);write((ring?read('ring-message'):read('region-label')).replace(/https?:\/\/\S+/g,'[endpoint]').replace(/[A-Za-z0-9_-]{80,}/g,'[redacted]'),42,687,716,14,400,'#52665a',2);
    const assessment=document.querySelector('.assessment'),state=assessment?.dataset.state||'idle',alert=['obstructed','confirmed'].includes(state),uncertain=state==='uncertain';
    p.fillStyle=alert?'#fff0dd':uncertain?'#f1ede1':'#e7eee3';p.beginPath();p.roundRect(796,156,444,480,18);p.fill();
    write('PATH CHECK',824,194,380,14,600,'#63745f',1);write(read('assessment-title'),824,239,382,30,600,'#203e32',3);write(read('assessment-description'),824,322,380,18,400,'#52665a',5);
    const metric=document.getElementById('metric');if(metric&&!metric.hidden){write(read('overlap-value'),824,438,145,36,600,'#244b3c',1);write('visual change in marked area\n(not physical width)',982,424,230,14,400,'#63745f',3);}
    const steps=[...document.querySelectorAll('.workflow li')];for(let i=0;i<steps.length;i++){const step=steps[i],done=step.classList.contains('done'),active=step.classList.contains('current');p.fillStyle=active||done?'#2c654b':'#c9d6c3';p.beginPath();p.arc(838,482+i*33,12,0,Math.PI*2);p.fill();font(13,600);p.fillStyle='#fff';p.textAlign='center';p.fillText(String(i+1),838,487+i*33);p.textAlign='left';write(step.querySelector('strong')?.textContent?.trim()||'',860,488+i*33,330,16,active?600:400,'#304b3b',1);}
    const footer=synthetic?'SYNTHETIC WORKFLOW — NOT REAL-WORLD EVIDENCE':ring?'RING PLAYGROUND — SIMULATED LIVE VIEW':/SELF.RECORDED/.test(source)?'SELF-RECORDED DEVELOPMENT SCENE · NOT UNSEEN VALIDATION':/CAMERA/.test(source)?'LOCAL CAMERA — LIVE INPUT':'USER-SELECTED MEDIA — SOURCE NOT VERIFIED';
    write(footer,800,666,440,12,600,'#52665a',2);write('Local processing · Human review required',800,704,440,13,400,'#52665a',1);
    if(active?.recorder.state==='recording'){status.textContent=text('Recording actual app output','正在录制真实应用输出')+` · ${Math.floor((performance.now()-active.startedAt)/1000)}s`;}
    animation=requestAnimationFrame(render);
  }
  function save(blob,extension){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=`clearpath-presentation-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;a.click();setTimeout(()=>URL.revokeObjectURL(url),30000);}
  function releaseRecording(){if(recordingUrl)URL.revokeObjectURL(recordingUrl);recordingUrl=null;download.hidden=true;download.removeAttribute('href');download.removeAttribute('download');}
  function offerRecording(blob){const url=URL.createObjectURL(blob);releaseRecording();recordingUrl=url;const extension=/mp4/.test(blob.type)?'mp4':'webm';download.href=url;download.download=`clearpath-presentation-${new Date().toISOString().replace(/[:.]/g,'-')}.${extension}`;download.hidden=false;status.textContent=text('Recording ready. Download the file below.','录像已准备好，请点击下方链接下载。');}
  start.addEventListener('click',()=>{
    if(active)return;
    if(!canvas.captureStream||typeof MediaRecorder==='undefined'){status.textContent=text('This browser does not support local recording. Use Save current slide.','当前浏览器不支持本机录制，可保存当前画面。');return;}
    let session,attemptStream;
    try{
      const mime=['video/webm;codecs=vp9','video/webm;codecs=vp8','video/mp4;codecs=avc1.42E01E','video/mp4','video/webm'].find(type=>MediaRecorder.isTypeSupported(type));
      const stream=attemptStream=canvas.captureStream(24),recorder=new MediaRecorder(stream,{...(mime?{mimeType:mime}:{}),videoBitsPerSecond:5000000});
      session={stream,recorder,chunks:[],failed:false,abandoned:false,finished:false,startedAt:performance.now(),timer:0};active=session;
      const finish=()=>{
        if(session.finished)return;session.finished=true;clearTimeout(session.timer);session.stream.getTracks().forEach(track=>track.stop());
        if(active!==session)return;active=null;start.disabled=false;stop.disabled=true;
        const blob=new Blob(session.chunks,{type:session.recorder.mimeType});
        if(session.failed||session.abandoned||!blob.size){status.textContent=text('Recording did not complete. No recording was exported.','录制未完成，未导出录像。');return;}
        offerRecording(blob);
      };
      recorder.ondataavailable=e=>{if(e.data.size)session.chunks.push(e.data);};recorder.onstop=finish;
      recorder.onerror=()=>{session.failed=true;status.textContent=text('Recording failed. Finishing cleanup.','录制失败，正在清理。');try{if(recorder.state!=='inactive')recorder.stop();else queueMicrotask(finish);}catch{finish();}};
      recorder.start(1000);start.disabled=true;stop.disabled=false;
      session.timer=setTimeout(()=>{if(recorder.state==='recording')recorder.stop();},170000);
    }catch(error){if(session)session.failed=true;attemptStream?.getTracks().forEach(track=>track.stop());active=null;status.textContent=error.message;start.disabled=false;stop.disabled=true;}
  });
  stop.addEventListener('click',()=>{if(active?.recorder.state==='recording')active.recorder.stop();});still.addEventListener('click',()=>canvas.toBlob(blob=>{if(blob)save(blob,'png');},'image/png'));
  window.addEventListener('pagehide',()=>{cancelAnimationFrame(animation);releaseRecording();if(active){active.abandoned=true;clearTimeout(active.timer);if(active.recorder.state==='recording')active.recorder.stop();active.stream.getTracks().forEach(track=>track.stop());}});render();
}
