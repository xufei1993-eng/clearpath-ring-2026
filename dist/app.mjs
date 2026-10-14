import {analyzeFrame} from './vision.mjs';
import {connectRing,startRingVideo,ringRequest,disconnectRing} from './ring.mjs';
import {isLaterFrame} from './freshness.mjs';
import {analyzeLocalPair,localRegistrationIdentity} from './local-registration.mjs';
import {english,language,tr,formatTime,initializeI18n} from './i18n.mjs';

initializeI18n();

const $ = id => document.getElementById(id);
const scene=$('scene'),ctx=scene.getContext('2d',{willReadFrequently:true}),overlay=$('overlay'),pen=overlay.getContext('2d'),video=$('video');
const defaultPolygon=[{x:.36,y:.43},{x:.64,y:.43},{x:.84,y:.96},{x:.16,y:.96}];
let polygon=structuredClone(defaultPolygon),draft=[],editing=false,reference=null,result=null,incident=null,records=[],source='sample',sample='empty',image=null,mediaUrl=null,mediaRevision=0,stream=null,ringClose=null,loop=null,lastTime=0,toastTimer=null,lastCheckedStamp=null,guide=false,mediaEpoch=0,mediaSession=0,mediaAbort=null,cursor={x:.35,y:.45},lastVideoTime=-1,lastVideoArrival=0;
let frozenFrame=null,analysisOrder=null,analysisStamp=null,analysisCapturedAt=null,analysisGeneration=0,analysisAbort=null,checking=false;
let selectedFileName='',selfRecorded=false,presentation=new URLSearchParams(location.search).get('presentation')==='1';
const small=document.createElement('canvas'),smallCtx=small.getContext('2d',{willReadFrequently:true});
const sourceNames={sample:'合成样例 · 非 Ring 画面',camera:'设备摄像头 · 本地实拍',file:'用户选择的本地素材 · 非 Ring 画面',ring:'Ring Playground · 官方模拟视频'};
const sourceCodes={sample:'synthetic_sample',camera:'local_camera',file:'user_media',ring:'ring_playground'};
const hints={no_significant_change:'当前参考比较未见明显新增障碍。',new_change_in_path:'通行区域出现了新增变化，请核对标记位置。',low_light:'画面过暗，暂时无法可靠比较。',exposure_change:'光线变化过大，请稳定照明后重试。',camera_moved:'疑似机位发生变化，请固定摄像机并重新保存参考。',global_scene_change:'画面变化较大，无法可靠区分障碍与场景变化。',invalid_reference:'参考画面无效，请重新保存空通道参考。',invalid_polygon:'通行区域无效，请按顺序标定四个角。',region_too_small:'通行区域太小，请扩大到完整通道。'};

function toast(message){$('toast').textContent=tr(message);$('toast').hidden=false;clearTimeout(toastTimer);toastTimer=setTimeout(()=>$('toast').hidden=true,5500);}
function sourceLabel(){return tr(source==='file'&&selfRecorded?'用户声明的自录测试素材 · 非 Ring 画面':sourceNames[source]);}
function refreshSourceLabels(){
  $('source-label').textContent=sourceLabel();
  $('stage-source').textContent={sample:'SYNTHETIC SAMPLE — NOT RING',camera:'SELF-RECORDED TEST FOOTAGE — NOT RING',file:selfRecorded?'SELF-RECORDED TEST FOOTAGE — NOT RING':'USER-PROVIDED LOCAL FOOTAGE — NOT RING',ring:'RING PLAYGROUND — SIMULATED LIVE VIEW'}[source];
  if(selectedFileName){$('file-name').setAttribute('data-i18n-skip','');$('file-name').textContent=presentation?tr('已选择本地素材（录屏时隐藏文件名）'):selectedFileName;}
  for(const [index,option] of [...$('ring-device').options].entries())if(option.dataset.originalLabel)option.textContent=presentation?`${tr('设备')} ${index+1}`:option.dataset.originalLabel;
}
function setPresentation(enabled){presentation=!!enabled;showCredentials(false);document.body.classList.toggle('presentation-mode',presentation);$('presentation-mode').checked=presentation;$('presentation-tools').hidden=!presentation;const url=new URL(location.href);presentation?url.searchParams.set('presentation','1'):url.searchParams.delete('presentation');history.replaceState(null,'',url);refreshSourceLabels();const destination=new URL(location.href);destination.searchParams.set('lang',english?'zh':'en');$('language-switch').href=destination.href;const home=new URL('./',location.href);home.search=url.search;document.querySelector('.brand').href=home.href;document.dispatchEvent(new CustomEvent('clearpath-presentationchange',{detail:{enabled:presentation}}));}
function showCredentials(visible){const recording=$('stop-presentation')&&!$('stop-presentation').disabled;visible=!!visible&&!recording;document.body.classList.toggle('credentials-visible',visible);$('presentation-credentials').setAttribute('aria-expanded',String(visible));$('presentation-credentials').textContent=tr(visible?'隐藏连接设置':'临时显示连接设置');}
$('presentation-credentials').addEventListener('click',()=>showCredentials(!document.body.classList.contains('credentials-visible')));
document.addEventListener('click',event=>{if(event.target.closest?.('#record-presentation'))showCredentials(false);},true);
new MutationObserver(()=>{const recording=$('stop-presentation')&&!$('stop-presentation').disabled;document.body.classList.toggle('presentation-recording',!!recording);$('presentation-credentials').disabled=!!recording;$('presentation-mode').disabled=!!recording;if(recording&&document.body.classList.contains('credentials-visible'))showCredentials(false);}).observe($('presentation-tools'),{subtree:true,childList:true,attributes:true,attributeFilter:['disabled']});
$('presentation-mode').addEventListener('change',event=>setPresentation(event.target.checked));
$('self-recorded').addEventListener('change',event=>{selfRecorded=event.target.checked;refreshSourceLabels();});
$('language-switch').textContent=english?'中文':'EN';$('language-switch').setAttribute('aria-label',english?'Switch to Chinese; starts a new page session':'切换英文；开始新的页面会话');
setPresentation(presentation);
function frameStamp(){return source==='sample'||(source==='file'&&image)?`${source}:${mediaRevision}`:`${source}:${mediaRevision}:${video.currentTime.toFixed(3)}`;}
function frameOrder(){return {source,session:mediaSession,kind:source==='sample'?'synthetic':image?'still':'video',revision:mediaRevision,time:video.currentTime};}
function clearAnalysisEvidence(){result=null;frozenFrame=null;analysisOrder=null;analysisStamp=null;analysisCapturedAt=null;lastCheckedStamp=null;$('live-view-button').hidden=true;$('region-label').textContent='虚线区域 = 希望保持畅通的区域';$('frame-time').textContent='尚未检查';}
function cancelPendingAnalysis({invalidate=true}={}){analysisGeneration++;analysisAbort?.abort();analysisAbort=null;checking=false;$('analyze-button').disabled=!reference;$('recheck-button').disabled=false;if(invalidate){clearAnalysisEvidence();if(reference)showState('uncertain','当前画面待检查','画面或处理条件已改变，请重新检查当前画面。');}}
function newOperation(){cancelPendingAnalysis();mediaAbort?.abort();mediaAbort=new AbortController();return {epoch:++mediaEpoch,signal:mediaAbort.signal};}
function ready(){if(source==='sample'||(source==='file'&&image))return true;if(video.seeking||video.readyState<2||!video.videoWidth)return false;if(source==='camera'||source==='ring')return !!video.srcObject?.getVideoTracks().some(track=>track.readyState==='live');return source==='file'&&!!video.src;}
function resize(w=960,h=600){if(scene.width===w&&scene.height===h)return;scene.width=overlay.width=w;scene.height=overlay.height=h;$('camera-stage').style.aspectRatio=`${w}/${h}`;}
function polygonPath(points){pen.beginPath();points.forEach((p,i)=>i?pen.lineTo(p.x*overlay.width,p.y*overlay.height):pen.moveTo(p.x*overlay.width,p.y*overlay.height));if(points.length>2)pen.closePath();}
function drawOverlay(){
  pen.clearRect(0,0,overlay.width,overlay.height);
  const pts=editing?draft:result?.displayPolygon&&(frozenFrame||frameStamp()===analysisStamp)?result.displayPolygon:polygon;
  if(pts.length){polygonPath(pts);pen.fillStyle=result?.status==='obstructed'?'#eda95524':'#59b88724';if(pts.length>2)pen.fill();pen.strokeStyle=result?.status==='obstructed'?'#f7c080':'#9cdbb3';pen.lineWidth=3;pen.setLineDash([10,7]);pen.stroke();pen.setLineDash([]);pts.forEach((p,i)=>{pen.beginPath();pen.arc(p.x*overlay.width,p.y*overlay.height,editing?8:5,0,Math.PI*2);pen.fillStyle='#e4f5e9';pen.fill();if(editing){pen.fillStyle='#203f32';pen.font='bold 12px sans-serif';pen.textAlign='center';pen.fillText(i+1,p.x*overlay.width,p.y*overlay.height+4);}});}
  if(!editing&&result?.status==='obstructed'&&result.boxes&&(frozenFrame||frameStamp()===analysisStamp)){for(const box of result.boxes){const x=box.x*overlay.width,y=box.y*overlay.height,w=box.width*overlay.width,h=box.height*overlay.height;pen.strokeStyle='#ffd092';pen.lineWidth=3;pen.strokeRect(x,y,w,h);pen.fillStyle='#72421fe8';pen.fillRect(x,Math.max(0,y-25),120,25);pen.fillStyle='#fff8eb';pen.font='12px sans-serif';pen.textAlign='left';pen.fillText(tr('疑似新增障碍'),x+10,Math.max(17,y-8));}}
  if(editing){const x=cursor.x*overlay.width,y=cursor.y*overlay.height;pen.strokeStyle='#fff';pen.lineWidth=2;pen.beginPath();pen.moveTo(x-12,y);pen.lineTo(x+12,y);pen.moveTo(x,y-12);pen.lineTo(x,y+12);pen.stroke();}
}
function box(x,y,size){
  ctx.save();ctx.translate(x,y);ctx.fillStyle='#1b2c2240';ctx.beginPath();ctx.ellipse(size*.56,size*.97,size*.68,size*.20,-.1,0,Math.PI*2);ctx.fill();
  ctx.fillStyle='#bd956a';ctx.beginPath();ctx.moveTo(0,size*.18);ctx.lineTo(size*.67,0);ctx.lineTo(size,size*.2);ctx.lineTo(size*.32,size*.40);ctx.closePath();ctx.fill();
  ctx.fillStyle='#a07548';ctx.beginPath();ctx.moveTo(0,size*.18);ctx.lineTo(size*.32,size*.4);ctx.lineTo(size*.32,size);ctx.lineTo(0,size*.73);ctx.closePath();ctx.fill();
  ctx.fillStyle='#c4a177';ctx.beginPath();ctx.moveTo(size*.32,size*.4);ctx.lineTo(size,size*.2);ctx.lineTo(size,size*.75);ctx.lineTo(size*.32,size);ctx.closePath();ctx.fill();
  ctx.fillStyle='#d6bf9d';ctx.beginPath();ctx.moveTo(size*.31,size*.1);ctx.lineTo(size*.45,size*.065);ctx.lineTo(size*.77,size*.265);ctx.lineTo(size*.64,size*.305);ctx.closePath();ctx.fill();ctx.fillRect(size*.64,size*.30,size*.13,size*.31);ctx.fillStyle='#efeadc';ctx.fillRect(size*.42,size*.56,size*.19,size*.14);ctx.fillStyle='#574c3d';for(let i=0;i<7;i++)ctx.fillRect(size*(.43+i*.021),size*.59,size*.008,size*.07);ctx.restore();
}
function drawSample(){
  resize();const w=960,h=600;
  let grad=ctx.createLinearGradient(0,0,0,h);grad.addColorStop(0,'#b3b7aa');grad.addColorStop(.5,'#bfc3b8');grad.addColorStop(1,'#919c90');ctx.fillStyle=grad;ctx.fillRect(0,0,w,h);
  ctx.fillStyle='#c9c9bc';ctx.beginPath();ctx.moveTo(0,0);ctx.lineTo(335,0);ctx.lineTo(335,275);ctx.lineTo(0,600);ctx.fill();
  ctx.fillStyle='#adb5a5';ctx.beginPath();ctx.moveTo(625,0);ctx.lineTo(960,0);ctx.lineTo(960,600);ctx.lineTo(625,275);ctx.fill();
  ctx.strokeStyle='#9b9e92';ctx.lineWidth=1;for(let i=0;i<9;i++){ctx.beginPath();ctx.moveTo(0,i*73);ctx.lineTo(335,38+i*30);ctx.stroke();}for(let i=0;i<7;i++){ctx.beginPath();ctx.moveTo(625,35+i*35);ctx.lineTo(960,i*85);ctx.stroke();}
  ctx.fillStyle='#5b6b5e';ctx.fillRect(326,0,308,283);ctx.fillStyle='#4c5b50';ctx.fillRect(345,0,271,269);ctx.strokeStyle='#7b8879';ctx.lineWidth=3;ctx.strokeRect(365,30,230,206);ctx.beginPath();ctx.moveTo(479,31);ctx.lineTo(479,235);ctx.stroke();ctx.fillStyle='#bcbfaa';ctx.fillRect(575,116,5,32);ctx.fillStyle='#273d30';ctx.fillRect(343,263,275,10);
  ctx.fillStyle='#7d897b';ctx.beginPath();ctx.moveTo(335,275);ctx.lineTo(625,275);ctx.lineTo(661,305);ctx.lineTo(302,305);ctx.closePath();ctx.fill();ctx.fillStyle='#555e52';ctx.fillRect(302,305,359,7);
  ctx.fillStyle='#777f6a';ctx.beginPath();ctx.moveTo(363,322);ctx.lineTo(600,322);ctx.lineTo(625,360);ctx.lineTo(338,360);ctx.closePath();ctx.fill();ctx.strokeStyle='#8e957e';ctx.lineWidth=2;for(let i=0;i<12;i++){ctx.beginPath();ctx.moveTo(367+i*19,326);ctx.lineTo(344+i*23,356);ctx.stroke();}
  ctx.strokeStyle='#7e8a7b';ctx.lineWidth=1;for(let i=0;i<6;i++){ctx.beginPath();ctx.moveTo(60+i*163,600);ctx.lineTo(365+i*45,278);ctx.stroke();}for(const y of [382,478,595]){ctx.beginPath();ctx.moveTo(0,y);ctx.lineTo(960,y);ctx.stroke();}
  let seed=97;for(let i=0;i<8000;i++){seed=(seed*16807)%2147483647;const x=seed%960;seed=(seed*16807)%2147483647;const y=seed%600;ctx.fillStyle=i%2?'#ffffff06':'#182b1606';ctx.fillRect(x,y,2,1);}
  ctx.fillStyle='#485c45';ctx.beginPath();ctx.ellipse(889,322,47,75,.2,0,Math.PI*2);ctx.fill();ctx.fillStyle='#5a714e';for(let i=0;i<16;i++){ctx.beginPath();ctx.ellipse(859+(i%4)*17,276+Math.floor(i/4)*28,19,23,(i%3)*.5,0,Math.PI*2);ctx.fill();}ctx.fillStyle='#777e69';ctx.beginPath();ctx.moveTo(842,368);ctx.lineTo(932,368);ctx.lineTo(915,439);ctx.lineTo(857,439);ctx.closePath();ctx.fill();
  if(sample==='inside')box(420,390,145);if(sample==='outside')box(55,333,118);
}
function paint(force=false){
  if(frozenFrame&&!force){resize(frozenFrame.width,frozenFrame.height);ctx.putImageData(frozenFrame,0,0);drawOverlay();return;}
  if(source==='sample')drawSample();
  else if(image){resize(960,Math.round(960*image.naturalHeight/image.naturalWidth));ctx.drawImage(image,0,0,scene.width,scene.height);}
  else if(ready()){resize(960,Math.round(960*video.videoHeight/video.videoWidth));ctx.drawImage(video,0,0,scene.width,scene.height);}
  drawOverlay();
}
function animation(){if(source!=='sample'&&!image&&ready()&&video.currentTime!==lastVideoTime){lastVideoTime=video.currentTime;lastVideoArrival=performance.now();paint();}loop=requestAnimationFrame(animation);}
function pixels(){paint(true);small.width=240;small.height=Math.max(40,Math.round(240*scene.height/scene.width));smallCtx.drawImage(scene,0,0,small.width,small.height);return smallCtx.getImageData(0,0,small.width,small.height);}
function registrationPreview(){const c=document.createElement('canvas');c.width=640;c.height=Math.round(640*scene.height/scene.width);c.getContext('2d').drawImage(scene,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.85);}
function snapshot(){const c=document.createElement('canvas');c.width=320;c.height=Math.round(320*scene.height/scene.width);const cctx=c.getContext('2d');cctx.drawImage(scene,0,0,c.width,c.height);cctx.drawImage(overlay,0,0,c.width,c.height);return c.toDataURL('image/jpeg',.68);}
function record(type,message,{capture=true,analysis=null,capturedAt=null}={}){
  const recordedAt=new Date().toISOString(),hasEvidence=capture&&(ready()||frozenFrame);
  const entry={id:crypto.randomUUID(),time:recordedAt,capturedAt:hasEvidence?(capturedAt||(frozenFrame&&analysisCapturedAt)||recordedAt):undefined,type,message:tr(message),source:sourceCodes[source],sourceLabel:sourceLabel(),file:source==='file'?selectedFileName:undefined,footageDeclaration:source==='file'?(selfRecorded?'self_recorded_by_user':'user_provided_unknown'):undefined,mediaTime:source!=='sample'&&!image?(frozenFrame&&analysisOrder?analysisOrder.time:video.currentTime):undefined,stillCaptureTime:source==='file'&&image?'unknown_user_supplied_order':undefined,polygon:structuredClone(polygon),analysis:analysis?{...analysis}:null,evidence:hasEvidence?snapshot():null};
  records.unshift(entry);records=records.slice(0,40);renderRecords();return entry;
}
function renderRecords(){const labels={reference:'参考已保存',obstructed:'发现疑似障碍',confirmed:'人工已确认',dismissed:'人工已排除',recheck:'后续画面复查',clear:'当前未见变化',uncertain:'暂无法判断',source:'切换画面来源'};$('activity-empty').hidden=records.length>0;$('activity-list').replaceChildren();for(const r of records.slice(0,8)){const li=document.createElement('li'),time=document.createElement('time'),title=document.createElement('strong'),p=document.createElement('p'),sourceText=document.createElement('span');time.dateTime=r.time;time.textContent=formatTime(r.time);title.textContent=tr(labels[r.type]||r.type);sourceText.className='record-source';sourceText.textContent=r.sourceLabel;title.append(sourceText);p.textContent=tr(r.message);li.append(time,title,p);if(r.evidence){const img=document.createElement('img');img.src=r.evidence;img.alt=tr(`${labels[r.type]}的证据画面`);li.append(img);}$('activity-list').append(li);}}
function setWorkflow(step){['baseline','detect','confirm','recheck'].forEach((name,i)=>{$(`step-${name}`).classList.toggle('current',i===step);$(`step-${name}`).classList.toggle('done',i<step);});}
function showState(state,title,description){document.querySelector('.assessment').dataset.state=state;$('assessment-title').textContent=tr(title);$('assessment-description').textContent=tr(description);$('status-symbol').textContent=state==='clear'?'✓':state==='obstructed'||state==='confirmed'?'!':state==='uncertain'?'?':'↗';$('stage-status').textContent={idle:'待建立参考',ready:'参考已保存',clear:'当前未见新增障碍',obstructed:'疑似障碍 · 待确认',confirmed:'已确认 · 待复查',uncertain:'暂无法判断',dismissed:'人工已排除'}[state]||state;$('metric').hidden=!result||result.status==='uncertain';if(result)$('overlap-value').textContent=`${(result.overlapRatio*100).toFixed(1)}%`;$('confirm-actions').hidden=!(state==='obstructed'&&incident?.status!=='confirmed');$('recheck-button').hidden=incident?.status!=='confirmed';$('analyze-button').hidden=incident?.status==='confirmed';drawOverlay();}
function clearReference(message='保存空通道参考后，ClearPath 才能比较后续画面的变化。'){cancelPendingAnalysis({invalidate:false});clearAnalysisEvidence();
  reference=null;incident=null;editing=false;draft=[];$('monitor').checked=false;$('analyze-button').disabled=true;$('reference-label').textContent='参考帧：未保存';$('edit-region').textContent='点选四角';$('calibration-help').textContent='先标出你希望保持畅通的区域，再保存一帧空通道作为参考。';syncNumericRegion();showState('idle','先认识你的通道',message);setWorkflow(0);
}
function syncNumericRegion(){polygon.forEach((point,index)=>{for(const axis of ['x','y'])$(`region-${index+1}-${axis}`).value=String(point[axis]);});$('numeric-region-message').textContent='';}
function applyNumericRegion(){
  const candidate=Array.from({length:4},(_,index)=>({x:$(`region-${index+1}-x`).valueAsNumber,y:$(`region-${index+1}-y`).valueAsNumber}));
  const reject=message=>{$('numeric-region-message').textContent=tr(message);};
  if(!candidate.every(point=>[point.x,point.y].every(value=>Number.isFinite(value)&&value>=0&&value<=1))){reject('请填写全部八个坐标，数值须在 0 到 1 之间。');return;}
  // A neutral validation frame reuses the detector's polygon and minimum-area
  // rules without reading media, requiring a ready source, or changing result.
  const data=new Uint8ClampedArray(160*90*4);for(let i=0;i<data.length;i+=4){data[i]=data[i+1]=data[i+2]=128;data[i+3]=255;}
  const frame={data,width:160,height:90},validation=analyzeFrame(frame,frame,candidate);
  if(validation.status==='uncertain'){reject(validation.message||'区域无效，请沿边缘顺序填写四角，避免交叉或重合。');return;}
  polygon=candidate;clearReference('数值区域已应用。请确认当前通道为空，再保存新的参考帧。');
  $('calibration-help').textContent=tr('区域已更新。确认画面为空通道后，重新保存参考。');
  $('numeric-region-message').textContent=tr('数值区域已应用。旧参考已清除，请重新保存空通道参考。');drawOverlay();
}
$('apply-region').addEventListener('click',applyNumericRegion);
$('numeric-region').addEventListener('toggle',event=>{if(event.target.open)syncNumericRegion();});
$('numeric-region').addEventListener('keydown',event=>{if(event.key==='Enter'&&event.target.matches('input')){event.preventDefault();applyNumericRegion();}});
function saveReference(auto=false){cancelPendingAnalysis();if(!ready()){toast('请先打开摄像头、选择本地素材或连接 Ring 直播。');return false;}if(editing){toast('请先完成四角标定，或使用预设区域。');return false;}
  const candidate=pixels();const check=analyzeFrame(candidate,candidate,polygon);if(check.status==='uncertain'){toast(check.message||hints[check.reason]||'参考画面不适合检查，请调整后重试。');return false;}
  reference={frame:candidate,preview:registrationPreview(),time:new Date().toISOString(),stamp:frameStamp(),revision:mediaRevision};clearAnalysisEvidence();incident=null;$('analyze-button').disabled=false;$('reference-label').textContent=`参考帧：${formatTime(Date.now())}`;drawOverlay();record('reference',auto?'合成流程预演：以程序生成的空场景建立参考。':'用户将当前画面保存为空通道参考。');showState('ready','参考已准备好','画面有变化时点击检查。保持机位固定，以便准确比较通行区域。');setWorkflow(1);if(!auto)toast('空通道参考已保存。现在可放置物品并检查后续画面。');return true;
}
async function analyze({recheck=false,automatic=false}={}){
  if(checking){toast('正在本机处理当前证据帧，请稍候。');return;}
  if(!reference){if(!automatic)toast('请先保存一帧空通道参考。');return;}
  if(editing){if(!automatic)toast('请先完成区域标定。');return;}
  if(!ready()){clearAnalysisEvidence();showState('uncertain','画面暂不可用','请恢复视频来源，再使用新画面检查。');return;}
  if((source==='camera'||source==='ring')&&(video.paused||performance.now()-lastVideoArrival>8000)){clearAnalysisEvidence();showState('uncertain','等待新的视频帧','视频可能已暂停或中断。请恢复直播后再检查。');return;}
  let stamp=frameStamp();if(stamp===lastCheckedStamp&&!recheck){if(!automatic)toast('这是刚才检查过的同一帧。请播放视频、切换样例或选择后续照片。');return;}
  if(recheck&&!isLaterFrame(incident?.anchor,frameOrder())){toast('复查需要晚于人工确认的画面。倒回旧视频或重复同一帧不能完成复查。');return;}
  if(source==='file'&&!image)video.pause();
  const checkedPixels=pixels(),checkedAt=new Date().toISOString(),checkedFrame=ctx.getImageData(0,0,scene.width,scene.height),checkedOrder=frameOrder(),checkedPreview=source==='sample'?null:registrationPreview(),checkedReference=reference,checkedPolygon=structuredClone(polygon),checkedSource=source,checkedSession=mediaSession,checkedRevision=mediaRevision,generation=++analysisGeneration;
  stamp=frameStamp();analysisAbort?.abort();const controller=new AbortController();analysisAbort=controller;clearAnalysisEvidence();checking=true;$('analyze-button').disabled=true;$('recheck-button').disabled=true;showState('uncertain','正在检查当前画面','请稍候，结果将对应本次捕获的画面。');
  try{
    let expectedIdentity;
    if(source!=='sample'&&['127.0.0.1','localhost'].includes(globalThis.location?.hostname)){
      expectedIdentity=await localRegistrationIdentity({signal:controller.signal});
      if(generation!==analysisGeneration)return;
      if(!expectedIdentity||typeof expectedIdentity!=='object'||typeof expectedIdentity.available!=='boolean'||(expectedIdentity.available===true&&(!/^[a-f0-9]{64}$/i.test(expectedIdentity.sourceSha256||'')||!/^[a-f0-9]{64}$/i.test(expectedIdentity.protocolSha256||'')))){
        const error=new Error('无法确认本机处理版本，请刷新后重新检查。');error.name='BackendIdentityError';throw error;
      }
    }
    const assessment=await analyzeLocalPair(checkedReference.frame,checkedPixels,checkedPolygon,{referencePreview:checkedReference.preview,currentPreview:checkedPreview,signal:controller.signal,expectedIdentity});
    if(generation!==analysisGeneration||reference!==checkedReference||source!==checkedSource||mediaSession!==checkedSession||mediaRevision!==checkedRevision)return;
    if(assessment?.reason==='local_timeout'||assessment?.localRegistration?.reason==='local_timeout'){
      clearAnalysisEvidence();showState('uncertain','本机处理超时','本次检查未完成，请重试当前画面。');setWorkflow(incident?.status==='confirmed'?3:1);return;
    }
    if(!assessment||!['clear','obstructed','uncertain'].includes(assessment.status))throw new Error('本次检查没有返回有效结果，请重试。');
    result=assessment;
  }catch(error){if(generation===analysisGeneration&&error?.name!=='AbortError'){clearAnalysisEvidence();showState('uncertain',error?.name==='BackendIdentityError'?'处理版本已变化':'本机处理未完成',error?.message||'请重试当前画面。');setWorkflow(incident?.status==='confirmed'?3:1);}return;}finally{if(generation===analysisGeneration){checking=false;if(analysisAbort===controller)analysisAbort=null;$('analyze-button').disabled=!reference;$('recheck-button').disabled=false;}}
  lastCheckedStamp=stamp;analysisStamp=stamp;analysisOrder=checkedOrder;analysisCapturedAt=checkedAt;frozenFrame=checkedFrame;ctx.putImageData(checkedFrame,0,0);$('live-view-button').hidden=source==='sample'||!!image;$('region-label').textContent='当前显示检查证据帧';$('frame-time').textContent=`检查帧 ${formatTime(checkedAt)}`;
  const message=tr(result.message||hints[result.reason]||'请结合证据画面人工核对。');
  if(result.status==='obstructed'){
    if(!incident||['resolved','dismissed'].includes(incident.status))incident={status:'suspected',stamp,detectedAt:checkedAt};
    if(incident.status==='confirmed'){showState('confirmed','仍有变化需要处理',`${message} 复查尚未完成。`);setWorkflow(3);}
    else{incident.status='suspected';incident.stamp=stamp;showState('obstructed','这里可能挡路了',message+' 是否影响通行，由你确认。');setWorkflow(2);}
  }else if(result.status==='clear'){
    if(incident?.status==='confirmed'&&!recheck){showState('confirmed','新画面待复查','当前画面未见明显新增障碍。请点击复查，完成这次处理记录。');setWorkflow(3);}
    else if(incident?.status==='confirmed'&&recheck){incident.status='resolved';incident.resolvedAt=new Date().toISOString();showState('clear','复查已完成',`这帧后续画面与参考比较，未见明显新增障碍。${image?'照片按用户导入顺序比较，拍摄先后未核实。':'出门前仍请观察实际环境。'}`);setWorkflow(4);}
    else{if(incident?.status==='suspected')incident=null;showState('clear','当前未见新增障碍',message+' 仅表示当前参考比较结果。');setWorkflow(1);}
  }else{showState('uncertain','先别急着下结论',message);setWorkflow(incident?.status==='confirmed'?3:1);}
  if(!automatic||result.status!=='clear'||records[0]?.type!=='clear')record(recheck?'recheck':result.status,message,{analysis:result,capturedAt:checkedAt});
}
function selectSample(next){cancelPendingAnalysis();sample=next;mediaRevision++;$('region-label').textContent='虚线区域 = 希望保持畅通的区域';document.querySelectorAll('[data-scene]').forEach(b=>{b.classList.toggle('selected',b.dataset.scene===next);b.setAttribute('aria-pressed',b.dataset.scene===next);});paint();}
async function stopMedia(){selectedFileName='';selfRecorded=false;$('self-recorded').checked=false;$('file-name').textContent=tr('固定同一机位，先选择空通道素材。');frozenFrame=null;$('live-view-button').hidden=true;if(stream){stream.getTracks().forEach(t=>t.stop());stream=null;}const close=ringClose;ringClose=null;video.pause();video.srcObject=null;video.removeAttribute('src');video.load();if(mediaUrl){URL.revokeObjectURL(mediaUrl);mediaUrl=null;}image=null;lastVideoArrival=0;lastVideoTime=-1;if(close)await close();}
async function selectSource(next){if(source===next)return;const leavingRing=source==='ring',op=newOperation();source=next;mediaSession++;mediaRevision++;guide=false;clearReference('画面来源已改变。请为当前机位重新保存空通道参考。');await stopMedia();if(op.epoch!==mediaEpoch)return;if(leavingRing){try{await disconnectRing();}catch{}if(op.epoch!==mediaEpoch)return;$('ring-device').replaceChildren(new Option('先连接账号',''));$('ring-device').disabled=true;$('ring-live').disabled=true;$('ring-message').textContent='连接已断开，短时 token 已从本地服务内存移除。';}resize();ctx.fillStyle='#26372e';ctx.fillRect(0,0,scene.width,scene.height);document.querySelectorAll('[data-source]').forEach(b=>{b.classList.toggle('selected',b.dataset.source===next);b.setAttribute('aria-pressed',b.dataset.source===next);});['sample','camera','file','ring'].forEach(n=>$(`${n}-controls`).hidden=n!==next);refreshSourceLabels();if(next==='sample')selectSample('empty');else{ctx.fillStyle='#e3ebe0';ctx.font='24px sans-serif';ctx.textAlign='center';ctx.fillText(tr({camera:'开启摄像头，开始本地检查',file:'选择同一机位的视频或前后照片',ring:'连接官方 Playground 直播'}[next]),480,300);drawOverlay();}}
document.querySelectorAll('[data-source]').forEach(b=>b.addEventListener('click',()=>selectSource(b.dataset.source).catch(e=>toast(e.message))));
document.querySelectorAll('[data-scene]').forEach(b=>b.addEventListener('click',()=>selectSample(b.dataset.scene)));
$('save-reference').addEventListener('click',()=>saveReference());$('analyze-button').addEventListener('click',()=>analyze());$('recheck-button').addEventListener('click',()=>analyze({recheck:true}));
$('confirm-button').addEventListener('click',()=>{if(!incident||result?.status!=='obstructed')return;incident.status='confirmed';incident.confirmedAt=new Date().toISOString();incident.stamp=analysisStamp||frameStamp();incident.anchor=analysisOrder||frameOrder();record('confirmed','用户确认标记区域存在通行障碍。');showState('confirmed','已确认，等待处理','将物品挪出通行区域。完成后使用后续画面复查，当前记录会保持待处理。');setWorkflow(3);if(guide)toast('接下来：切换到“空通道”，再点击“使用后续画面复查”。');});
$('dismiss-button').addEventListener('click',()=>{if(!incident)return;incident.status='dismissed';record('dismissed','用户将当前疑似变化标记为不是通行障碍。');showState('dismissed','已记录你的判断','当前提示已由你排除。后续画面出现变化时，仍会重新提示。');setWorkflow(1);});
$('speak-button').addEventListener('click',()=>{if(!('speechSynthesis'in window)){toast('此浏览器暂不支持朗读。可使用屏幕阅读器读取状态文字。');return;}speechSynthesis.cancel();const speech=new SpeechSynthesisUtterance(`${$('assessment-title').textContent}。${$('assessment-description').textContent}`);speech.lang=language;speech.rate=.9;speechSynthesis.speak(speech);});
$('edit-region').addEventListener('click',()=>{if(editing){editing=false;draft=[];$('edit-region').textContent='点选四角';drawOverlay();return;}clearReference('正在调整通行区域。完成后请重新保存空通道参考。');editing=true;draft=[];$('edit-region').textContent='取消标定';$('calibration-help').textContent='沿通道边缘按顺时针或逆时针点选四角。也可聚焦画面，用方向键移动十字、Enter 确认，Esc 取消。';drawOverlay();});
$('preset-region').addEventListener('click',()=>{polygon=structuredClone(defaultPolygon);clearReference('已使用预设通行区域。请确认位置适合你的画面，再保存参考。');drawOverlay();toast('预设区域已应用。');});
overlay.addEventListener('click',event=>{if(!editing)return;const rect=overlay.getBoundingClientRect();draft.push({x:Math.max(0,Math.min(1,(event.clientX-rect.left)/rect.width)),y:Math.max(0,Math.min(1,(event.clientY-rect.top)/rect.height))});if(draft.length===4){polygon=structuredClone(draft);syncNumericRegion();editing=false;draft=[];$('edit-region').textContent='点选四角';$('calibration-help').textContent='区域已更新。确认画面为空通道后，重新保存参考。';toast('已标定四角，请保存空通道参考。');}drawOverlay();});
overlay.addEventListener('keydown',event=>{if(!editing)return;if(event.key==='Escape'){editing=false;draft=[];$('edit-region').textContent='点选四角';drawOverlay();return;}if(['ArrowLeft','ArrowRight','ArrowUp','ArrowDown','Enter',' '].includes(event.key)){event.preventDefault();const delta=event.shiftKey?.05:.01;if(event.key==='ArrowLeft')cursor.x-=delta;if(event.key==='ArrowRight')cursor.x+=delta;if(event.key==='ArrowUp')cursor.y-=delta;if(event.key==='ArrowDown')cursor.y+=delta;cursor.x=Math.max(0,Math.min(1,cursor.x));cursor.y=Math.max(0,Math.min(1,cursor.y));if(event.key==='Enter'||event.key===' '){draft.push({...cursor});if(draft.length===4){polygon=structuredClone(draft);syncNumericRegion();editing=false;draft=[];$('edit-region').textContent='点选四角';$('calibration-help').textContent='区域已更新。确认空通道后，重新保存参考。';toast('已标定四角，请保存空通道参考。');}}drawOverlay();}});
$('camera-start').addEventListener('click',async()=>{
  const op=newOperation();$('camera-start').disabled=true;
  try{
    if(!navigator.mediaDevices?.getUserMedia)throw new Error('摄像头需要浏览器支持与本地 localhost 或 HTTPS 地址。');
    await stopMedia();if(op.epoch!==mediaEpoch||source!=='camera')return;
    clearReference();mediaSession++;
    const candidate=await navigator.mediaDevices.getUserMedia({video:{width:{ideal:1280},height:{ideal:720},facingMode:'environment'},audio:false});
    if(op.epoch!==mediaEpoch||source!=='camera'){candidate.getTracks().forEach(t=>t.stop());return;}
    stream=candidate;candidate.getVideoTracks()[0].addEventListener('ended',()=>{if(stream!==candidate||source!=='camera')return;cancelPendingAnalysis();lastVideoArrival=0;$('monitor').checked=false;showState('uncertain','摄像头已关闭','请重新开启摄像头并使用新画面检查。');});
    video.srcObject=candidate;await video.play();if(op.epoch!==mediaEpoch)return;mediaRevision++;paint();toast('摄像头已开启。先保存空通道参考。');
  }catch(e){if(op.epoch===mediaEpoch)toast(e.name==='NotAllowedError'?'摄像头权限未开启。请在浏览器允许访问，或使用本地视频。':e.message);}finally{$('camera-start').disabled=false;}
});
$('media-file').addEventListener('change',async event=>{
  const file=event.target.files?.[0];event.target.value='';if(!file)return;
  if(!file.type.startsWith('image/')&&!file.type.startsWith('video/')){toast('请选择浏览器支持的视频或图片。');return;}
  const op=newOperation(),wasImage=!!image;await stopMedia();if(op.epoch!==mediaEpoch||source!=='file')return;
  if(!(wasImage&&file.type.startsWith('image/'))){clearReference('新的素材已载入。请先找到空通道画面并保存参考。');mediaSession++;}
  mediaRevision++;const url=URL.createObjectURL(file);mediaUrl=url;selectedFileName=file.name;selfRecorded=false;$('self-recorded').checked=false;refreshSourceLabels();$('video-play').disabled=!file.type.startsWith('video/');
  try{
    $('video-timeline').hidden=file.type.startsWith('image/');
    if(file.type.startsWith('image/')){
      const candidate=new Image();await new Promise((resolve,reject)=>{candidate.onload=resolve;candidate.onerror=()=>reject(new Error('图片无法解码，请尝试 JPEG 或 PNG。'));candidate.src=url;});
      if(op.epoch!==mediaEpoch||source!=='file')return;image=candidate;paint();toast(reference?'后续照片已载入，可检查或复查。拍摄时间由用户核对。':'图片已载入，请保存空通道参考。');
    }else{
      video.src=url;await new Promise((resolve,reject)=>{video.onloadeddata=resolve;video.onerror=()=>reject(new Error('视频无法解码，请尝试 MP4 / H.264。'));video.load();});
      if(op.epoch!==mediaEpoch||source!=='file')return;$('video-position').max=$('video-position-number').max=Number.isFinite(video.duration)?video.duration:1;$('video-position').value=video.currentTime;paint();toast('视频已载入。暂停在空通道画面并保存参考，再播放至后续时刻。');
    }
  }catch(e){if(op.epoch===mediaEpoch){image=null;toast(e.message);}}
});
$('video-play').addEventListener('click',()=>{if(!video.src)return;video.paused?video.play().catch(e=>toast(e.message)):video.pause();});
video.addEventListener('timeupdate',()=>{if(source==='file'&&!image){$('video-position').value=video.currentTime;if(document.activeElement!==$('video-position-number'))$('video-position-number').value=video.currentTime.toFixed(1);$('video-position-label').textContent=`${video.currentTime.toFixed(1)} s`;$('video-position').setAttribute('aria-valuetext',`${video.currentTime.toFixed(1)} 秒`);}});
video.addEventListener('seeking',()=>{cancelPendingAnalysis();$('region-label').textContent='视频正在跳转，请检查新的画面';});
function seekVideo(value){if(source!=='file'||image||!video.src)return;const position=Number(value);if(!Number.isFinite(position)||position<0||!Number.isFinite(video.duration)||position>video.duration)return;cancelPendingAnalysis();video.pause();video.currentTime=position;$('video-position').value=position;$('video-position-number').value=position.toFixed(1);$('region-label').textContent=tr('视频当前画面 · 请重新检查');}
$('video-position').addEventListener('input',event=>seekVideo(event.target.value));
$('video-seek').addEventListener('click',()=>seekVideo($('video-position-number').value));
$('video-position-number').addEventListener('keydown',event=>{if(event.key==='Enter'){event.preventDefault();seekVideo(event.target.value);}});
$('ring-controls').addEventListener('submit',async event=>{
  event.preventDefault();const token=$('ring-token').value.trim();$('ring-token').value='';if(!token){toast('请输入 Playground 生成的短时 access token。');return;}
  const op=newOperation(),button=event.submitter;button.disabled=true;$('ring-device').disabled=true;$('ring-live').disabled=true;$('ring-message').textContent='正在通过本地服务验证设备接口…';
  try{await stopMedia();if(op.epoch!==mediaEpoch||source!=='ring')return;clearReference();const devices=await connectRing(token);if(op.epoch!==mediaEpoch||source!=='ring')return;
    $('ring-device').replaceChildren();for(const device of devices){const originalLabel=device.attributes?.name||device.attributes?.description||device.id;const option=new Option(originalLabel,device.id);option.dataset.originalLabel=originalLabel;option.setAttribute('data-i18n-skip','');$('ring-device').append(option);}
    refreshSourceLabels();$('ring-device').disabled=!devices.length;$('ring-live').disabled=!devices.length;$('ring-message').textContent=devices.length?`已验证官方设备接口，找到 ${devices.length} 个设备。选择设备并打开直播，收到视频帧后才算画面接入完成。`:'官方接口返回了空设备列表。请检查 Playground 是否已添加设备。';
  }catch(e){if(op.epoch===mediaEpoch)$('ring-message').textContent=e.message;}finally{button.disabled=false;}
});
$('ring-live').addEventListener('click',async()=>{
  const device=$('ring-device').value;if(!device)return;const op=newOperation(),button=$('ring-live');button.disabled=true;$('ring-message').textContent='正在协商官方 WHEP 视频流…';
  try{
    await stopMedia();if(op.epoch!==mediaEpoch||source!=='ring')return;clearReference();mediaSession++;mediaRevision++;
    const close=await startRingVideo(device,video,message=>{if(op.epoch!==mediaEpoch||source!=='ring')return;cancelPendingAnalysis();lastVideoArrival=0;$('ring-message').textContent=message;showState('uncertain','Ring 直播已结束','重新打开直播后再检查。冻结的旧画面不能完成复查。');$('monitor').checked=false;},{signal:op.signal,iceServers:[]});
    if(op.epoch!==mediaEpoch||source!=='ring'){await close();return;}ringClose=close;paint();$('ring-message').textContent='已收到可解码的 Ring Playground 视频帧。请保留官方水印；直播有时限，结束后需重新打开。';record('source','实际收到 Ring Playground 视频帧；尚未进行通行状态验证。');
  }catch(e){if(op.epoch===mediaEpoch){$('ring-message').textContent=e.message;showState('uncertain','尚未取得 Ring 画面','请查看连接错误并重试。合成样例不能替代真实 Ring 验证。');}}finally{button.disabled=$('ring-device').disabled;}
});
$('ring-disconnect').addEventListener('click',async()=>{newOperation();await stopMedia();try{await disconnectRing();$('ring-message').textContent='已断开，token 已从本地服务内存移除。';}catch(e){$('ring-message').textContent=e.message;}$('ring-device').replaceChildren(new Option('先连接账号',''));$('ring-device').disabled=true;$('ring-live').disabled=true;$('ring-token').value='';clearReference('Ring 已断开。重新连接后需重新保存参考。');});
$('guide-button').addEventListener('click',async()=>{await selectSource('sample');selectSample('empty');polygon=structuredClone(defaultPolygon);syncNumericRegion();editing=false;if(!saveReference(true))return;guide=true;selectSample('inside');analyze();toast('这是合成样例。核对标记后点击“确认存在障碍”，再切回空通道复查。');$('main').scrollIntoView({behavior:'smooth',block:'start'});});
$('export-button').addEventListener('click',()=>{if(!records.length){toast('暂无记录，请先保存空通道参考。');return;}const payload={project:'ClearPath',exportedAt:new Date().toISOString(),version:1,disclaimer:tr('辅助参考比较，不代表通行安全；synthetic_sample 为合成演示，不能用于真实效果评测。'),engine:'local_reference_frame_difference',records};const url=URL.createObjectURL(new Blob([JSON.stringify(payload,null,2)],{type:'application/json'}));const a=document.createElement('a');a.href=url;a.download=`clearpath-evidence-${new Date().toISOString().slice(0,10)}.json`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);});
$('about-button').addEventListener('click',()=>$('about-dialog').showModal());$('close-dialog').addEventListener('click',()=>$('about-dialog').close());$('about-dialog').addEventListener('click',event=>{if(event.target===$('about-dialog')){const r=$('about-dialog').getBoundingClientRect();if(event.clientX<r.left||event.clientX>r.right||event.clientY<r.top||event.clientY>r.bottom)$('about-dialog').close();}});
$('fullscreen-button').addEventListener('click',()=>{if(document.fullscreenElement)document.exitFullscreen?.();else $('camera-stage').requestFullscreen?.().catch(()=>toast('浏览器暂不支持全屏查看。'));});
$('live-view-button').addEventListener('click',()=>{cancelPendingAnalysis();$('region-label').textContent='最新画面 · 请重新检查';paint();});
setInterval(()=>{if($('monitor').checked&&!document.hidden&&Date.now()-lastTime>2500){lastTime=Date.now();analyze({automatic:true});}},3000);
window.addEventListener('pagehide',()=>{cancelPendingAnalysis();mediaEpoch++;mediaAbort?.abort();if(stream)stream.getTracks().forEach(t=>t.stop());if(ringClose)ringClose();if(source==='ring')fetch('/api/ring/session',{method:'DELETE',keepalive:true}).catch(()=>{});cancelAnimationFrame(loop);});
syncNumericRegion();paint();showState('idle','先认识你的通道','保存空通道参考后，ClearPath 才能比较后续画面的变化。');animation();
