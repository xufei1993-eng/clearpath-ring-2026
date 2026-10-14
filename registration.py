"""Optional, local-only SIFT registration for a verified planar route ROI.

No network, file paths, model downloads, or dependency installation are used.
The caller still decides visual change using the returned lossless PNG pair;
an accepted transform is neither an obstacle result nor a safety assessment.
"""
from __future__ import annotations

import base64
import binascii
import hashlib
import importlib
import json
import math
from pathlib import Path
import struct


PROTOCOL = {
    "id": "clearpath-local-sift-roi-v3",
    "max_width": 640, "max_height": 1280, "max_pixels": 819200,
    "max_image_bytes": 1048576, "min_dimension": 64,
    "features": 5000, "grayscale": "Rec709_8bit",
    "bidirectional_ratio": 0.75, "unique_radius_at_640": 4.0,
    "descriptor_keepout_size_multiplier": 6.0,
    "grid": 4, "heldout_cells": [[0, 0], [1, 2], [2, 1], [3, 3]],
    "min_unique_matches": 64, "min_train_inliers": 40,
    "min_heldout_matches": 16,
    "reference_match_fraction": "diagnostic_only_occlusion_sensitive",
    "ransac_tolerance_at_640": 2.5, "ransac_confidence": 0.999,
    "ransac_max_iters": 10000, "ransac_seed": 1729,
    "min_train_inlier_fraction": 0.85, "min_heldout_good_fraction": 0.90,
    "max_heldout_median_at_640": 1.0,
    "min_train_hull_ratio": 0.55, "min_heldout_hull_ratio": 0.35,
    "min_train_cells": 7, "min_heldout_cells": 3,
    "max_axis_motion_fraction": 0.18, "max_rotation_degrees": 8.0,
    "min_local_scale": 0.80, "max_local_scale": 1.25,
    "max_local_anisotropy": 1.25,
    "identity_motion_at_640": 0.25,
    "analysis_width": 240, "analysis_height": "ceil(input_height*240/input_width)",
    "analysis_resize": "opencv_INTER_AREA",
    "analysis_neighborhood_radius_px": 1,
    "roi_support_halo_reference_px": "ceil(2*input_width/240)+2",
    "chroma_difference_threshold": 24.0,
    "min_chromatic_change_ratio": 0.025,
    "max_raw_roi_change_ratio": 0.45,
    "raw_rgb_difference_threshold": 35.0,
    "output": "lossless_png", "filter": "3x3_binomial_after_warp_both_frames",
    "scope": "validated_planar_roi_only",
}
PROTOCOL_SHA256 = hashlib.sha256(json.dumps(
    PROTOCOL, sort_keys=True, separators=(",", ":")).encode()).hexdigest()
SOURCE_SHA256 = hashlib.sha256(Path(__file__).read_bytes()).hexdigest()


def _source_sha256():
    # Match the code loaded in this process. An edited source requires restart.
    return SOURCE_SHA256


def _dependencies():
    try:
        cv = importlib.import_module("cv2")
        np = importlib.import_module("numpy")
        if not hasattr(cv, "SIFT_create"):
            return None, None
        return cv, np
    except (ImportError, OSError, AttributeError):
        return None, None


def registration_status():
    """Safe availability metadata, including hashes when OpenCV is absent."""
    cv, _ = _dependencies()
    return {"available": cv is not None,
            "version": str(cv.__version__) if cv is not None else None,
            "sourceSha256": _source_sha256(),
            "protocolSha256": PROTOCOL_SHA256}


class _InvalidInput(ValueError):
    pass


def _image_bytes(value):
    if not isinstance(value, str):
        raise _InvalidInput("invalid_image_data_uri")
    max_encoded = (PROTOCOL["max_image_bytes"] * 4 + 2) // 3 + 64
    if len(value) > max_encoded:
        raise _InvalidInput("image_too_large")
    prefixes = {"data:image/jpeg;base64,": "jpeg", "data:image/png;base64,": "png"}
    prefix = next((p for p in prefixes if value.startswith(p)), None)
    if prefix is None:
        raise _InvalidInput("invalid_image_data_uri")
    try:
        raw = base64.b64decode(value[len(prefix):], validate=True)
    except (binascii.Error, ValueError):
        raise _InvalidInput("invalid_image_data_uri") from None
    if not raw or len(raw) > PROTOCOL["max_image_bytes"]:
        raise _InvalidInput("image_too_large")
    kind = prefixes[prefix]
    # Inspect dimensions before the native decoder allocates an image.
    if kind == "png":
        if (len(raw) < 33 or raw[:8] != b"\x89PNG\r\n\x1a\n"
                or raw[8:16] != b"\0\0\0\rIHDR" or raw[24] != 8
                or raw[25] not in (0, 2)):
            raise _InvalidInput("invalid_image")
        width, height = struct.unpack(">II", raw[16:24])
    else:
        if raw[:2] != b"\xff\xd8" or not raw.endswith(b"\xff\xd9"):
            raise _InvalidInput("invalid_image")
        pos = 2
        width = height = None
        while pos < len(raw):
            if raw[pos] != 255:
                raise _InvalidInput("invalid_image")
            while pos < len(raw) and raw[pos] == 255:
                pos += 1
            if pos >= len(raw):
                break
            marker = raw[pos]
            pos += 1
            if marker in (0xD9, 0xDA):
                break
            if marker in (0xD8, 0x01) or 0xD0 <= marker <= 0xD7:
                continue
            if pos + 2 > len(raw):
                raise _InvalidInput("invalid_image")
            length = int.from_bytes(raw[pos:pos + 2], "big")
            if length < 2 or pos + length > len(raw):
                raise _InvalidInput("invalid_image")
            if marker in (0xC0, 0xC2):
                if length < 8 or raw[pos + 2] != 8 or raw[pos + 7] not in (1, 3):
                    raise _InvalidInput("invalid_image")
                height, width = struct.unpack(">HH", raw[pos + 3:pos + 7])
                break
            pos += length
        if width is None:
            raise _InvalidInput("invalid_image")
    if (width < PROTOCOL["min_dimension"] or height < PROTOCOL["min_dimension"]
            or width > PROTOCOL["max_width"] or height > PROTOCOL["max_height"]
            or width * height > PROTOCOL["max_pixels"]):
        raise _InvalidInput("invalid_image_dimensions")
    return raw, (width, height)


def _polygon(value):
    if not isinstance(value, (list, tuple)) or not 3 <= len(value) <= 8:
        raise _InvalidInput("invalid_polygon")
    points = []
    for p in value:
        if isinstance(p, dict) and set(p) == {"x", "y"}:
            x, y = p["x"], p["y"]
        elif isinstance(p, (list, tuple)) and len(p) == 2:
            x, y = p
        else:
            raise _InvalidInput("invalid_polygon")
        if any(isinstance(v, bool) or not isinstance(v, (int, float))
               or not math.isfinite(v) or not 0 <= v <= 1 for v in (x, y)):
            raise _InvalidInput("invalid_polygon")
        points.append((float(x), float(y)))
    # The UI marks a convex floor quadrilateral. Reject concave and crossed ROIs.
    cross = []
    for i, a in enumerate(points):
        b, c = points[(i + 1) % len(points)], points[(i + 2) % len(points)]
        cross.append((b[0] - a[0]) * (c[1] - b[1]) - (b[1] - a[1]) * (c[0] - b[0]))
    area = abs(sum(a[0] * points[(i + 1) % len(points)][1]
                   - a[1] * points[(i + 1) % len(points)][0]
                   for i, a in enumerate(points))) / 2
    if (area < 0.05 or not (all(c > 1e-6 for c in cross) or all(c < -1e-6 for c in cross))):
        raise _InvalidInput("invalid_polygon")
    sign = 1 if cross[0] > 0 else -1
    for i, a in enumerate(points):
        b = points[(i + 1) % len(points)]
        for j, p in enumerate(points):
            if j in (i, (i + 1) % len(points)):
                continue
            if sign * ((b[0] - a[0]) * (p[1] - a[1]) - (b[1] - a[1]) * (p[0] - a[0])) <= 1e-6:
                raise _InvalidInput("invalid_polygon")
    return points


def _error_stats(np, errors, tolerance):
    if len(errors) == 0:
        return {"count": 0}
    return {"count": int(len(errors)), "medianPx": float(np.median(errors)),
            "p90Px": float(np.percentile(errors, 90)), "maxPx": float(errors.max()),
            "goodFraction": float((errors <= tolerance).mean())}


def _hull_ratio(cv, points, area):
    return float(cv.contourArea(cv.convexHull(points)) / area) if len(points) >= 3 else 0.0


def _register(cv, np, reference_raw, current_raw, shape, points, diagnostics):
    width, height = shape
    reference = cv.imdecode(np.frombuffer(reference_raw, np.uint8), cv.IMREAD_COLOR | cv.IMREAD_IGNORE_ORIENTATION)
    current = cv.imdecode(np.frombuffer(current_raw, np.uint8), cv.IMREAD_COLOR | cv.IMREAD_IGNORE_ORIENTATION)
    if (reference is None or current is None or reference.shape != (height, width, 3)
            or current.shape != reference.shape):
        return "invalid_image", None
    polygon = np.float32(points) * [width, height]
    mask = np.zeros((height, width), np.uint8)
    cv.fillPoly(mask, [np.int32(np.round(polygon))], 255)
    roi_area = cv.countNonZero(mask)
    analysis_width = PROTOCOL["analysis_width"]
    analysis_height = math.ceil(height * analysis_width / width)
    if analysis_width * analysis_height > 1048576:
        return "analysis_dimensions_exceed_contract", None
    # An output ROI raster can extend half an analysis pixel beyond the
    # continuous polygon, its downstream 3x3 reads one more pixel, and an AREA
    # sample extends another half pixel: <= 2 * input_width/240. Add one native
    # pixel for the common 3x3 prefilter and one for native ROI raster rounding.
    # Ceil output height ensures the vertical source scale is no larger.
    halo = math.ceil(2 * width / analysis_width) + 2
    if (mask[:halo].any() or mask[-halo:].any() or mask[:, :halo].any() or mask[:, -halo:].any()):
        diagnostics["visibility"] = {"roiVisibleFraction": None, "supportVisibleFraction": 0.0,
                                     "supportHaloReferencePx": halo}
        return "roi_support_clipped", None

    # Match unfiltered data. Matching is independent of the eventual difference image.
    gray = lambda image: np.round(np.dot(image.astype(np.float32), [0.0722, 0.7152, 0.2126])).astype(np.uint8)
    detector = cv.SIFT_create(nfeatures=PROTOCOL["features"])
    k1, d1 = detector.detectAndCompute(gray(reference), None)
    k2, d2 = detector.detectAndCompute(gray(current), None)
    diagnostics["keypoints"] = {"reference": len(k1), "current": len(k2)}
    if d1 is None or d2 is None or len(k1) < 64 or len(k2) < 64:
        return "insufficient_unique_texture", None
    bf = cv.BFMatcher(cv.NORM_L2)
    ratio = PROTOCOL["bidirectional_ratio"]
    forward, backward = bf.knnMatch(d1, d2, k=2), bf.knnMatch(d2, d1, k=2)
    f = {a.queryIdx: (a, a.distance / max(float(b.distance), 1e-9))
         for pair in forward if len(pair) == 2 for a, b in [pair] if a.distance < ratio * b.distance}
    b = {a.queryIdx: a.trainIdx for pair in backward if len(pair) == 2
         for a, z in [pair] if a.distance < ratio * z.distance}
    mutual = [(m, r) for m, r in f.values() if b.get(m.trainIdx) == m.queryIdx]
    diagnostics["matching"] = {"forwardRatio": len(f), "backwardRatio": len(b),
                                "mutualRatio": len(mutual)}
    ys, xs = np.nonzero(mask)
    x0, x1, y0, y1 = xs.min(), xs.max() + 1, ys.min(), ys.max() + 1
    cell_width, cell_height = (x1 - x0) / 4, (y1 - y0) / 4
    distance = cv.distanceTransform(mask, cv.DIST_L2, cv.DIST_MASK_PRECISE)
    heldout_cells = {tuple(c) for c in PROTOCOL["heldout_cells"]}

    def candidate(keypoint):
        x, y = keypoint.pt
        if not (0 <= x < width and 0 <= y < height) or not mask[round(y), round(x)]:
            return None
        radius = PROTOCOL["descriptor_keepout_size_multiplier"] * keypoint.size
        cx, cy = min(3, int((x - x0) / cell_width)), min(3, int((y - y0) / cell_height))
        left, top = x0 + cx * cell_width, y0 + cy * cell_height
        # Entire reference descriptor keep-out stays inside the ROI and one
        # preassigned source cell. Training and heldout source pixels are disjoint.
        if (distance[round(y), round(x)] <= radius
                or min(x - left, left + cell_width - x, y - top, top + cell_height - y) <= radius):
            return None
        return (cx, cy), radius

    unique_radius = PROTOCOL["unique_radius_at_640"] * width / 640
    eligible = [k for k in k1 if candidate(k) is not None]
    # The denominator uses physical locations too, not SIFT's multiple
    # orientations at one location. Numerator and denominator share a unit.
    bins = {}
    eligible_count = 0
    for keypoint in sorted(eligible, key=lambda k: -k.response):
        x, y = keypoint.pt
        bx, by = int(x / unique_radius), int(y / unique_radius)
        neighbors = [p for ix in range(bx - 1, bx + 2) for iy in range(by - 1, by + 2)
                     for p in bins.get((ix, iy), ())]
        if any((x - a)**2 + (y - b)**2 < unique_radius**2 for a, b in neighbors):
            continue
        bins.setdefault((bx, by), []).append((x, y))
        eligible_count += 1
    matches = []
    for m, r in sorted(mutual, key=lambda v: v[1]):
        info = candidate(k1[m.queryIdx])
        if info is None:
            continue
        cell, radius = info
        p, q = np.array(k1[m.queryIdx].pt), np.array(k2[m.trainIdx].pt)
        if any(np.linalg.norm(p - v[0]) < unique_radius or np.linalg.norm(q - v[1]) < unique_radius for v in matches):
            continue
        matches.append((p, q, cell, radius, PROTOCOL["descriptor_keepout_size_multiplier"] * k2[m.trainIdx].size))
    train = [v for v in matches if v[2] not in heldout_cells]
    heldout0 = [v for v in matches if v[2] in heldout_cells]
    # Also exclude heldout current footprints overlapping any training footprint.
    heldout = [v for v in heldout0 if all(np.linalg.norm(v[1] - t[1]) > v[4] + t[4] for t in train)]
    diagnostics["matching"].update({"eligibleReferenceDescriptors": len(eligible),
        "eligibleUniqueReferenceLocations": eligible_count,
        "uniqueRoiMatches": len(matches), "referenceMatchFraction": len(matches) / max(1, eligible_count),
        "referenceMatchFractionRole": "diagnostic_only_occlusion_sensitive",
        "train": len(train), "heldoutBeforeCurrentFootprintExclusion": len(heldout0),
        "heldout": len(heldout), "sourceSplit": "disjoint_4x4_cells_and_descriptor_keepout"})
    if (len(matches) < PROTOCOL["min_unique_matches"] or len(train) < PROTOCOL["min_train_inliers"]
            or len(heldout) < PROTOCOL["min_heldout_matches"]):
        return "insufficient_independent_matches", None

    p = np.float32([v[0] for v in train]); q = np.float32([v[1] for v in train])
    hp = np.float32([v[0] for v in heldout]); hq = np.float32([v[1] for v in heldout])
    tolerance = PROTOCOL["ransac_tolerance_at_640"] * width / 640
    cv.setRNGSeed(PROTOCOL["ransac_seed"])
    H, inlier_mask = cv.findHomography(p, q, cv.RANSAC, tolerance,
        maxIters=PROTOCOL["ransac_max_iters"], confidence=PROTOCOL["ransac_confidence"])
    if H is None or inlier_mask is None or not np.isfinite(H).all() or abs(H[2, 2]) < 1e-12:
        return "unstable_transform", None
    H = H / H[2, 2]
    im = inlier_mask.ravel().astype(bool)
    training_errors = np.linalg.norm(cv.perspectiveTransform(p.reshape(-1, 1, 2), H).reshape(-1, 2) - q, axis=1)
    heldout_errors = np.linalg.norm(cv.perspectiveTransform(hp.reshape(-1, 1, 2), H).reshape(-1, 2) - hq, axis=1)
    good = heldout_errors <= tolerance
    train_cells = {train[i][2] for i in np.flatnonzero(im)}
    held_cells = {heldout[i][2] for i in np.flatnonzero(good)}
    diagnostics["geometry"] = {"matrixReferenceToCurrent": H.tolist(),
        "trainInliers": int(im.sum()), "trainInlierFraction": float(im.mean()),
        "trainErrors": _error_stats(np, training_errors[im], tolerance),
        "heldoutErrors": _error_stats(np, heldout_errors, tolerance),
        "trainHullRatio": _hull_ratio(cv, p[im], roi_area),
        "heldoutHullRatio": _hull_ratio(cv, hp[good], roi_area),
        "trainCells": [list(c) for c in sorted(train_cells)],
        "heldoutCells": [list(c) for c in sorted(held_cells)],
        "heldoutReferencePoints": hp.tolist(), "heldoutCurrentPoints": hq.tolist()}
    if (int(im.sum()) < PROTOCOL["min_train_inliers"]
            or float(im.mean()) < PROTOCOL["min_train_inlier_fraction"]
            or float(good.mean()) < PROTOCOL["min_heldout_good_fraction"]
            or float(np.median(heldout_errors)) > PROTOCOL["max_heldout_median_at_640"] * width / 640
            or float(np.percentile(heldout_errors, 90)) > tolerance):
        return "inconsistent_plane_or_matches", None
    if (diagnostics["geometry"]["trainHullRatio"] < PROTOCOL["min_train_hull_ratio"]
            or diagnostics["geometry"]["heldoutHullRatio"] < PROTOCOL["min_heldout_hull_ratio"]
            or len(train_cells) < PROTOCOL["min_train_cells"]
            or len(held_cells) < PROTOCOL["min_heldout_cells"]):
        return "insufficient_spatial_support", None

    probe = np.float32([[x0 + (x1 - x0) * x, y0 + (y1 - y0) * y]
                         for y in (0, .25, .5, .75, 1) for x in (0, .25, .5, .75, 1)])
    denominators = probe @ H[2, :2] + H[2, 2]
    if np.any(denominators <= 0):
        return "excessive_transform", None
    mapped = cv.perspectiveTransform(probe.reshape(-1, 1, 2), H).reshape(-1, 2)
    displacement = mapped - probe
    maximum_motion = float(np.linalg.norm(displacement, axis=1).max())
    diagnostics["geometry"]["maxProbeMotionPx"] = maximum_motion
    if maximum_motion < PROTOCOL["identity_motion_at_640"] * width / 640:
        return "identity_no_compensation", None
    if (np.abs(displacement[:, 0]).max() > PROTOCOL["max_axis_motion_fraction"] * width
            or np.abs(displacement[:, 1]).max() > PROTOCOL["max_axis_motion_fraction"] * height):
        return "excessive_transform", None
    scales = []; rotations = []
    for (x, y), den in zip(probe, denominators):
        nx, ny = H[0] @ [x, y, 1], H[1] @ [x, y, 1]
        J = np.array([[(H[0, 0] * den - nx * H[2, 0]) / den**2,
                       (H[0, 1] * den - nx * H[2, 1]) / den**2],
                      [(H[1, 0] * den - ny * H[2, 0]) / den**2,
                       (H[1, 1] * den - ny * H[2, 1]) / den**2]])
        singular = np.linalg.svd(J, compute_uv=False)
        rotation = abs(math.degrees(math.atan2(J[1, 0], J[0, 0])))
        scales.append(singular.tolist()); rotations.append(rotation)
        if (np.linalg.det(J) <= 0 or singular.min() < PROTOCOL["min_local_scale"]
                or singular.max() > PROTOCOL["max_local_scale"]
                or singular.max() / singular.min() > PROTOCOL["max_local_anisotropy"]
                or rotation > PROTOCOL["max_rotation_degrees"]):
            return "excessive_transform", None
    diagnostics["geometry"].update({"localScales": scales, "maxLocalRotationDegrees": max(rotations)})

    support = cv.dilate(mask, np.ones((halo * 2 + 1, halo * 2 + 1), np.uint8))
    sy, sx = np.nonzero(support)
    sp = np.float32(np.column_stack([sx, sy]))
    mapped_support = cv.perspectiveTransform(sp.reshape(-1, 1, 2), H).reshape(-1, 2)
    # Every original current pixel used by bilinear warp + common 3x3 filter
    # + fixed AREA resize + analysis 3x3 must exist. No percent waiver.
    valid = ((np.floor(mapped_support[:, 0]) >= 0) & (np.ceil(mapped_support[:, 0]) < width)
             & (np.floor(mapped_support[:, 1]) >= 0) & (np.ceil(mapped_support[:, 1]) < height))
    roi_at_support = mask[sy, sx] > 0
    roi_visible = float(valid[roi_at_support].mean())
    diagnostics["visibility"] = {"roiVisibleFraction": roi_visible,
        "supportVisibleFraction": float(valid.mean()), "supportHaloReferencePx": halo,
        "roiPixelCount": int(roi_area), "supportPixelCount": int(len(sp)),
        "mappedPolygon": cv.perspectiveTransform(np.float32(polygon).reshape(-1, 1, 2), H).reshape(-1, 2).tolist()}
    if not valid.all():
        return "roi_support_clipped", None

    warped = cv.warpPerspective(current, np.linalg.inv(H), (width, height), flags=cv.INTER_LINEAR)
    kernel = np.array([1, 2, 1], np.float32) / 4
    reference_processed = cv.sepFilter2D(reference, -1, kernel, kernel)
    current_processed = cv.sepFilter2D(warped, -1, kernel, kernel)
    inside = mask > 0
    analysis_mask = np.zeros((analysis_height, analysis_width), np.uint8)
    cv.fillPoly(analysis_mask, [np.int32(np.round(np.float32(points)
                                                * [analysis_width, analysis_height]))], 255)
    analysis_inside = analysis_mask > 0
    analysis_support = cv.dilate(analysis_mask, np.ones((3, 3), np.uint8)) > 0
    # Preserve actual current pixels through AREA sampling and the whole
    # downstream 3x3 support. Fill reference only beyond that validated halo.
    reference_analysis = cv.resize(reference_processed, (analysis_width, analysis_height), interpolation=cv.INTER_AREA)
    current_analysis = cv.resize(current_processed, (analysis_width, analysis_height), interpolation=cv.INTER_AREA)

    def chroma_change(a, b, selected):
        delta = a.astype(np.float32) - b.astype(np.float32)
        luminance = np.dot(delta, [0.0722, 0.7152, 0.2126])
        chroma = np.abs(delta - luminance[:, :, None]).mean(axis=2)[selected]
        return {"changedRatio": float((chroma > PROTOCOL["chroma_difference_threshold"]).mean()),
                "median": float(np.median(chroma)), "p90": float(np.percentile(chroma, 90))}

    raw_chroma = chroma_change(warped, reference, inside)
    filtered_chroma = chroma_change(current_analysis, reference_analysis, analysis_inside)
    diagnostics["appearance"] = {"unfilteredChroma": raw_chroma, "filteredChroma": filtered_chroma}
    gate = PROTOCOL["min_chromatic_change_ratio"]
    if raw_chroma["changedRatio"] >= gate and filtered_chroma["changedRatio"] < gate:
        return "suppressed_chromatic_change", None
    raw_change = np.abs(warped.astype(np.float32) - reference.astype(np.float32)).mean(axis=2)[inside]
    raw_change_ratio = float((raw_change > PROTOCOL["raw_rgb_difference_threshold"]).mean())
    diagnostics["appearance"]["unfilteredRgbChangedRatio"] = raw_change_ratio
    if raw_change_ratio > PROTOCOL["max_raw_roi_change_ratio"]:
        return "roi_change_dominates", None
    current_analysis[~analysis_support] = reference_analysis[~analysis_support]
    encoded = []
    for image in (reference_analysis, current_analysis):
        ok, data = cv.imencode(".png", image, [cv.IMWRITE_PNG_COMPRESSION, 3])
        if not ok:
            return "processing_failed", None
        encoded.append("data:image/png;base64," + base64.b64encode(data.tobytes()).decode("ascii"))
    diagnostics["processing"] = {"scope": PROTOCOL["scope"],
        "outsideRoi": "copied_processed_reference_beyond_analysis_support_halo",
        "filter": PROTOCOL["filter"], "output": "lossless_png",
        "analysisSize": {"width": analysis_width, "height": analysis_height},
        "analysisResize": PROTOCOL["analysis_resize"],
        "analysisSupportHaloPx": PROTOCOL["analysis_neighborhood_radius_px"],
        "matrixScope": "ROI plane only; no assertion about other scene planes",
        "supportContract": "fixed 240-wide backend AREA resize plus one analysis 3x3 neighborhood; client must consume lossless PNG pixels 1:1 without another resize"}
    return None, {"reference": encoded[0], "current": encoded[1], "matrix": H.tolist(),
                  "coordinateSize": {"width": width, "height": height}}


def register_frames(reference_b64, current_b64, polygon):
    """Register same-size <=640-wide image data URIs, with fail-closed diagnostics.

    Success: accepted, 240-wide reference/current PNG data URIs, matrix
    (reference to current in original coordinateSize), diagnostics,
    sourceSha256, protocolSha256. Rejections contain
    accepted=False, reason and diagnostics; no derived images are returned.
    Coordinates may be normalized [x,y] pairs or exact {x,y} objects.
    """
    result = {"accepted": False, "diagnostics": {"scope": PROTOCOL["scope"]},
              "sourceSha256": _source_sha256(), "protocolSha256": PROTOCOL_SHA256}
    try:
        reference_raw, shape = _image_bytes(reference_b64)
        current_raw, current_shape = _image_bytes(current_b64)
        points = _polygon(polygon)
        if shape != current_shape:
            raise _InvalidInput("image_dimensions_mismatch")
    except _InvalidInput as exc:
        result["reason"] = str(exc)
        return result
    diagnostics = result["diagnostics"]
    diagnostics.update({"width": shape[0], "height": shape[1],
        "inputSha256": {"reference": hashlib.sha256(reference_raw).hexdigest(),
                        "current": hashlib.sha256(current_raw).hexdigest()},
        "polygon": [{"x": x, "y": y} for x, y in points],
        "protocol": json.loads(json.dumps(PROTOCOL))})
    cv, np = _dependencies()
    if cv is None:
        result["reason"] = "registration_unavailable"
        diagnostics["dependency"] = "Install the optional local OpenCV/NumPy dependencies in the selected Python environment. No cloud fallback is used."
        diagnostics["opencvVersion"] = None
        return result
    diagnostics["opencvVersion"] = str(cv.__version__)
    try:
        reason, images = _register(cv, np, reference_raw, current_raw, shape, points, diagnostics)
    except (cv.error, ValueError, np.linalg.LinAlgError, OverflowError, IndexError):
        # Decoder and numerical errors must not expose file paths or native logs.
        result["reason"] = "registration_processing_failed"
        return result
    if reason:
        result["reason"] = reason
    else:
        result.update({"accepted": True, **images})
    return result
