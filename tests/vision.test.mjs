import test from 'node:test';
import assert from 'node:assert/strict';
import { analyzeFrame, pointInPolygon } from '../dist/vision.mjs';

const width = 160, height = 90;
const route = [{ x: 0.3, y: 0.2 }, { x: 0.7, y: 0.2 }, { x: 0.7, y: 0.95 }, { x: 0.3, y: 0.95 }];
function frame(color = [150, 150, 150], patterned = false) {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const p = (y * width + x) * 4;
    const offset = patterned ? ((Math.floor(x / 7) + Math.floor(y / 7)) % 2) * 50 - 25 : 0;
    data.set([...color.map(v => v + offset), 255], p);
  }
  return { data, width, height };
}
function copy(source) { return { ...source, data: new Uint8ClampedArray(source.data) }; }
function rect(target, x, y, w, h, color = [170, 60, 35]) {
  for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++) {
    target.data.set([...color, 255], (cy * width + cx) * 4);
  }
  return target;
}

test('unchanged human-confirmed empty reference is visually clear', () => {
  const a = frame();
  const result = analyzeFrame(a, copy(a), route);
  assert.equal(result.status, 'clear');
  assert.equal(result.overlapRatio, 0);
  assert.deepEqual(result.boxes, []);
});

test('colored visual change inside route is suspected obstruction with normalized evidence', () => {
  const a = frame();
  const result = analyzeFrame(a, rect(copy(a), 61, 48, 27, 22), route);
  assert.equal(result.status, 'obstructed');
  assert.equal(result.boxes.length, 1);
  assert.ok(result.overlapRatio > 0.1);
  assert.ok(result.boxes[0].x > 0 && result.boxes[0].width < 1);
  assert.equal(result.boxes[0].overlapRatio, 1);
});

test('outside-route change does not trigger obstruction', () => {
  const a = frame();
  const result = analyzeFrame(a, rect(copy(a), 6, 30, 25, 30), route);
  assert.equal(result.status, 'clear');
  assert.equal(result.overlapRatio, 0);
  assert.equal(result.boxes.length, 0);
  assert.ok(result.changedRatio > 0);
});

test('partial overlap counts pixels inside the polygon, not the entire rectangle', () => {
  const a = frame();
  const result = analyzeFrame(a, rect(copy(a), 40, 45, 25, 25), route);
  assert.equal(result.status, 'obstructed');
  assert.ok(result.boxes[0].overlapRatio > 0.5 && result.boxes[0].overlapRatio < 0.8);
});

test('isolated sensor noise and tiny components are discarded', () => {
  const a = frame(), b = copy(a);
  for (let i = 0; i < 170; i++) {
    const x = (i * 31) % width, y = (i * 17) % height;
    b.data.set([240, 20, 10, 255], (y * width + x) * 4);
  }
  rect(b, 75, 50, 2, 2);
  assert.equal(analyzeFrame(a, b, route).status, 'clear');
});

test('small consistent brightness drift is compensated', () => {
  const a = frame(), b = frame([158, 158, 158]);
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'clear');
  assert.equal(result.diagnostics.exposureShift, 8);
});

test('large global exposure change is uncertain, never clear', () => {
  const result = analyzeFrame(frame(), frame([205, 205, 205]), route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'exposure_change');
});

test('low light in either frame is uncertain', () => {
  for (const [a, b] of [[frame([12, 12, 12]), frame()], [frame(), frame([12, 12, 12])]]) {
    const result = analyzeFrame(a, b, route);
    assert.equal(result.status, 'uncertain');
    assert.equal(result.reason, 'low_light');
  }
});

test('overexposed or transparent pixels cannot become clear', () => {
  const white = frame([255, 255, 255]);
  assert.equal(analyzeFrame(white, white, route).reason, 'overexposed');
  const a = frame(), b = copy(a);
  for (let p = 0; p < b.data.length; p += 4) b.data[p + 3] = 0;
  assert.equal(analyzeFrame(a, b, route).reason, 'transparent_frame');
});

test('a dark or clipped route is uncertain even if the rest of the scene is well lit', () => {
  const darkRoute = rect(frame(), 48, 18, 64, 68, [12, 12, 12]);
  assert.equal(analyzeFrame(darkRoute, copy(darkRoute), route).reason, 'low_light');
  const brightRoute = rect(frame(), 48, 18, 64, 68, [255, 255, 255]);
  assert.equal(analyzeFrame(brightRoute, copy(brightRoute), route).reason, 'overexposed');
});

test('invalid reference shape and mismatched frame dimensions are uncertain', () => {
  assert.equal(analyzeFrame({ width, height, data: new Uint8ClampedArray(3) }, frame(), route).reason, 'invalid_reference');
  assert.equal(analyzeFrame(frame(), { ...frame(), width: 161 }, route).reason, 'invalid_frame');
  assert.equal(analyzeFrame(null, frame(), route).status, 'uncertain');
});

test('self-intersecting, non-finite and degenerate polygons are rejected', () => {
  const a = frame();
  const invalid = [[], [{ x: 0.3, y: 0.3 }, { x: 0.7, y: 0.7 }, { x: 0.7, y: 0.3 }, { x: 0.3, y: 0.7 }],
    [{ x: NaN, y: 0 }, { x: 1, y: 0 }, { x: 0, y: 1 }],
    [{ x: 0, y: 0 }, { x: 0.5, y: 0.5 }, { x: 1, y: 1 }]];
  for (const polygon of invalid) assert.equal(analyzeFrame(a, a, polygon).reason, 'invalid_polygon');
});

test('too small route is uncertain instead of visually clear', () => {
  const a = frame();
  const small = [{ x: 0.4, y: 0.4 }, { x: 0.42, y: 0.4 }, { x: 0.42, y: 0.42 }, { x: 0.4, y: 0.42 }];
  assert.equal(analyzeFrame(a, a, small).reason, 'region_too_small');
});

test('translated textured camera image is uncertain', () => {
  const a = frame([150, 150, 150], true), b = copy(a);
  for (let y = 0; y < height; y++) for (let x = 2; x < width; x++) {
    const from = (y * width + x - 2) * 4;
    b.data.set(a.data.subarray(from, from + 4), (y * width + x) * 4);
  }
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'camera_moved');
});

test('camera translation beyond the old three-pixel search remains uncertain', () => {
  const a = frame([150, 150, 150], true), b = copy(a);
  for (let y = 0; y < height; y++) for (let x = 5; x < width; x++) {
    const from = (y * width + x - 5) * 4;
    b.data.set(a.data.subarray(from, from + 4), (y * width + x) * 4);
  }
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'camera_moved');
});

test('rotating a textured fixed-camera scene cannot produce visually clear', () => {
  const a = frame([150, 150, 150], true), b = copy(a);
  const angle = -2 * Math.PI / 180, cosine = Math.cos(angle), sine = Math.sin(angle);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    const px = x - width / 2, py = y - height / 2;
    const rx = Math.round(cosine * px - sine * py + width / 2);
    const ry = Math.round(sine * px + cosine * py + height / 2);
    if (rx >= 0 && ry >= 0 && rx < width && ry < height) {
      const from = (ry * width + rx) * 4;
      b.data.set(a.data.subarray(from, from + 4), (y * width + x) * 4);
    }
  }
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'camera_moved');
});

test('large global color change is uncertain', () => {
  const result = analyzeFrame(frame(), frame([230, 125, 140]), route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'global_scene_change');
});

test('shadow-like darkening is explicitly ambiguous with a dark object', () => {
  const a = frame(), b = rect(copy(a), 60, 40, 30, 25, [85, 85, 85]);
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'shadow_or_dark_object');
  assert.ok(result.boxes.length > 0);
});

test('removing a known new change returns to the fixed empty reference', () => {
  const a = frame(), occupied = rect(copy(a), 65, 40, 30, 30);
  assert.equal(analyzeFrame(a, occupied, route).status, 'obstructed');
  assert.equal(analyzeFrame(a, copy(a), route).status, 'clear');
});

test('concave polygon respects its excluded notch and boundary', () => {
  const concave = [{ x: 0.2, y: 0.2 }, { x: 0.8, y: 0.2 }, { x: 0.8, y: 0.8 },
    { x: 0.6, y: 0.8 }, { x: 0.6, y: 0.4 }, { x: 0.4, y: 0.4 }, { x: 0.4, y: 0.8 }, { x: 0.2, y: 0.8 }];
  assert.equal(pointInPolygon({ x: 0.5, y: 0.6 }, concave), false);
  assert.equal(pointInPolygon({ x: 0.2, y: 0.3 }, concave), true);
  const a = frame(), b = rect(copy(a), 70, 45, 18, 20);
  assert.equal(analyzeFrame(a, b, concave).status, 'clear');
});

test('non-object options and malformed numeric settings use bounded defaults', () => {
  const a = frame(), b = rect(copy(a), 60, 40, 30, 25);
  assert.equal(analyzeFrame(a, b, route, null).status, 'obstructed');
  assert.equal(analyzeFrame(a, b, route, { minOverlapRatio: NaN, differenceThreshold: Infinity }).status, 'obstructed');
});

test('broad connected background changes are uncertain, not localized obstacle evidence', () => {
  const a = frame(), b = copy(a);
  for (let y = 0; y < height; y++) for (let x = 0; x < width; x++) {
    if (x % 24 < 3 || y % 24 < 3) b.data.set([170, 60, 35, 255], (y * width + x) * 4);
  }
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.reason, 'global_scene_change');
  assert.equal(result.diagnostics.qualityGuard, 'broad_background_change');
  assert.ok(result.diagnostics.largestComponent.areaRatio > 0.2);
  assert.ok(result.diagnostics.outsideChangedRatio > 0.15);
  assert.equal(result.boxes[0].width, 1);
  assert.equal(result.boxes[0].height, 1);
  assert.ok(result.overlapRatio > 0, 'Keep measurements for diagnosis, not a localization success claim.');
});

test('a compact in-route change keeps its localized evidence after the quality guard', () => {
  const a = frame(), b = rect(copy(a), 60, 42, 24, 18);
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'obstructed');
  assert.equal(result.diagnostics.broadBackgroundChange, false);
  assert.equal(result.boxes.length, 1);
  assert.ok(result.boxes[0].width < 0.3 && result.boxes[0].height < 0.3);
});

test('a wide but shallow potential barrier is not rejected just for its width', () => {
  const a = frame(), b = rect(copy(a), 8, 36, 144, 36);
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'obstructed');
  assert.ok(result.diagnostics.largestComponent.areaRatio > 0.2);
  assert.ok(result.diagnostics.outsideChangedRatio > 0.15);
  assert.ok(result.boxes[0].width >= 0.8 && result.boxes[0].height < 0.8);
  assert.equal(result.diagnostics.broadBackgroundChange, false);
});

test('multiple localized outside-route changes remain clear despite outside activity', () => {
  const a = frame(), b = rect(rect(copy(a), 8, 28, 22, 45), 130, 28, 22, 45);
  const result = analyzeFrame(a, b, route);
  assert.equal(result.status, 'clear');
  assert.ok(result.diagnostics.outsideChangedRatio > 0.15);
  assert.equal(result.diagnostics.broadBackgroundChange, false);
  assert.equal(result.overlapRatio, 0);
  assert.deepEqual(result.boxes, []);
});

// Independent physical transformations, not matches injected into the model.
const regWidth = 160, regHeight = 120;
const regRoute = [{ x: .3, y: .25 }, { x: .7, y: .25 }, { x: .75, y: .85 }, { x: .25, y: .85 }];
function registrationScene(cell = 12) {
  const cols = Math.ceil(regWidth / cell), rows = Math.ceil(regHeight / cell);
  let seed = 31;
  const colors = Array.from({ length: cols * rows }, () => Array.from({ length: 3 }, () => {
    seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
    return 45 + seed % 165;
  }));
  const data = new Uint8ClampedArray(regWidth * regHeight * 4);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth; x++)
    data.set([...colors[Math.floor(y / cell) * cols + Math.floor(x / cell)], 255], (y * regWidth + x) * 4);
  return { data, width: regWidth, height: regHeight };
}
function regRect(target, x, y, w, h) {
  for (let cy = y; cy < y + h; cy++) for (let cx = x; cx < x + w; cx++)
    target.data.set([205, 50, 25, 255], (cy * target.width + cx) * 4);
  return target;
}
function transformed(source, matrix) {
  const { width: w, height: h } = source, data = new Uint8ClampedArray(source.data.length);
  const det = matrix[0] * matrix[4] - matrix[1] * matrix[3];
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) {
    const tx = x - matrix[2], ty = y - matrix[5];
    const sx = (matrix[4] * tx - matrix[1] * ty) / det, sy = (-matrix[3] * tx + matrix[0] * ty) / det;
    const ix = Math.floor(sx), iy = Math.floor(sy), fx = sx - ix, fy = sy - iy;
    for (let c = 0; c < 3; c++) {
      let value = 150;
      if (ix >= 0 && iy >= 0 && ix < w - 1 && iy < h - 1)
        value = (source.data[(iy * w + ix) * 4 + c] * (1 - fx)
          + source.data[(iy * w + ix + 1) * 4 + c] * fx) * (1 - fy)
          + (source.data[((iy + 1) * w + ix) * 4 + c] * (1 - fx)
          + source.data[((iy + 1) * w + ix + 1) * 4 + c] * fx) * fy;
      data[(y * w + x) * 4 + c] = value;
    }
    data[(y * w + x) * 4 + 3] = 255;
  }
  return { data, width: w, height: h };
}
const regAngle = .6 * Math.PI / 180;
const smallAffine = [Math.cos(regAngle), -Math.sin(regAngle), 2, Math.sin(regAngle), Math.cos(regAngle), -1];

test('independently supported slight affine drift of an empty scene remains comparable', () => {
  const reference = registrationScene(), current = transformed(reference, smallAffine);
  const polygonBefore = structuredClone(regRoute);
  const result = analyzeFrame(reference, current, regRoute);
  assert.equal(result.status, 'clear');
  assert.equal(result.alignment.applied, true);
  assert.equal(result.alignment.prefilter, 'binomial_3x3_both_frames');
  assert.equal(result.coordinateSpace, 'current_frame');
  assert.ok(result.alignment.outsideValidationAccepted >= 8);
  assert.ok(result.alignment.validationRatio >= .6);
  assert.deepEqual(regRoute, polygonBefore, 'Keep the saved reference polygon unchanged.');
  assert.notDeepEqual(result.displayPolygon, regRoute);
  assert.deepEqual(result.boxes, []);
});

test('slight affine drift does not erase a new object and evidence uses current coordinates', () => {
  const reference = registrationScene(), occupied = regRect(copy(reference), 65, 55, 20, 25);
  const result = analyzeFrame(reference, transformed(occupied, smallAffine), regRoute);
  assert.equal(result.status, 'obstructed');
  assert.equal(result.alignment.applied, true);
  assert.equal(result.boxes.length, 1);
  const box = result.boxes[0], centerX = (box.x + box.width / 2) * regWidth;
  const centerY = (box.y + box.height / 2) * regHeight;
  const expectedX = smallAffine[0] * 75 + smallAffine[1] * 67.5 + smallAffine[2];
  const expectedY = smallAffine[3] * 75 + smallAffine[4] * 67.5 + smallAffine[5];
  assert.ok(Math.abs(centerX - expectedX) < 3 && Math.abs(centerY - expectedY) < 3);
  assert.ok(box.width < .2 && box.height < .3);
  assert.equal(box.corners.length, 4);
});

test('dense validation prevents the two-pixel sampling-phase alias', () => {
  const reference = registrationScene(2);
  const result = analyzeFrame(reference, transformed(reference, [1, 0, 2, 0, 1, 1]), regRoute);
  assert.equal(result.status, 'clear');
  assert.equal(result.alignment.applied, true);
  assert.ok(Math.abs(result.alignment.matrix[2] - 2) < .05);
  assert.ok(Math.abs(result.alignment.matrix[5] - 1) < .05);
});

test('periodic ROI texture cannot falsely validate a conflicting background plane', () => {
  const reference = registrationScene(2);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth; x++) {
    if (!pointInPolygon({ x: (x + .5) / regWidth, y: (y + .5) / regHeight }, regRoute)) continue;
    const v = (Math.floor(x / 2) + Math.floor(y / 2)) % 2 ? 205 : 65;
    reference.data.set([v, v, v, 255], (y * regWidth + x) * 4);
  }
  const current = transformed(reference, [1, 0, 2, 0, 1, 0]);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth - 2; x++) {
    if (!pointInPolygon({ x: (x + .5) / regWidth, y: (y + .5) / regHeight }, regRoute)) continue;
    const from = (y * regWidth + x + 2) * 4;
    current.data.set(reference.data.subarray(from, from + 4), (y * regWidth + x) * 4);
  }
  const result = analyzeFrame(reference, current, regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
  assert.ok(result.alignment.validationAmbiguous > 0);
});

test('independent ROI motion plus a new object is rejected despite good exterior matches', () => {
  const reference = registrationScene(2), current = transformed(reference, [1, 0, 2, 0, 1, 0]);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth - 2; x++) {
    if (!pointInPolygon({ x: (x + .5) / regWidth, y: (y + .5) / regHeight }, regRoute)) continue;
    const from = (y * regWidth + x + 2) * 4;
    current.data.set(reference.data.subarray(from, from + 4), (y * regWidth + x) * 4);
  }
  regRect(current, 65, 55, 20, 20);
  const result = analyzeFrame(reference, current, regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
});

test('a partially invisible ROI cannot be cropped away to produce a clear result', () => {
  const reference = registrationScene(2);
  const edgeRoute = [{ x: .55, y: .2 }, { x: 1, y: .2 }, { x: 1, y: .8 }, { x: .55, y: .8 }];
  const result = analyzeFrame(reference, transformed(reference, [1, 0, 2, 0, 1, 0]), edgeRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
  assert.equal(result.alignment.reason, 'roi_out_of_bounds');
  assert.ok(result.alignment.invalidRoiRatio > 0);
  assert.equal(result.alignment.prefilter, null);
});

test('low-texture scene changes cannot receive an invented alignment', () => {
  const result = analyzeFrame(frame(), frame([230, 125, 140]), route);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
  assert.equal(result.alignment.reason, 'insufficient_texture');
});

test('blurred fine texture is refused instead of being aligned to a clear claim', () => {
  const reference = registrationScene(2), current = copy(reference);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth; x++) {
    for (let c = 0; c < 3; c++) {
      let sum = 0;
      for (let dy = -3; dy <= 3; dy++) for (let dx = -3; dx <= 3; dx++) {
        const sx = Math.max(0, Math.min(regWidth - 1, x + dx));
        const sy = Math.max(0, Math.min(regHeight - 1, y + dy));
        sum += reference.data[(sy * regWidth + sx) * 4 + c];
      }
      current.data[(y * regWidth + x) * 4 + c] = sum / 49;
    }
  }
  const result = analyzeFrame(reference, current, regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
});

test('outside-route activity does not dominate an otherwise supported camera alignment', () => {
  const reference = registrationScene(), occupied = regRect(copy(reference), 112, 7, 15, 15);
  const result = analyzeFrame(reference, transformed(occupied, smallAffine), regRoute);
  assert.equal(result.status, 'clear');
  assert.equal(result.alignment.applied, true);
  assert.equal(result.overlapRatio, 0);
});

test('a texture-copied large object cannot move the background model to erase itself', () => {
  const reference = registrationScene(2), current = copy(reference);
  const largeRoute = [{ x: .05, y: .05 }, { x: .95, y: .05 }, { x: .95, y: .95 }, { x: .05, y: .95 }];
  for (let y = 6; y < regHeight - 6; y++) for (let x = 8; x < regWidth - 8; x++) {
    const from = (y * regWidth + x - 3) * 4;
    current.data.set(reference.data.subarray(from, from + 4), (y * regWidth + x) * 4);
  }
  const result = analyzeFrame(reference, current, largeRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
});

test('motion beyond the bounded compensation region is still uncertain', () => {
  const reference = registrationScene(2);
  const result = analyzeFrame(reference, transformed(reference, [1, 0, 14, 0, 1, 0]), regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
});

test('an identity match cannot authorize filtering away large color-only changes', () => {
  const reference = registrationScene(2), current = copy(reference);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth; x++) {
    const index = (y * regWidth + x) * 4;
    // Random gray texture with ample luma support; the added pattern has
    // nearly zero luma and opposite phase in neighboring pixels.
    const v = 90 + reference.data[index] % 60;
    const sign = (x + y) % 2 ? 1 : -1;
    reference.data.set([v, v, v, 255], index);
    current.data.set([v + sign * 40, v - sign * 20, v + sign * 81, 255], index);
  }
  const result = analyzeFrame(reference, current, regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
  assert.equal(result.alignment.prefilter, null);
  assert.equal(result.alignment.reason, 'no_material_motion');
});

test('real motion cannot authorize erasing widespread new color-only texture', () => {
  const reference = registrationScene(2), colored = copy(reference);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth; x++) {
    const index = (y * regWidth + x) * 4, v = 90 + reference.data[index] % 60;
    const sign = (x + y) % 2 ? 1 : -1;
    reference.data.set([v, v, v, 255], index);
    colored.data.set([v + sign * 40, v - sign * 20, v + sign * 81, 255], index);
  }
  const result = analyzeFrame(reference, transformed(colored, [1, 0, 2, 0, 1, 1]), regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
  assert.equal(result.alignment.reason, 'unfiltered_chromatic_change');
  assert.equal(result.alignment.prefilter, null);
  assert.ok(result.alignment.unfilteredChromaticChange.routeRatio >= .15);
});

test('a localized color-textured object cannot disappear after accepted geometry and filtering', () => {
  const reference = registrationScene(2), colored = copy(reference);
  for (let y = 0; y < regHeight; y++) for (let x = 0; x < regWidth; x++) {
    const index = (y * regWidth + x) * 4, v = 90 + reference.data[index] % 60;
    reference.data.set([v, v, v, 255], index);
    colored.data.set([v, v, v, 255], index);
    if (x >= 70 && x < 90 && y >= 65 && y < 83) {
      const sign = (x + y) % 2 ? 1 : -1;
      colored.data.set([v + sign * 40, v - sign * 20, v + sign * 81, 255], index);
    }
  }
  const result = analyzeFrame(reference, transformed(colored, [1, 0, 2, 0, 1, 1]), regRoute);
  assert.equal(result.status, 'uncertain');
  assert.equal(result.alignment.applied, false);
  assert.equal(result.alignment.reason, 'filtered_chromatic_evidence_lost');
  assert.ok(result.alignment.unfilteredChromaticChange.unsupportedRouteRatio >= .025);
});
