// Ring credentials are sent only to the same-origin loopback Python service.
export async function ringRequest(path, options = {}) {
  const response = await fetch(path, {...options, cache:'no-store'});
  if (!response.ok) {
    let message = `本地服务返回 ${response.status}`;
    let structured=false;
    try { const body = await response.json(); message = body.error?.message || message; structured=!!body.error; } catch {}
    if (response.status === 404&&!structured) message = '当前页面是静态预览。请在电脑运行 python3 server.py，再打开本地地址连接 Ring。';
    throw new Error(message);
  }
  return response;
}
let sessionQueue=Promise.resolve();
function serializeSession(operation){const pending=sessionQueue.then(operation);sessionQueue=pending.catch(()=>{});return pending;}
export function disconnectRing(){return serializeSession(()=>ringRequest('/api/ring/session',{method:'DELETE'}));}
export async function connectRing(token) {
  if (!['127.0.0.1','localhost'].includes(location.hostname)) throw new Error('Ring 接入只在本地服务启用。请运行 python3 server.py 并打开 http://127.0.0.1:8765。');
  return serializeSession(async()=>{
  await ringRequest('/api/ring/session', {method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({access_token:token})});
  const response = await ringRequest('/api/ring/devices');
  const body = await response.json();
  return Array.isArray(body.data) ? body.data : [];
  });
}
export async function startRingVideo(deviceId, video, onEnded, {signal,iceServers=[{urls:'stun:stun.l.google.com:19302'}]}={}) {
  const connection = new RTCPeerConnection({iceServers});
  let session = null;
  let closed = false;
  let released=false,ownedStream=null;
  let endError=null;
  const pendingWaits=new Set();
  const assertActive=()=>{if(signal?.aborted)throw new DOMException('画面来源已切换','AbortError');if(closed)throw endError;};
  // Stop UI waits immediately; consume late async results so an in-flight WHEP
  // response can still release its session instead of losing its Location.
  const waitFor=(operation,cleanup=()=>{})=>new Promise((resolve,reject)=>{
    let settled=false;
    const finish=(error,value)=>{if(settled)return;settled=true;pendingWaits.delete(cancel);cleanup();error?reject(error):resolve(value);};
    const cancel=error=>finish(error);
    pendingWaits.add(cancel);
    Promise.resolve(operation).then(value=>finish(null,value),error=>finish(error));
    try{assertActive();}catch(error){finish(error);}
  });
  const waitForEvent=(target,event,check,duration,message)=>{
    let timeout,ready;
    const operation=new Promise((resolve,reject)=>{
      ready=()=>{if(check())resolve();};
      target.addEventListener(event,ready);
      timeout=setTimeout(()=>reject(new Error(message)),duration);
      ready();
    });
    return waitFor(operation,()=>{clearTimeout(timeout);target.removeEventListener(event,ready);});
  };
  const close = async (reason=new Error('Ring 直播已结束。请重新打开直播。')) => {
    if(!closed){
      closed=true;endError=reason;
      for(const cancel of [...pendingWaits])cancel(reason);
      connection.close();
    }
    if(video.srcObject===ownedStream)video.srcObject = null;
    if (session&&!released) {released=true; try { await ringRequest(session,{method:'DELETE'}); } catch {} }
    signal?.removeEventListener('abort',onAbort);
  };
  const onAbort=()=>{void close(new DOMException('画面来源已切换','AbortError'));};
  signal?.addEventListener('abort',onAbort,{once:true});
  try {
    assertActive();
    connection.addTransceiver('video',{direction:'recvonly'});
    connection.ontrack = event => {
      if(closed||signal?.aborted)return;
      ownedStream=event.streams[0] || new MediaStream([event.track]);
      video.srcObject = ownedStream;
      video.play().catch(()=>{});
    };
    connection.onconnectionstatechange = () => {
      if (!closed && ['failed','disconnected','closed'].includes(connection.connectionState)) {
        void close(); onEnded('Ring 直播已结束。请重新打开直播；结束前的画面不能作为新复查证据。');
      }
    };
    await waitFor(connection.setLocalDescription(await waitFor(connection.createOffer())));
    assertActive();
    await waitForEvent(connection,'icegatheringstatechange',()=>connection.iceGatheringState==='complete',45000,'ICE 协商超时，请检查网络后重试。');
    assertActive();
    const response = await waitFor(ringRequest(`/api/ring/stream?device_id=${encodeURIComponent(deviceId)}`,{method:'POST',headers:{'Content-Type':'application/sdp'},body:connection.localDescription.sdp}).then(async response=>{
      const location=response.headers.get('Location');
      if (!location || !/^\/api\/ring\/stream\/[a-zA-Z0-9_-]+$/.test(location)) throw new Error('本地服务返回了不支持的会话地址。');
      session=location;
      if(closed)await close();
      return response;
    }));
    assertActive();
    await waitFor(connection.setRemoteDescription({type:'answer',sdp:await waitFor(response.text())}));
    await waitForEvent(video,'loadeddata',()=>video.readyState>=2&&video.videoWidth>0&&video.videoHeight>0&&video.srcObject===ownedStream&&ownedStream?.getVideoTracks().some(track=>track.readyState==='live'),18000,'已完成 Ring 协商，但未收到可解码的视频帧。');
    assertActive();
    return close;
  } catch (error) { await close(); throw error; }
}
