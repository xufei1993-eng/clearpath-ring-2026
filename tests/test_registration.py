"""Independent synthetic controls for the optional local SIFT registration."""
import base64
import hashlib
import json
from pathlib import Path
import struct
import sys
import unittest
from unittest.mock import patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import registration

try:
    import cv2 as cv
    import numpy as np
    HAS_CV = hasattr(cv, "SIFT_create")
except ImportError:
    HAS_CV = False

ROI = [{"x": .10, "y": .10}, {"x": .90, "y": .10},
       {"x": .90, "y": .90}, {"x": .10, "y": .90}]


class InputSafetyTests(unittest.TestCase):
    def test_status_is_safe_and_hashed_even_without_optional_dependencies(self):
        with patch.object(registration, "_dependencies", return_value=(None, None)):
            result = registration.registration_status()
        self.assertEqual(result["available"], False)
        self.assertIsNone(result["version"])
        self.assertEqual(result["sourceSha256"], hashlib.sha256(Path(registration.__file__).read_bytes()).hexdigest())
        self.assertRegex(result["protocolSha256"], r"^[a-f0-9]{64}$")
        self.assertNotIn("/Users/", json.dumps(result))
        with patch.object(registration.Path, "read_bytes", side_effect=AssertionError("must use loaded code hash")):
            with patch.object(registration, "_dependencies", return_value=(None, None)):
                self.assertEqual(registration.registration_status()["sourceSha256"], result["sourceSha256"])

    def test_paths_urls_and_malformed_data_are_never_opened(self):
        for value in ("/private/tmp/a.jpg", "https://example.com/a.jpg", "file:///a.jpg",
                      "data:image/svg+xml;base64,AAAA", "data:image/png;base64,@@@@", None, 2):
            with self.subTest(value=value):
                result = registration.register_frames(value, value, ROI)
                self.assertFalse(result["accepted"])
                self.assertNotIn("current", result)
                json.dumps(result, allow_nan=False)

    def test_dimensions_are_bounded_before_native_decode(self):
        raw = b"\x89PNG\r\n\x1a\n\0\0\0\rIHDR" + struct.pack(">II", 100000, 100000) + b"\x08\x02\0\0\0" + b"\0" * 4
        value = "data:image/png;base64," + base64.b64encode(raw).decode()
        with patch.object(registration, "_dependencies", side_effect=AssertionError("decoder must not load")):
            result = registration.register_frames(value, value, ROI)
        self.assertEqual(result["reason"], "invalid_image_dimensions")


@unittest.skipUnless(HAS_CV, "Optional local OpenCV and NumPy are unavailable")
class RegistrationTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        cv.setNumThreads(1)
        rng = np.random.default_rng(130907)
        gray = rng.integers(70, 186, (384, 512), dtype=np.uint8)
        gray = cv.GaussianBlur(gray, (3, 3), .5)
        for _ in range(1100):
            x, y = int(rng.integers(4, 508)), int(rng.integers(4, 380))
            cv.circle(gray, (x, y), int(rng.integers(1, 4)), int(rng.integers(60, 196)), -1)
        cls.reference = cv.cvtColor(gray, cv.COLOR_GRAY2BGR)

    @staticmethod
    def uri(image, extension=".png"):
        ok, raw = cv.imencode(extension, image)
        assert ok
        mime = "jpeg" if extension == ".jpg" else "png"
        return "data:image/" + mime + ";base64," + base64.b64encode(raw.tobytes()).decode()

    @staticmethod
    def decode(value):
        return cv.imdecode(np.frombuffer(base64.b64decode(value.split(",", 1)[1]), np.uint8), cv.IMREAD_COLOR)

    def translated(self, dx=3, dy=2):
        H = np.float64([[1, 0, dx], [0, 1, dy], [0, 0, 1]])
        return cv.warpPerspective(self.reference, H, (512, 384)), H

    def run_pair(self, current, roi=ROI, reference=None):
        result = registration.register_frames(self.uri(self.reference if reference is None else reference), self.uri(current), roi)
        json.dumps(result, allow_nan=False)
        return result

    def require_accepted(self, result):
        self.assertTrue(result["accepted"], json.dumps({k: v for k, v in result.items() if k not in ("reference", "current")}, indent=2))

    def test_empty_plane_viewpoint_change_has_independent_distributed_support(self):
        A = cv.getRotationMatrix2D((256, 192), .7, 1.005)
        A[:, 2] += [3, 2]
        current = cv.warpAffine(self.reference, A, (512, 384))
        result = self.run_pair(current)
        self.require_accepted(result)
        geometry = result["diagnostics"]["geometry"]
        self.assertGreaterEqual(geometry["heldoutErrors"]["count"], 16)
        self.assertGreaterEqual(len(geometry["heldoutCells"]), 3)
        self.assertEqual(result["diagnostics"]["visibility"]["supportVisibleFraction"], 1)
        self.assertTrue(set(map(tuple, geometry["trainCells"])).isdisjoint(map(tuple, geometry["heldoutCells"])))
        self.assertTrue(result["reference"].startswith("data:image/png;base64,"))

    def test_local_colored_box_is_preserved_and_beyond_support_is_exact_reference(self):
        current, _ = self.translated()
        cv.rectangle(current, (215, 145), (310, 225), (45, 95, 205), -1)
        result = self.run_pair(current)
        self.require_accepted(result)
        reference, aligned = self.decode(result["reference"]), self.decode(result["current"])
        height, width = reference.shape[:2]
        self.assertEqual((width, height), (240, 180))
        self.assertEqual(result["coordinateSize"], {"width": 512, "height": 384})
        mask = np.zeros((height, width), np.uint8)
        cv.fillPoly(mask, [np.int32(np.round(np.float32([[p["x"], p["y"]] for p in ROI]) * [width, height]))], 255)
        support = cv.dilate(mask, np.ones((3, 3), np.uint8))
        self.assertTrue(np.array_equal(reference[support == 0], aligned[support == 0]))
        changed = np.abs(reference.astype(float) - aligned.astype(float)).mean(axis=2)
        self.assertGreater(float((changed[mask > 0] > 24).mean()), .025)

    def test_obvious_local_occlusion_retains_enough_independent_floor_support(self):
        # A distinct 15% ROI occluder hides reference features. Registration is
        # decided from remaining independent floor geometry, never a required
        # fraction of all features visible in the empty reference.
        current, _ = self.translated()
        cv.rectangle(current, (150, 55), (360, 145), (45, 95, 205), -1)
        result = self.run_pair(current)
        self.require_accepted(result)
        matching, geometry = result["diagnostics"]["matching"], result["diagnostics"]["geometry"]
        self.assertEqual(result["diagnostics"]["protocol"]["id"], "clearpath-local-sift-roi-v3")
        self.assertEqual(matching["referenceMatchFractionRole"], "diagnostic_only_occlusion_sensitive")
        self.assertGreaterEqual(matching["uniqueRoiMatches"], 64)
        self.assertGreaterEqual(geometry["trainInliers"], 40)
        self.assertGreaterEqual(geometry["heldoutErrors"]["count"], 16)
        self.assertGreater(result["diagnostics"]["appearance"]["unfilteredRgbChangedRatio"], .10)
        reference, aligned = self.decode(result["reference"]), self.decode(result["current"])
        self.assertGreater(float(np.abs(reference[29:64, 74:160].astype(float)
                                        - aligned[29:64, 74:160].astype(float)).mean()), 35)

    def test_too_few_texture_matches_reject(self):
        image = np.full_like(self.reference, 128)
        result = self.run_pair(image, reference=image)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "insufficient_unique_texture")

    def test_repetitive_floor_does_not_prove_a_transform(self):
        yy, xx = np.indices((384, 512))
        tiles = np.uint8(75 + 100 * ((xx // 8 + yy // 8) % 2))
        reference = cv.cvtColor(tiles, cv.COLOR_GRAY2BGR)
        current = cv.warpAffine(reference, np.float32([[1, 0, 3], [0, 1, 2]]), (512, 384))
        result = self.run_pair(current, reference=reference)
        self.assertFalse(result["accepted"])

    def test_two_planes_inside_roi_reject(self):
        a, _ = self.translated(4, 2)
        b, _ = self.translated(-4, -2)
        a[:, 256:] = b[:, 256:]
        result = self.run_pair(a)
        self.assertFalse(result["accepted"])
        self.assertIn(result["reason"], {"inconsistent_plane_or_matches", "insufficient_independent_matches", "insufficient_spatial_support"})

    def test_new_object_dominating_roi_cannot_register_as_the_floor(self):
        current, _ = self.translated()
        cv.rectangle(current, (65, 50), (450, 335), (50, 85, 210), -1)
        self.assertFalse(self.run_pair(current)["accepted"])

    def test_new_textured_object_with_its_own_motion_cannot_dominate_the_floor(self):
        # Adversarially reuse reference texture on a large new object so it
        # supplies plausible feature matches, but follows a different plane.
        current, _ = self.translated()
        object_plane, _ = self.translated(11, -5)
        current[65:320, 85:425] = object_plane[65:320, 85:425]
        result = self.run_pair(current)
        self.assertFalse(result["accepted"])
        self.assertIn(result["reason"], {"inconsistent_plane_or_matches", "insufficient_spatial_support"})

    def test_partial_roi_crop_and_filter_support_crop_reject(self):
        current, _ = self.translated(12, 2)
        roi = [[.04, .1], [.98, .1], [.98, .9], [.04, .9]]
        result = self.run_pair(current, roi)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "roi_support_clipped")
        self.assertLess(result["diagnostics"]["visibility"]["supportVisibleFraction"], 1)
        edge_roi = [[.001, .1], [.9, .1], [.9, .9], [.001, .9]]
        self.assertEqual(self.run_pair(current, edge_roi)["reason"], "roi_support_clipped")

    def test_area_resize_and_analysis_neighborhood_support_crop_reject(self):
        current, _ = self.translated(4, 2)
        roi = [[.04, .1], [.98, .1], [.98, .9], [.04, .9]]
        result = self.run_pair(current, roi)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "roi_support_clipped")
        visibility = result["diagnostics"]["visibility"]
        self.assertEqual(visibility["roiVisibleFraction"], 1.0)
        self.assertLess(visibility["supportVisibleFraction"], 1.0)
        self.assertEqual(visibility["supportHaloReferencePx"], 7)

    def test_analysis_roi_neighborhood_keeps_real_current_pixels_before_fill(self):
        current, _ = self.translated()
        # This object is just outside the ROI. Its pixels must survive in the
        # one-pixel analysis halo read by the downstream ROI 3x3 operation.
        cv.rectangle(current, (49, 122), (53, 202), (45, 95, 205), -1)
        result = self.run_pair(current)
        self.require_accepted(result)
        reference, aligned = self.decode(result["reference"]), self.decode(result["current"])
        difference = np.abs(reference.astype(float) - aligned.astype(float)).max(axis=2)
        self.assertGreater(float(difference[58:93, 23].max()), 24)
        self.assertEqual(result["diagnostics"]["processing"]["analysisSupportHaloPx"], 1)
        self.assertTrue(np.array_equal(reference[:, :23], aligned[:, :23]))

    def test_large_motion_reject(self):
        current, _ = self.translated(115, 2)
        result = self.run_pair(current)
        self.assertFalse(result["accepted"])
        self.assertIn(result["reason"], {"excessive_transform", "insufficient_independent_matches", "insufficient_spatial_support"})

    def test_identity_never_smooths_away_a_change(self):
        result = self.run_pair(self.reference.copy())
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "identity_no_compensation")
        self.assertNotIn("current", result)

    def color_checker(self, local=False):
        current, _ = self.translated(2, 1)
        yy, xx = np.indices((384, 512))
        checker = (2 * ((xx + yy) % 2) - 1)[:, :, None]
        delta = checker * np.array([81, -20, 40])
        if local:
            selected = np.zeros((384, 512, 1), np.uint8)
            selected[140:230, 210:310] = 1
            delta *= selected
        return np.clip(current.astype(np.int16) + delta, 0, 255).astype(np.uint8)

    def test_true_translation_with_broad_equal_luminance_color_checker_rejects(self):
        result = self.run_pair(self.color_checker())
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "suppressed_chromatic_change")

    def test_true_translation_with_local_color_checker_rejects(self):
        result = self.run_pair(self.color_checker(local=True))
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "suppressed_chromatic_change")
        appearance = result["diagnostics"]["appearance"]
        self.assertGreaterEqual(appearance["unfilteredChroma"]["changedRatio"], .025)
        self.assertLess(appearance["filteredChroma"]["changedRatio"], .025)

    def test_jpeg_input_supported_but_output_is_lossless(self):
        current, _ = self.translated()
        result = registration.register_frames(self.uri(self.reference, ".jpg"), self.uri(current, ".jpg"), ROI)
        self.require_accepted(result)
        self.assertTrue(result["current"].startswith("data:image/png;base64,"))

    def test_mismatched_dimensions_and_unsafe_polygons_reject(self):
        uri = self.uri(self.reference)
        result = registration.register_frames(uri, self.uri(self.reference[:200]), ROI)
        self.assertEqual(result["reason"], "image_dimensions_mismatch")
        star = [[.5 + .4 * np.cos(i * 4 * np.pi / 5), .5 + .4 * np.sin(i * 4 * np.pi / 5)] for i in range(5)]
        polygons = ([], [[0, 0], [1, 1], [0, 1], [1, 0]], star,
                    [[.1, .1], [.9, .1], [float("nan"), .9]],
                    [{"x": True, "y": .1}, {"x": .9, "y": .1}, {"x": .5, "y": .9}])
        for polygon in polygons:
            self.assertEqual(registration.register_frames(uri, uri, polygon)["reason"], "invalid_polygon")

    def test_dependency_unavailable_returns_diagnostics_without_private_paths(self):
        uri = self.uri(self.reference)
        with patch.object(registration, "_dependencies", return_value=(None, None)):
            result = registration.register_frames(uri, uri, ROI)
        self.assertFalse(result["accepted"])
        self.assertEqual(result["reason"], "registration_unavailable")
        self.assertNotIn("/Users/", json.dumps(result))


if __name__ == "__main__":
    unittest.main()
