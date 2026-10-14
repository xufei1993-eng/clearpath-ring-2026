/**
 * ClearPath's local, reference-based change detector. No network or ML model.
 * `clear` means no substantial new visual change was found; it is NOT a safety
 * assessment. A person must confirm the reference shows the empty route.
 */

export const DEFAULT_OPTIONS = Object.freeze({
  differenceThreshold: 24,
  minComponentRatio: 0.0012,
  minOverlapRatio: 0.025,
  maxExposureShift: 18,
  minBrightness: 28,
  maxGlobalChangeRatio: 0.55,
});

const MESSAGES = {
  no_significant_change: '未发现明显新增变化；请结合画面人工确认。',
  new_change_in_path: '标定区域出现疑似新增障碍，请查看证据并人工确认。',
  invalid_reference: '参考画面无效，请重新采集清空后的通道。',
  invalid_frame: '当前画面无效或尺寸不一致，请重新采集。',
  invalid_polygon: '通道区域无效，请按边缘顺序重新标定。',
  region_too_small: '通道区域过小，当前分辨率不足以判断。',
  low_light: '画面过暗，暂时无法可靠比较。',
  overexposed: '画面严重过曝，暂时无法可靠比较。',
  transparent_frame: '画面包含缺失像素，请重新采集。',
  exposure_change: '整体曝光变化较大，请等待光线稳定后复查。',
  camera_moved: '疑似镜头移动，请重新标定并采集参考画面。',
  global_scene_change: '画面变化过大，无法区分新增障碍和场景变化。',
  shadow_or_dark_object: '检测到暗影或深色物体，无法区分，请人工确认。',
};

function result(status, reason, diagnostics = {}, extra = {}) {
  return { status, reason, message: MESSAGES[reason], overlapRatio: 0,
    changedRatio: 0, boxes: [], diagnostics, ...extra };
}

function finiteOption(value, fallback, min, max) {
  return Number.isFinite(value) ? Math.max(min, Math.min(max, value)) : fallback;
}

function frameValid(frame) {
  return !!frame && Number.isInteger(frame.width) && Number.isInteger(frame.height)
    && frame.width >= 16 && frame.height >= 16 && frame.width * frame.height <= 1_048_576
    && (frame.data instanceof Uint8ClampedArray || frame.data instanceof Uint8Array)
    && frame.data.length === frame.width * frame.height * 4;
}

function cross(a, b, c) {
  return (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
}

function onSegment(a, b, p) {
  return Math.abs(cross(a, b, p)) < 1e-10
    && p.x >= Math.min(a.x, b.x) - 1e-10 && p.x <= Math.max(a.x, b.x) + 1e-10
    && p.y >= Math.min(a.y, b.y) - 1e-10 && p.y <= Math.max(a.y, b.y) + 1e-10;
}

function segmentsIntersect(a, b, c, d) {
  const ca = cross(a, b, c), cb = cross(a, b, d);
  const cc = cross(c, d, a), cd = cross(c, d, b);
  return (ca * cb < 0 && cc * cd < 0) || onSegment(a, b, c)
    || onSegment(a, b, d) || onSegment(c, d, a) || onSegment(c, d, b);
}

function polygonValid(polygon) {
  if (!Array.isArray(polygon) || polygon.length < 3 || polygon.length > 32) return false;
  if (!polygon.every(p => p && Number.isFinite(p.x) && Number.isFinite(p.y)
    && p.x >= 0 && p.x <= 1 && p.y >= 0 && p.y <= 1)) return false;
  let area = 0;
  for (let i = 0; i < polygon.length; i++) {
    const a = polygon[i], b = polygon[(i + 1) % polygon.length];
    if (Math.hypot(a.x - b.x, a.y - b.y) < 1e-6) return false;
    area += a.x * b.y - b.x * a.y;
    for (let j = i + 1; j < polygon.length; j++) {
      if (j === i + 1 || (i === 0 && j === polygon.length - 1)) continue;
      if (segmentsIntersect(a, b, polygon[j], polygon[(j + 1) % polygon.length])) return false;
    }
  }
  return Math.abs(area) > 1e-8;
}

/** Boundary points count as inside. Coordinates use the same normalized space. */
export function pointInPolygon(point, polygon) {
  if (!point || !Array.isArray(polygon) || polygon.length < 3) return false;
  let inside = false;
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[j], b = polygon[i];
    if (onSegment(a, b, point)) return true;
    if (((a.y > point.y) !== (b.y > point.y))
      && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) inside = !inside;
  }
  return inside;
}

function luminance(data, index) {
  return 0.2126 * data[index] + 0.7152 * data[index + 1] + 0.0722 * data[index + 2];
}

function describeFrame(frame) {
  const pixels = frame.width * frame.height;
  const gray = new Float32Array(pixels);
  let sum = 0, dark = 0, clipped = 0, transparent = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4, light = luminance(frame.data, i);
    gray[p] = light; sum += light;
    if (light < 26) dark++;
    if (light > 249) clipped++;
    if (frame.data[i + 3] < 250) transparent++;
  }
  return { gray, brightness: sum / pixels, darkRatio: dark / pixels,
    clippedRatio: clipped / pixels, transparentRatio: transparent / pixels };
}

function translationHint(ref, cur, mask, width, height, exposureShift, roiPixels) {
  // Registration over reference edges. Prefer the outside of the route so a
  // new object inside it cannot look like camera motion. Include small rotation
  // and subpixel motion: narrow edge changes otherwise disappear in denoising.
  let points = [];
  const preferOutside = roiPixels < width * height * 0.72;
  for (let y = 4; y < height - 4; y += 2) {
    for (let x = 4; x < width - 4; x += 2) {
      const p = y * width + x;
      if (preferOutside && mask[p]) continue;
      const edge = Math.abs(ref[p - 1] - ref[p + 1]) + Math.abs(ref[p - width] - ref[p + width]);
      if (edge > 14) points.push(p);
    }
  }
  if (points.length < 30) return { textureSamples: points.length, detected: false };
  const stride = Math.max(1, Math.ceil(points.length / 1500));
  if (stride > 1) points = points.filter((_, index) => index % stride === 0);
  const centerX = (width - 1) / 2, centerY = (height - 1) / 2;
  function score(dx, dy, degrees = 0) {
    let error = 0, valid = 0;
    const radians = degrees * Math.PI / 180, cosine = Math.cos(radians), sine = Math.sin(radians);
    for (const p of points) {
      const x = p % width - centerX, y = Math.floor(p / width) - centerY;
      const tx = centerX + cosine * x - sine * y + dx;
      const ty = centerY + sine * x + cosine * y + dy;
      const ix = Math.floor(tx), iy = Math.floor(ty);
      if (ix < 0 || iy < 0 || ix >= width - 1 || iy >= height - 1) continue;
      const index = iy * width + ix, fx = tx - ix, fy = ty - iy;
      const light = (cur[index] * (1 - fx) + cur[index + 1] * fx) * (1 - fy)
        + (cur[index + width] * (1 - fx) + cur[index + width + 1] * fx) * fy;
      error += Math.min(80, Math.abs(light - ref[p] - exposureShift)); valid++;
    }
    return valid >= points.length * 0.8 ? error / valid : Infinity;
  }
  const baseline = score(0, 0);
  let best = baseline, dx = 0, dy = 0, rotationDegrees = 0;
  if (baseline < 4) return { textureSamples: points.length, baselineError: baseline, detected: false };
  for (let sy = -8; sy <= 8; sy++) {
    for (let sx = -8; sx <= 8; sx++) {
      if (!sx && !sy) continue;
      const error = score(sx, sy);
      if (error < best) { best = error; dx = sx; dy = sy; }
    }
  }
  const integerX = dx, integerY = dy;
  for (const sy of [-0.5, 0, 0.5]) for (const sx of [-0.5, 0, 0.5]) {
    const error = score(integerX + sx, integerY + sy);
    if (error < best) { best = error; dx = integerX + sx; dy = integerY + sy; }
  }
  // Always search around zero as well: repeating tiles can make the initial
  // translation optimum an alias several pixels away from the true rotation.
  const anchors = integerX || integerY ? [[0, 0], [integerX, integerY]] : [[0, 0]];
  for (const degrees of [-8, -5, -3, -2, -1, -0.5, -0.25, 0.25, 0.5, 1, 2, 3, 5, 8]) {
    for (const [anchorX, anchorY] of anchors) {
      for (const sy of [-1, 0, 1]) for (const sx of [-1, 0, 1]) {
        const error = score(anchorX + sx, anchorY + sy, degrees);
        if (error < best) { best = error; dx = anchorX + sx; dy = anchorY + sy; rotationDegrees = degrees; }
      }
    }
  }
  return { textureSamples: points.length, baselineError: baseline,
    bestError: best, dx, dy, rotationDegrees,
    detected: baseline > 4 && best < baseline * 0.65 && baseline - best > 2.5 };
}

/**
 * Compare fixed-camera RGBA frames against a human-confirmed empty reference.
 * Frames must already be scaled to a matching size (recommended 160×90).
 * Boxes are normalized, and refer to VISUAL CHANGE, not object recognition.
 */
function analyzeRawFrame(reference, current, polygon, options = {}, compensated = false) {
  if (!frameValid(reference)) return result('uncertain', 'invalid_reference');
  if (!frameValid(current) || current.width !== reference.width || current.height !== reference.height)
    return result('uncertain', 'invalid_frame');
  if (!polygonValid(polygon)) return result('uncertain', 'invalid_polygon');
  options = options && typeof options === 'object' ? options : {};
  const config = {
    differenceThreshold: finiteOption(options.differenceThreshold, DEFAULT_OPTIONS.differenceThreshold, 10, 80),
    minComponentRatio: finiteOption(options.minComponentRatio, DEFAULT_OPTIONS.minComponentRatio, 0.0003, 0.02),
    minOverlapRatio: finiteOption(options.minOverlapRatio, DEFAULT_OPTIONS.minOverlapRatio, 0.005, 0.25),
    maxExposureShift: finiteOption(options.maxExposureShift, DEFAULT_OPTIONS.maxExposureShift, 8, 40),
    minBrightness: finiteOption(options.minBrightness, DEFAULT_OPTIONS.minBrightness, 20, 60),
    maxGlobalChangeRatio: finiteOption(options.maxGlobalChangeRatio, DEFAULT_OPTIONS.maxGlobalChangeRatio, 0.3, 0.75),
  };
  const { width, height } = reference, pixels = width * height;
  const roi = new Uint8Array(pixels);
  let roiPixels = 0;
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      if (pointInPolygon({ x: (x + 0.5) / width, y: (y + 0.5) / height }, polygon)) {
        roi[y * width + x] = 1; roiPixels++;
      }
    }
  }
  const diagnostic = { width, height, roiPixels, roiAreaRatio: roiPixels / pixels,
    threshold: config.differenceThreshold };
  if (roiPixels < Math.max(40, pixels * 0.006)) return result('uncertain', 'region_too_small', diagnostic);
  const ref = describeFrame(reference), cur = describeFrame(current);
  Object.assign(diagnostic, { referenceBrightness: ref.brightness, currentBrightness: cur.brightness,
    referenceDarkRatio: ref.darkRatio, currentDarkRatio: cur.darkRatio,
    referenceClippedRatio: ref.clippedRatio, currentClippedRatio: cur.clippedRatio });
  let refRoiLight = 0, curRoiLight = 0, refRoiDark = 0, curRoiDark = 0;
  let refRoiClipped = 0, curRoiClipped = 0;
  for (let p = 0; p < pixels; p++) {
    if (!roi[p]) continue;
    refRoiLight += ref.gray[p]; curRoiLight += cur.gray[p];
    if (ref.gray[p] < 26) refRoiDark++;
    if (cur.gray[p] < 26) curRoiDark++;
    if (ref.gray[p] > 249) refRoiClipped++;
    if (cur.gray[p] > 249) curRoiClipped++;
  }
  Object.assign(diagnostic, { referenceRoiBrightness: refRoiLight / roiPixels,
    currentRoiBrightness: curRoiLight / roiPixels,
    referenceRoiDarkRatio: refRoiDark / roiPixels, currentRoiDarkRatio: curRoiDark / roiPixels });
  if (ref.transparentRatio > 0.01 || cur.transparentRatio > 0.01)
    return result('uncertain', 'transparent_frame', diagnostic);
  if (ref.brightness < config.minBrightness || cur.brightness < config.minBrightness
    || ref.darkRatio > 0.8 || cur.darkRatio > 0.8
    || diagnostic.referenceRoiBrightness < config.minBrightness
    || diagnostic.currentRoiBrightness < config.minBrightness
    || refRoiDark / roiPixels > 0.8 || curRoiDark / roiPixels > 0.8)
    return result('uncertain', 'low_light', diagnostic);
  if (ref.clippedRatio > 0.8 || cur.clippedRatio > 0.8
    || refRoiClipped / roiPixels > 0.8 || curRoiClipped / roiPixels > 0.8)
    return result('uncertain', 'overexposed', diagnostic);

  // A median offset handles small uniform brightness drift without learning a
  // new background (which could silently learn an obstacle as empty).
  const offsets = [];
  const sampleStride = Math.max(1, Math.floor(pixels / 10_000));
  for (let p = 0; p < pixels; p += sampleStride) offsets.push(cur.gray[p] - ref.gray[p]);
  offsets.sort((a, b) => a - b);
  const exposureShift = offsets[Math.floor(offsets.length / 2)];
  diagnostic.exposureShift = exposureShift;
  if (Math.abs(exposureShift) > config.maxExposureShift) return result('uncertain', 'exposure_change', diagnostic);

  const rawMask = new Uint8Array(pixels);
  let rawChanges = 0;
  for (let p = 0; p < pixels; p++) {
    const i = p * 4;
    let diff = 0;
    for (let c = 0; c < 3; c++) diff = Math.max(diff,
      Math.abs(current.data[i + c] - reference.data[i + c] - exposureShift));
    if (diff > config.differenceThreshold) { rawMask[p] = 1; rawChanges++; }
  }
  diagnostic.rawChangedRatio = rawChanges / pixels;
  if (!compensated && rawChanges / pixels > 0.003) {
    diagnostic.translation = translationHint(ref.gray, cur.gray, roi, width, height, exposureShift, roiPixels);
    if (diagnostic.translation.detected) return result('uncertain', 'camera_moved', diagnostic,
      { changedRatio: rawChanges / pixels });
  }

  const clean = new Uint8Array(pixels);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const p = y * width + x;
      let neighbors = 0;
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          if (x + dx >= 0 && x + dx < width && y + dy >= 0 && y + dy < height)
            neighbors += rawMask[p + dy * width + dx];
        }
      }
      if ((rawMask[p] && neighbors >= 4) || neighbors >= 7) clean[p] = 1;
    }
  }
  const visited = new Uint8Array(pixels), queue = new Int32Array(pixels);
  const minComponentPixels = Math.max(12, Math.ceil(config.minComponentRatio * pixels));
  const boxes = [];
  let retained = 0, overlapPixels = 0, outsidePixels = 0, shadowPixels = 0, componentCount = 0;
  let hasBroadComponent = false, largestComponent = null;
  for (let start = 0; start < pixels; start++) {
    if (!clean[start] || visited[start]) continue;
    let head = 0, tail = 1, inside = 0, shadow = 0;
    let minX = width, minY = height, maxX = 0, maxY = 0;
    queue[0] = start; visited[start] = 1;
    while (head < tail) {
      const p = queue[head++], x = p % width, y = Math.floor(p / width);
      minX = Math.min(minX, x); maxX = Math.max(maxX, x);
      minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      if (roi[p]) {
        inside++;
        // Multiplicative darkening with almost unchanged chromaticity can be a
        // cast shadow OR a dark object. A single image cannot disambiguate it.
        const adjusted = cur.gray[p] - exposureShift;
        const scale = adjusted / Math.max(1, ref.gray[p]);
        if (scale > 0.18 && scale < 0.94) {
          const i = p * 4;
          let colorError = 0;
          for (let c = 0; c < 3; c++) colorError = Math.max(colorError,
            Math.abs(current.data[i + c] - exposureShift - reference.data[i + c] * scale));
          if (colorError < 10) shadow++;
        }
      }
      for (let dy = -1; dy <= 1; dy++) {
        for (let dx = -1; dx <= 1; dx++) {
          const nx = x + dx, ny = y + dy, next = p + dy * width + dx;
          if (nx >= 0 && nx < width && ny >= 0 && ny < height && clean[next] && !visited[next]) {
            visited[next] = 1; queue[tail++] = next;
          }
        }
      }
    }
    if (tail < minComponentPixels) continue;
    const spanX = (maxX - minX + 1) / width, spanY = (maxY - minY + 1) / height;
    const componentAreaRatio = tail / pixels;
    if (!largestComponent || componentAreaRatio > largestComponent.areaRatio)
      largestComponent = { areaRatio: componentAreaRatio, spanX, spanY };
    if (spanX >= 0.8 && spanY >= 0.8 && componentAreaRatio >= 0.2) hasBroadComponent = true;
    componentCount++; retained += tail; overlapPixels += inside;
    outsidePixels += tail - inside; shadowPixels += shadow;
    if (inside > 0) boxes.push({ x: minX / width, y: minY / height,
      width: (maxX - minX + 1) / width, height: (maxY - minY + 1) / height,
      overlapRatio: inside / tail, roiOverlapRatio: inside / roiPixels,
      pixels: tail, overlapPixels: inside });
  }
  const changedRatio = retained / pixels, overlapRatio = overlapPixels / roiPixels;
  const outsideChangedRatio = outsidePixels / Math.max(1, pixels - roiPixels);
  // A broad connected change that also affects substantial background cannot
  // support a localized obstacle claim. It may be camera/scene drift, parallax,
  // or widespread occlusion. Reject it rather than presenting a full-frame box
  // as successful localization. These are conservative development guardrails,
  // not empirically validated accuracy or physical camera-motion thresholds.
  const broadBackgroundChange = hasBroadComponent && (pixels - roiPixels) / pixels >= 0.12
    && outsideChangedRatio >= 0.15;
  Object.assign(diagnostic, { minComponentPixels, componentCount, overlapPixels,
    outsideChangedRatio, shadowLikeRatio: shadowPixels / Math.max(1, overlapPixels),
    largestComponent, broadBackgroundChange });
  const details = { changedRatio, overlapRatio, boxes };
  if (broadBackgroundChange) {
    diagnostic.qualityGuard = 'broad_background_change';
    return result('uncertain', 'global_scene_change', diagnostic, details);
  }
  if (changedRatio > config.maxGlobalChangeRatio
    || (pixels - roiPixels > pixels * 0.12 && outsideChangedRatio > 0.45 && changedRatio > 0.28))
    return result('uncertain', 'global_scene_change', diagnostic, details);
  if (overlapRatio >= config.minOverlapRatio && overlapPixels >= 8) {
    if (shadowPixels / overlapPixels > 0.85)
      return result('uncertain', 'shadow_or_dark_object', diagnostic, details);
    return result('obstructed', 'new_change_in_path', diagnostic, details);
  }
  return result('clear', 'no_significant_change', diagnostic, details);
}

// Conservative alignment: unique background training matches, deterministic
// affine RANSAC, and independently held-out background + ROI verification.
// ROI points never fit the model; ambiguous or obscured points stay in the
// validation denominator. Dense patches avoid same-phase sampling aliases.
function sample(gray,x,y,w,h){if(x<0||y<0||x>=w-1||y>=h-1)return NaN;const ix=Math.floor(x),iy=Math.floor(y),fx=x-ix,fy=y-iy,p=iy*w+ix;return (gray[p]*(1-fx)+gray[p+1]*fx)*(1-fy)+(gray[p+w]*(1-fx)+gray[p+w+1]*fx)*fy;}
function features(gray,mask,w,h,inside,max=100){
 const candidates=[];
 for(let y=7;y<h-7;y+=2)for(let x=7;x<w-7;x+=2){const p=y*w+x;if(!!mask[p]!==inside)continue;let valid=true;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++)if(!!mask[p+dy*w+dx]!==inside)valid=false;if(!valid)continue;
 let xx=0,xy=0,yy=0;for(let dy=-1;dy<=1;dy++)for(let dx=-1;dx<=1;dx++){const q=p+dy*w+dx,gx=(gray[q+1]-gray[q-1])/2,gy=(gray[q+w]-gray[q-w])/2;xx+=gx*gx;xy+=gx*gy;yy+=gy*gy;}
 const score=(xx+yy-Math.sqrt((xx-yy)**2+4*xy*xy))/2;if(score>150)candidates.push({x,y,score});}
 candidates.sort((a,b)=>b.score-a.score);const selected=[],bins=new Uint8Array(16);
 for(const p of candidates){const bin=Math.min(3,Math.floor(p.y/h*4))*4+Math.min(3,Math.floor(p.x/w*4));if(bins[bin]>=12||selected.some(q=>(p.x-q.x)**2+(p.y-q.y)**2<64))continue;selected.push(p);bins[bin]++;if(selected.length>=max)break;}
 return selected;
}
function patch(gray,x,y,w,h,model=null){const values=[];for(let dy=-4;dy<=4;dy++)for(let dx=-4;dx<=4;dx++){const px=x+dx,py=y+dy;const tx=model?model[0]*px+model[1]*py+model[2]:px,ty=model?model[3]*px+model[4]*py+model[5]:py;const v=sample(gray,tx,ty,w,h);if(!Number.isFinite(v))return null;values.push(v);}const mean=values.reduce((a,b)=>a+b,0)/values.length;const centered=values.map(v=>v-mean),std=Math.sqrt(centered.reduce((a,b)=>a+b*b,0)/values.length);return {centered,std};}
function error(a,b){if(!a||!b||a.std<8||b.std/a.std<.65||b.std/a.std>1.55)return Infinity;let sum=0;for(let i=0;i<a.centered.length;i++)sum+=Math.abs(a.centered[i]-b.centered[i]);return sum/a.centered.length;}
function backgroundPatch(mask,x,y,w,h){if(x<6||y<6||x>=w-6||y>=h-6)return false;for(let dy=-5;dy<=5;dy++)for(let dx=-5;dx<=5;dx++){const ix=Math.round(x+dx),iy=Math.round(y+dy);if(mask[iy*w+ix])return false;}return true;}
function roiPatchCheck(ref,cur,p,model,w,h){const source=patch(ref,p.x,p.y,w,h),choices=[];for(let dy=-6;dy<=6;dy++)for(let dx=-6;dx<=6;dx++){const shifted=[...model];shifted[2]+=dx;shifted[5]+=dy;const e=error(source,patch(cur,p.x,p.y,w,h,shifted));if(Number.isFinite(e))choices.push({dx,dy,error:e});}choices.sort((a,b)=>a.error-b.error);const best=choices[0],second=best&&choices.find(q=>(q.dx-best.dx)**2+(q.dy-best.dy)**2>=9);const predicted=error(source,patch(cur,p.x,p.y,w,h,model));const unique=!!best&&!!second&&best.error<second.error*.82&&second.error-best.error>=1.5;return {...p,error:predicted,unique,displacement:best?Math.hypot(best.dx,best.dy):Infinity};}
function solve(matrix,values){const a=matrix.map((row,i)=>[...row,values[i]]);for(let c=0;c<3;c++){let r=c;for(let i=c+1;i<3;i++)if(Math.abs(a[i][c])>Math.abs(a[r][c]))r=i;if(Math.abs(a[r][c])<1e-7)return null;[a[c],a[r]]=[a[r],a[c]];const d=a[c][c];for(let j=c;j<4;j++)a[c][j]/=d;for(let i=0;i<3;i++)if(i!==c){const f=a[i][c];for(let j=c;j<4;j++)a[i][j]-=f*a[c][j];}}return a.map(row=>row[3]);}
function fit(matches){const normal=Array.from({length:3},()=>[0,0,0]),vx=[0,0,0],vy=[0,0,0];for(const p of matches){const row=[p.x,p.y,1];for(let i=0;i<3;i++){vx[i]+=row[i]*p.tx;vy[i]+=row[i]*p.ty;for(let j=0;j<3;j++)normal[i][j]+=row[i]*row[j];}}const x=solve(normal,vx),y=solve(normal,vy);return x&&y?[...x,...y]:null;}
function distance(m,p){return Math.hypot(m[0]*p.x+m[1]*p.y+m[2]-p.tx,m[3]*p.x+m[4]*p.y+m[5]-p.ty);}
function coverage(points,w,h){const bins=new Set(),quadrants=new Set();for(const p of points){bins.add(Math.min(3,Math.floor(p.y/h*4))*4+Math.min(3,Math.floor(p.x/w*4)));quadrants.add((p.y>=h/2?2:0)+(p.x>=w/2?1:0));}return {bins:bins.size,quadrants:quadrants.size,spanX:points.length?(Math.max(...points.map(p=>p.x))-Math.min(...points.map(p=>p.x)))/w:0,spanY:points.length?(Math.max(...points.map(p=>p.y))-Math.min(...points.map(p=>p.y)))/h:0};}
function estimateSmallAlignment(ref,cur,mask,w,h){
 const diag={applied:false,model:'affine',outsideFeatures:0,matches:0,inliers:0,validationFeatures:0,validationAccepted:0};
 const reject=reason=>({ok:false,reason,diagnostics:diag});
 if(w*h>262144)return reject('alignment_resolution_too_large');
 const outside=features(ref,mask,w,h,false),inside=features(ref,mask,w,h,true,80);diag.outsideFeatures=outside.length;diag.validationFeatures=inside.length;
 if(outside.length<12||inside.length<12)return reject('insufficient_texture');
 const heldout=outside.filter((p,i)=>i%3===0);const training=outside.filter((p,i)=>i%3!==0);diag.trainingFeatures=training.length;diag.outsideValidationFeatures=heldout.length;
 const searchRadius=14;diag.searchRadius=searchRadius;const matches=[];
 for(const p of training){const reference=patch(ref,p.x,p.y,w,h);if(reference.std<8)continue;const choices=[];
  for(let dy=-searchRadius;dy<=searchRadius;dy++)for(let dx=-searchRadius;dx<=searchRadius;dx++){const x=p.x+dx,y=p.y+dy;if(x<6||y<6||x>=w-6||y>=h-6||!!mask[Math.round(y)*w+Math.round(x)]!==false||!backgroundPatch(mask,x,y,w,h))continue;const candidate=patch(cur,x,y,w,h),e=error(reference,candidate);if(Number.isFinite(e))choices.push({x,y,e});}
  choices.sort((a,b)=>a.e-b.e);const best=choices[0],second=best&&choices.find(q=>(q.x-best.x)**2+(q.y-best.y)**2>=9);if(!best||!second||best.e>9||best.e>second.e*.82||second.e-best.e<1.5)continue;
  let refined=best;for(const dy of [-.5,0,.5])for(const dx of [-.5,0,.5]){if(!backgroundPatch(mask,best.x+dx,best.y+dy,w,h))continue;const e=error(reference,patch(cur,best.x+dx,best.y+dy,w,h));if(e<refined.e)refined={x:best.x+dx,y:best.y+dy,e};}
  matches.push({...p,tx:refined.x,ty:refined.y,patchError:refined.e});
 }
 diag.matches=matches.length;if(matches.length<12)return reject('insufficient_unique_matches');
 let seed=0x51e2a5,best=[];const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed%matches.length;};
 for(let i=0;i<320;i++){const chosen=new Set();while(chosen.size<3)chosen.add(random());const model=fit([...chosen].map(j=>matches[j]));if(!model)continue;const inliers=matches.filter(p=>distance(model,p)<1.25);if(inliers.length>best.length)best=inliers;}
 diag.inliers=best.length;diag.inlierRatio=best.length/matches.length;if(best.length<12||diag.inlierRatio<.7)return reject('inconsistent_background');
 const model=fit(best);if(!model)return reject('degenerate_model');diag.matrix=model;diag.inlierError=best.reduce((a,p)=>a+distance(model,p),0)/best.length;diag.backgroundCoverage=coverage(best,w,h);
 if(diag.inlierError>.8||diag.backgroundCoverage.bins<5||diag.backgroundCoverage.quadrants<3||diag.backgroundCoverage.spanX<.45||diag.backgroundCoverage.spanY<.4)return reject('insufficient_background_coverage');
 const determinant=model[0]*model[4]-model[1]*model[3],scaleX=Math.hypot(model[0],model[3]),scaleY=Math.hypot(model[1],model[4]),rotation=Math.atan2(model[3],model[0])*180/Math.PI,shear=(model[0]*model[1]+model[3]*model[4])/(scaleX*scaleY);
 diag.bounds={determinant,scaleX,scaleY,rotation,shear};const corners=[[0,0],[w-1,0],[w-1,h-1],[0,h-1]];diag.maxDisplacement=Math.max(...corners.map(([x,y])=>Math.hypot(model[0]*x+model[1]*y+model[2]-x,model[3]*x+model[4]*y+model[5]-y)));
 if(diag.maxDisplacement<.5)return reject('no_material_motion');
 if(determinant<=0||Math.abs(scaleX-1)>.04||Math.abs(scaleY-1)>.04||Math.abs(rotation)>2||Math.abs(shear)>.04||diag.maxDisplacement>Math.min(w,h)*.06)return reject('motion_out_of_bounds');
 const outsideChecks=heldout.map(p=>({...p,before:error(patch(ref,p.x,p.y,w,h),patch(cur,p.x,p.y,w,h)),error:error(patch(ref,p.x,p.y,w,h),patch(cur,p.x,p.y,w,h,model))}));const outsideAccepted=outsideChecks.filter(p=>p.error<9);diag.outsideValidationAccepted=outsideAccepted.length;diag.outsideValidationRatio=outsideAccepted.length/heldout.length;diag.outsideValidationCoverage=coverage(outsideAccepted,w,h);const median=values=>values.sort((a,b)=>a-b)[Math.floor(values.length/2)];diag.outsideMedianBefore=median(outsideChecks.map(p=>p.before));diag.outsideMedianAfter=median(outsideChecks.map(p=>p.error));
 if(outsideAccepted.length<8||diag.outsideValidationRatio<.75||diag.outsideValidationCoverage.quadrants<3||diag.outsideMedianAfter>6||(diag.outsideMedianBefore>4&&diag.outsideMedianAfter>diag.outsideMedianBefore*.75))return reject('outside_holdout_failed');
 const validations=inside.map(p=>roiPatchCheck(ref,cur,p,model,w,h));const accepted=validations.filter(p=>p.error<9&&p.unique&&p.displacement<=1.25);diag.validationAmbiguous=validations.filter(p=>!p.unique).length;diag.validationDisagreed=validations.filter(p=>p.unique&&p.displacement>1.25).length;diag.validationAccepted=accepted.length;diag.validationRatio=accepted.length/inside.length;diag.validationCoverage=coverage(accepted,w,h);diag.validationMedian=validations.map(p=>p.error).sort((a,b)=>a-b)[Math.floor(validations.length/2)];
 if(accepted.length<12||diag.validationRatio<.6||diag.validationCoverage.bins<3||diag.validationCoverage.quadrants<2)return reject('roi_validation_failed');
 let minX=w,maxX=0,minY=h,maxY=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){minX=Math.min(minX,x);maxX=Math.max(maxX,x);minY=Math.min(minY,y);maxY=Math.max(maxY,y);}const roiBins=[0,0,0,0];for(const p of accepted)roiBins[(p.y>(minY+maxY)/2?2:0)+(p.x>(minX+maxX)/2?1:0)]++;diag.roiValidationBins=roiBins;if(roiBins.filter(n=>n>=3).length<3||diag.validationCoverage.spanX<(maxX-minX)/w*.5||diag.validationCoverage.spanY<(maxY-minY)/h*.5)return reject('roi_validation_coverage_failed');
 let roiPixels=0,invalid=0;for(let y=0;y<h;y++)for(let x=0;x<w;x++)if(mask[y*w+x]){roiPixels++;let valid=x>=2&&y>=2&&x<w-2&&y<h-2;for(const dy of [-2,2])for(const dx of [-2,2]){const tx=model[0]*(x+dx)+model[1]*(y+dy)+model[2],ty=model[3]*(x+dx)+model[4]*(y+dy)+model[5];if(tx<0||ty<0||tx>=w-1||ty>=h-1)valid=false;}if(!valid)invalid++;}diag.invalidRoiRatio=invalid/roiPixels;diag.prefilterRadius=1;diag.requiredSupportRadius=2;if(invalid)return reject('roi_out_of_bounds');
 diag.applied=true;return {ok:true,model,diagnostics:diag};
}

function makeRegistrationMask(polygon, width, height) {
  const mask = new Uint8Array(width * height);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    mask[y * width + x] = pointInPolygon({ x: (x + 0.5) / width, y: (y + 0.5) / height }, polygon) ? 1 : 0;
  }
  return mask;
}

function warpCurrentToReference(reference, current, matrix) {
  const { width, height } = reference;
  // Unavailable border pixels outside the ROI are filled from reference for
  // comparison only. Full ROI + prefilter/denoising support was already checked; none of
  // these substitutions can silently remove an unknown part of the route.
  const data = new Uint8ClampedArray(reference.data);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const tx = matrix[0] * x + matrix[1] * y + matrix[2];
    const ty = matrix[3] * x + matrix[4] * y + matrix[5];
    if (tx < 0 || ty < 0 || tx >= width - 1 || ty >= height - 1) continue;
    const ix = Math.floor(tx), iy = Math.floor(ty), fx = tx - ix, fy = ty - iy;
    const source = (iy * width + ix) * 4, dest = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel++) {
      data[dest + channel] = (current.data[source + channel] * (1 - fx)
        + current.data[source + 4 + channel] * fx) * (1 - fy)
        + (current.data[source + width * 4 + channel] * (1 - fx)
        + current.data[source + width * 4 + 4 + channel] * fx) * fy;
    }
  }
  return { data, width, height };
}

function commonSamplingFilter(frame) {
  const { width, height } = frame, data = new Uint8ClampedArray(frame.data.length);
  // Identical binomial kernel on both frames, after accepted registration.
  // The difference threshold remains unchanged. This reduces resampling edge
  // artifacts, with the tradeoff that very small visual changes may disappear.
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const dest = (y * width + x) * 4;
    for (let channel = 0; channel < 4; channel++) {
      let sum = 0;
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const sx = Math.max(0, Math.min(width - 1, x + dx));
        const sy = Math.max(0, Math.min(height - 1, y + dy));
        sum += frame.data[(sy * width + sx) * 4 + channel] * (dx === 0 ? 2 : 1) * (dy === 0 ? 2 : 1);
      }
      data[dest + channel] = sum / 16;
    }
  }
  return { data, width, height };
}

function unfilteredChromaticChange(reference, warped, mask, threshold) {
  let routePixels = 0, routeChanges = 0, changed = 0, unsupported = 0, routeUnsupported = 0;
  const pixels = reference.width * reference.height;
  for (let p = 0; p < pixels; p++) {
    const index = p * 4;
    const red = warped.data[index] - reference.data[index];
    const green = warped.data[index + 1] - reference.data[index + 1];
    const blue = warped.data[index + 2] - reference.data[index + 2];
    const light = .2126 * red + .7152 * green + .0722 * blue;
    const color = Math.max(Math.abs(red - light), Math.abs(green - light), Math.abs(blue - light));
    const colorOnly = color > threshold && Math.abs(light) < threshold / 2;
    if (colorOnly) changed++;
    let unexpectedColor = false;
    if (colorOnly) {
      const x = p % reference.width, y = Math.floor(p / reference.width);
      const min = [Infinity, Infinity, Infinity], max = [-Infinity, -Infinity, -Infinity];
      // Ordinary interpolation stays within the nearby reference color
      // envelope. A new color texture on a gray/local constant surface does
      // not. This avoids treating natural colored edges as a new object.
      for (let dy = -1; dy <= 1; dy++) for (let dx = -1; dx <= 1; dx++) {
        const sx = Math.max(0, Math.min(reference.width - 1, x + dx));
        const sy = Math.max(0, Math.min(reference.height - 1, y + dy));
        const index = (sy * reference.width + sx) * 4;
        const luminance = .2126 * reference.data[index] + .7152 * reference.data[index + 1]
          + .0722 * reference.data[index + 2];
        for (let c = 0; c < 3; c++) {
          const value = reference.data[index + c] - luminance;
          min[c] = Math.min(min[c], value); max[c] = Math.max(max[c], value);
        }
      }
      const currentLight = .2126 * warped.data[index] + .7152 * warped.data[index + 1]
        + .0722 * warped.data[index + 2];
      for (let c = 0; c < 3; c++) {
        const value = warped.data[index + c] - currentLight;
        if (value < min[c] - threshold || value > max[c] + threshold) unexpectedColor = true;
      }
    }
    if (unexpectedColor) unsupported++;
    if (mask[p]) { routePixels++; if (colorOnly) routeChanges++; }
    if (mask[p] && unexpectedColor) routeUnsupported++;
  }
  const routeRatio = routeChanges / Math.max(1, routePixels), frameRatio = changed / pixels;
  // Luma-based registration cannot justify erasing widespread color-only
  // changes with a low-pass filter, even if its geometry is correct.
  return { routeRatio, frameRatio, unsupportedRouteRatio: routeUnsupported / Math.max(1, routePixels),
    unsupportedFrameRatio: unsupported / pixels, referenceNeighborhoodRadius: 1,
    rejected: routeRatio >= .15 || frameRatio >= .15 };
}

function mapNormalizedPoint(point, matrix, width, height) {
  const x = point.x * width, y = point.y * height;
  return { x: (matrix[0] * x + matrix[1] * y + matrix[2]) / width,
    y: (matrix[3] * x + matrix[4] * y + matrix[5]) / height };
}

function currentFrameResult(assessment, polygon, width, height, alignment = null) {
  const identity = [1, 0, 0, 0, 1, 0], matrix = alignment?.applied ? alignment.matrix : identity;
  const displayPolygon = polygonValid(polygon)
    ? polygon.map(point => mapNormalizedPoint(point, matrix, width || 1, height || 1)) : null;
  const boxes = !alignment?.applied ? assessment.boxes : assessment.boxes.map(box => {
    const corners = [{ x: box.x, y: box.y }, { x: box.x + box.width, y: box.y },
      { x: box.x + box.width, y: box.y + box.height }, { x: box.x, y: box.y + box.height }]
      .map(point => mapNormalizedPoint(point, matrix, width, height));
    const minX = Math.max(0, Math.min(...corners.map(point => point.x)));
    const minY = Math.max(0, Math.min(...corners.map(point => point.y)));
    const maxX = Math.min(1, Math.max(...corners.map(point => point.x)));
    const maxY = Math.min(1, Math.max(...corners.map(point => point.y)));
    return { ...box, x: minX, y: minY, width: Math.max(0, maxX - minX),
      height: Math.max(0, maxY - minY), corners };
  });
  return { ...assessment, boxes, displayPolygon, coordinateSpace: 'current_frame',
    alignment: alignment || { applied: false, reason: 'not_required', prefilter: null } };
}

/**
 * Public API. Apply bounded affine compensation only after the ordinary
 * comparison reports camera/global scene uncertainty. A failed independent
 * verification never changes uncertainty into a clear/obstructed claim.
 * Boxes and displayPolygon always refer to the current, unwarped input frame.
 */
export function analyzeFrame(reference, current, polygon, options = {}) {
  const original = analyzeRawFrame(reference, current, polygon, options);
  const width = current?.width, height = current?.height;
  if (!['camera_moved', 'global_scene_change'].includes(original.reason))
    return currentFrameResult(original, polygon, width, height);
  const mask = makeRegistrationMask(polygon, width, height);
  const estimate = estimateSmallAlignment(describeFrame(reference).gray,
    describeFrame(current).gray, mask, width, height);
  const alignment = { ...estimate.diagnostics, applied: estimate.ok,
    reason: estimate.ok ? 'independently_verified_small_affine' : estimate.reason,
    direction: 'reference_to_current', matrix: estimate.ok ? estimate.model : null,
    prefilter: estimate.ok ? 'binomial_3x3_both_frames' : null };
  if (!estimate.ok) {
    return currentFrameResult({ ...original,
      diagnostics: { ...original.diagnostics, alignment } }, polygon, width, height, alignment);
  }
  const warped = warpCurrentToReference(reference, current, estimate.model);
  const chromatic = unfilteredChromaticChange(reference, warped, mask, original.diagnostics.threshold);
  alignment.unfilteredChromaticChange = chromatic;
  if (chromatic.rejected) {
    alignment.applied = false;
    alignment.reason = 'unfiltered_chromatic_change';
    alignment.prefilter = null;
    return currentFrameResult({ ...original, status: 'uncertain', reason: 'global_scene_change',
      message: MESSAGES.global_scene_change, diagnostics: { ...original.diagnostics,
        qualityGuard: 'unfiltered_chromatic_change', alignment } }, polygon, width, height, alignment);
  }
  const compared = analyzeRawFrame(commonSamplingFilter(reference),
    commonSamplingFilter(warped), polygon, options, true);
  const minimumOverlap = finiteOption(options?.minOverlapRatio, DEFAULT_OPTIONS.minOverlapRatio, .005, .25);
  if (compared.status === 'clear' && chromatic.unsupportedRouteRatio >= minimumOverlap) {
    alignment.applied = false;
    alignment.reason = 'filtered_chromatic_evidence_lost';
    alignment.prefilterEvaluated = alignment.prefilter;
    alignment.prefilter = null;
    return currentFrameResult({ ...original, status: 'uncertain', reason: 'global_scene_change',
      message: MESSAGES.global_scene_change, diagnostics: { ...original.diagnostics,
        qualityGuard: 'filtered_chromatic_evidence_lost', alignment } }, polygon, width, height, alignment);
  }
  compared.diagnostics.alignment = alignment;
  compared.diagnostics.preAlignment = { status: original.status, reason: original.reason,
    changedRatio: original.changedRatio, overlapRatio: original.overlapRatio,
    outsideChangedRatio: original.diagnostics.outsideChangedRatio };
  return currentFrameResult(compared, polygon, width, height, alignment);
}
