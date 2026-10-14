"""Local HTTP contracts for optional vision; no native CV or image files."""

from contextlib import contextmanager
import json
from pathlib import Path
import sys
import types
import unittest
from unittest.mock import Mock, patch

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import MAX_BODY, MAX_VISION_BODY
from test_server import json_request, request, running_server


POLYGON = [{"x": .2, "y": .2}, {"x": .8, "y": .2},
           {"x": .8, "y": .8}, {"x": .2, "y": .8}]
PAYLOAD = {"reference": "data:image/png;base64,dGVzdA==",
           "current": "data:image/png;base64,dGVzdA==", "polygon": POLYGON}
ASSESSMENT = {"accepted": True, "reason": "registered", "displayPolygon": POLYGON,
              "alignment": {"inliers": 24, "heldout": 8}}


@contextmanager
def registration_module():
    module = types.ModuleType("registration")
    module.registration_status = Mock(return_value={"available": True, "version": "test-double"})
    module.register_frames = Mock(return_value=ASSESSMENT)
    with patch.dict(sys.modules, {"registration": module}):
        yield module


class LocalVisionHTTPTests(unittest.TestCase):
    def test_status_reports_module_state_without_processing_frames(self):
        with registration_module() as module, running_server() as (server, upstream):
            status, headers, body = json_request(server, "GET", "/api/vision/status")
            self.assertEqual((status, body), (200, {"available": True, "version": "test-double"}))
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertNotIn("Access-Control-Allow-Origin", headers)
            module.registration_status.assert_called_once_with()
            module.register_frames.assert_not_called()
            self.assertEqual(upstream.requests, [])

    def test_register_forwards_exact_payload_and_returns_assessment(self):
        with registration_module() as module, running_server() as (server, upstream):
            origin = f"http://127.0.0.1:{server.server_port}"
            status, headers, body = json_request(server, "POST", "/api/vision/register", PAYLOAD,
                                                  {"Origin": origin, "Sec-Fetch-Site": "same-origin"})
            self.assertEqual((status, body), (200, ASSESSMENT))
            self.assertEqual(headers["Cache-Control"], "no-store")
            module.register_frames.assert_called_once_with(PAYLOAD["reference"], PAYLOAD["current"], POLYGON)
            module.registration_status.assert_not_called()
            self.assertFalse(server.vision_slot.locked())
            self.assertEqual(upstream.requests, [])

    def test_schema_json_and_foreign_origins_fail_before_module_calls(self):
        with registration_module() as module, running_server() as (server, upstream):
            malformed = [{}, [], {"reference": "x", "current": "y"}, {**PAYLOAD, "path": "/private/image"}]
            for value in malformed:
                with self.subTest(value_type=type(value).__name__, keys=list(value) if isinstance(value, dict) else None):
                    status, _, body = json_request(server, "POST", "/api/vision/register", value)
                    self.assertEqual((status, body["error"]["code"]), (400, "invalid_json"))
            status, _, raw = request(server, "POST", "/api/vision/register", "{",
                                      {"Content-Type": "application/json"})
            self.assertEqual((status, json.loads(raw)["error"]["code"]), (400, "invalid_json"))
            foreign = [{"Origin": "https://other.example"}, {"Origin": "null"},
                       {"Sec-Fetch-Site": "cross-site"}, {"Host": "other.example"}]
            for headers in foreign:
                for method, path, value in [("POST", "/api/vision/register", PAYLOAD),
                                             ("GET", "/api/vision/status", None)]:
                    with self.subTest(method=method, headers=headers):
                        status, response_headers, _ = json_request(server, method, path, value, headers)
                        self.assertEqual(status, 403)
                        self.assertNotIn("Access-Control-Allow-Origin", response_headers)
            module.register_frames.assert_not_called()
            module.registration_status.assert_not_called()
            self.assertEqual(upstream.requests, [])

    def test_vision_two_megabyte_limit_does_not_expand_ring_limit(self):
        self.assertEqual(MAX_VISION_BODY, 2 * 1024 * 1024)
        self.assertEqual(MAX_BODY, 128 * 1024)
        with registration_module() as module, running_server() as (server, upstream):
            # Exercise exactly the HTTP vision boundary. The mock owns image
            # validation; this test never asks a decoder to accept this padding.
            value = {**PAYLOAD}
            remaining = MAX_VISION_BODY - len(json.dumps(value).encode("utf-8"))
            value["reference"] += "x" * remaining
            self.assertEqual(len(json.dumps(value).encode("utf-8")), MAX_VISION_BODY)
            self.assertEqual(json_request(server, "POST", "/api/vision/register", value)[0], 200)
            module.register_frames.assert_called_once()
            for path, limit in [("/api/vision/register", MAX_VISION_BODY), ("/api/ring/session", MAX_BODY)]:
                with self.subTest(path=path):
                    status, _, body = request(server, "POST", path, "{}", {
                        "Content-Type": "application/json", "Content-Length": str(limit + 1)})
                    self.assertEqual((status, json.loads(body)["error"]["code"]), (413, "body_too_large"))
            self.assertEqual(module.register_frames.call_count, 1)
            self.assertEqual(upstream.requests, [])

    def test_busy_slot_returns_429_without_calling_module_and_recovers(self):
        with registration_module() as module, running_server() as (server, _):
            self.assertTrue(server.vision_slot.acquire(blocking=False))
            try:
                status, _, body = json_request(server, "POST", "/api/vision/register", PAYLOAD)
                self.assertEqual((status, body["error"]["code"]), (429, "vision_busy"))
                module.register_frames.assert_not_called()
            finally:
                server.vision_slot.release()
            self.assertEqual(json_request(server, "POST", "/api/vision/register", PAYLOAD)[0], 200)
            module.register_frames.assert_called_once()
            self.assertFalse(server.vision_slot.locked())

    def test_module_value_error_is_safe_400_and_releases_slot_for_next_call(self):
        with registration_module() as module, running_server() as (server, _):
            module.register_frames.side_effect = [ValueError("private decoder detail"), ASSESSMENT]
            status, _, body = json_request(server, "POST", "/api/vision/register", PAYLOAD)
            self.assertEqual((status, body["error"]["code"]), (400, "invalid_frames"))
            self.assertNotIn("private decoder detail", json.dumps(body))
            self.assertFalse(server.vision_slot.locked())
            self.assertEqual(json_request(server, "POST", "/api/vision/register", PAYLOAD)[2], ASSESSMENT)
            self.assertEqual(module.register_frames.call_count, 2)
            self.assertFalse(server.vision_slot.locked())

    def test_unavailable_module_reports_status_and_503_then_releases_slot(self):
        with running_server() as (server, _):
            with patch.dict(sys.modules, {"registration": None}):
                status, _, body = json_request(server, "GET", "/api/vision/status")
                self.assertEqual((status, body), (200, {"available": False, "reason": "not_installed"}))
                status, _, body = json_request(server, "POST", "/api/vision/register", PAYLOAD)
                self.assertEqual((status, body["error"]["code"]), (503, "registration_unavailable"))
                self.assertFalse(server.vision_slot.locked())
            with registration_module() as module:
                self.assertEqual(json_request(server, "POST", "/api/vision/register", PAYLOAD)[0], 200)
                module.register_frames.assert_called_once()


if __name__ == "__main__":
    unittest.main()
