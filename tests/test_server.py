"""Real local HTTP requests with an in-memory official Ring upstream double."""

from contextlib import contextmanager
import http.client
import io
import json
from pathlib import Path
import socket
import ssl
import sys
import tempfile
import threading
import unittest
from unittest.mock import patch
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, urlsplit
from urllib.request import Request

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from server import (API_BASE, APIError, LocalServer, MAX_BODY, NoRedirects,
                    RingClient, UpstreamResponse, official_transport, ring_tls_context)


TOKEN = "test-only-fake-playground-token"
DEVICE = "ava1.ring.device.test"
SDP = b"v=0\r\nm=video 9 UDP/TLS/RTP/SAVPF 96\r\na=recvonly\r\n"


class RingUpstreamDouble:
    def __init__(self):
        self.requests = []
        self.error = None
        self.devices = {"data": [{"type": "devices", "id": DEVICE,
                                  "attributes": {"name": "Package (official simulator)"}}]}
        self.location = API_BASE + f"/v1/devices/{DEVICE}/media/streaming/whep/sessions/official-session"
        self.answer = SDP

    def __call__(self, request):
        self.requests.append(request)
        if self.error:
            raise self.error
        if request.method == "POST":
            return UpstreamResponse(201, {"Location": self.location}, self.answer)
        if request.method == "DELETE":
            return UpstreamResponse(204, {}, b"")
        if "/history/" in request.full_url:
            return UpstreamResponse(200, {}, json.dumps({"data": [{"type": "history-events",
                "id": "event-1", "attributes": {"event_type": "on_demand", "start": 1000, "end": 2000}}]}).encode())
        return UpstreamResponse(200, {}, json.dumps(self.devices).encode())


@contextmanager
def running_server(token=""):
    with tempfile.TemporaryDirectory() as temporary:
        root = Path(temporary)
        dist = root / "dist"
        dist.mkdir()
        (dist / "index.html").write_text("<title>ClearPath test</title>", encoding="utf-8")
        (root / "private.txt").write_text("private", encoding="utf-8")
        (dist / "escape.txt").symlink_to(root / "private.txt")
        upstream = RingUpstreamDouble()
        server = LocalServer(("127.0.0.1", 0), dist, RingClient(token, upstream))
        thread = threading.Thread(target=server.serve_forever, daemon=True)
        thread.start()
        try:
            yield server, upstream
        finally:
            server.shutdown()
            server.server_close()
            thread.join(timeout=2)


def request(server, method, path, body=None, headers=None):
    client = http.client.HTTPConnection("127.0.0.1", server.server_port, timeout=3)
    client.request(method, path, body=body, headers=headers or {})
    response = client.getresponse()
    result = response.status, dict(response.headers), response.read()
    client.close()
    return result


def json_request(server, method, path, value=None, headers=None):
    combined = {"Content-Type": "application/json", **(headers or {})}
    body = json.dumps(value) if value is not None else None
    status, response_headers, response_body = request(server, method, path, body, combined)
    return status, response_headers, json.loads(response_body) if response_body else None


class LocalHTTPTests(unittest.TestCase):
    def test_health_and_static_site_without_credentials(self):
        with running_server() as (server, upstream):
            status, headers, body = json_request(server, "GET", "/api/health")
            self.assertEqual(status, 200)
            self.assertEqual(body["ring"], {"configured": False, "token_source": "none", "verified": False, "active_streams": 0})
            self.assertEqual(headers["Cache-Control"], "no-store")
            status, _, body = request(server, "GET", "/")
            self.assertEqual(status, 200)
            self.assertIn(b"ClearPath test", body)
            status, headers, body = request(server, "HEAD", "/")
            self.assertEqual((status, body), (200, b""))
            self.assertGreater(int(headers["Content-Length"]), 0)
            self.assertEqual(upstream.requests, [])

    def test_token_lifecycle_and_official_devices_protocol(self):
        with running_server() as (server, upstream):
            status, _, error = json_request(server, "GET", "/api/ring/devices")
            self.assertEqual(status, 401)
            self.assertEqual(error["error"]["code"], "ring_token_required")
            origin = f"http://127.0.0.1:{server.server_port}"
            status, _, result = json_request(server, "POST", "/api/ring/session", {"access_token": TOKEN}, {"Origin": origin})
            self.assertEqual(status, 200)
            self.assertTrue(result["ring"]["configured"])
            self.assertFalse(result["ring"]["verified"])
            self.assertNotIn(TOKEN, json.dumps(result))
            status, _, devices = json_request(server, "GET", "/api/ring/devices")
            self.assertEqual((status, devices), (200, upstream.devices))
            sent = upstream.requests[-1]
            self.assertEqual(sent.full_url, API_BASE + "/v1/devices?include=status%2Ccapabilities")
            self.assertEqual(sent.get_header("Authorization"), "Bearer " + TOKEN)
            self.assertEqual(sent.method, "GET")
            self.assertTrue(json_request(server, "GET", "/api/health")[2]["ring"]["verified"])
            status, _, result = json_request(server, "DELETE", "/api/ring/session")
            self.assertEqual(status, 200)
            self.assertFalse(result["ring"]["configured"])
            self.assertEqual(json_request(server, "GET", "/api/ring/devices")[0], 401)

    def test_environment_source_and_secret_redaction(self):
        with running_server(TOKEN) as (server, upstream):
            self.assertEqual(json_request(server, "GET", "/api/health")[2]["ring"]["token_source"], "environment")
            upstream.devices["access_token"] = TOKEN
            upstream.devices["data"][0]["attributes"]["name"] = "Never echo " + TOKEN
            status, _, body = request(server, "GET", "/api/ring/devices")
            self.assertEqual(status, 200)
            self.assertNotIn(TOKEN.encode(), body)
            self.assertNotIn(b"access_token", body)

    def test_host_origin_and_fetch_metadata_reject_other_pages(self):
        with running_server(TOKEN) as (server, upstream):
            cases = [
                {"Host": "attacker.example"},
                {"Origin": "https://attacker.example"},
                {"Origin": "null"},
                {"Origin": f"http://localhost:{server.server_port}"},
                {"Sec-Fetch-Site": "cross-site"},
            ]
            for headers in cases:
                with self.subTest(headers=headers):
                    self.assertEqual(json_request(server, "GET", "/api/ring/devices", headers=headers)[0], 403)
            self.assertEqual(upstream.requests, [])
            status, headers, _ = request(server, "OPTIONS", "/api/ring/session", headers={"Origin": "https://attacker.example"})
            self.assertEqual(status, 403)
            self.assertNotIn("Access-Control-Allow-Origin", headers)

    def test_static_traversal_hidden_files_and_symlinks_cannot_escape_dist(self):
        with running_server() as (server, _):
            for path in ("/../private.txt", "/%2e%2e/private.txt", "/escape.txt", "/.env", "/%2eenv", "/%5c..%5cprivate.txt"):
                with self.subTest(path=path):
                    self.assertEqual(request(server, "GET", path)[0], 404)

    def test_events_use_documented_filters_and_keep_real_event_type(self):
        with running_server(TOKEN) as (server, upstream):
            path = f"/api/ring/events?device_id={DEVICE}&event_types=on_demand,motion.human&page%5Bkey%5D=2026-10-13T00%3A00%3A00Z"
            status, _, result = json_request(server, "GET", path)
            self.assertEqual(status, 200)
            self.assertEqual(result["data"][0]["attributes"]["event_type"], "on_demand")
            sent = urlsplit(upstream.requests[-1].full_url)
            self.assertEqual(sent.path, f"/v1/history/devices/{DEVICE}/events")
            self.assertEqual(parse_qs(sent.query), {"event_types": ["on_demand,motion.human"], "page[key]": ["2026-10-13T00:00:00Z"]})
            self.assertEqual(json_request(server, "GET", f"/api/ring/events?device_id={DEVICE}&start=0")[0], 400)

    def test_whep_round_trip_returns_local_handle_and_deletes_known_session(self):
        with running_server(TOKEN) as (server, upstream):
            status, headers, answer = request(server, "POST", f"/api/ring/stream?device_id={DEVICE}&component_id=1", SDP, {"Content-Type": "application/sdp"})
            self.assertEqual((status, answer), (201, SDP))
            self.assertEqual(headers["Content-Type"], "application/sdp")
            local_url = headers["Location"]
            self.assertRegex(local_url, r"^/api/ring/stream/[A-Za-z0-9_-]{32}$")
            sent = upstream.requests[-1]
            self.assertEqual(sent.full_url, API_BASE + f"/v1/devices/{DEVICE}/media/streaming/whep/sessions?component_id=1")
            self.assertEqual(sent.data, SDP)
            self.assertEqual(sent.get_header("Content-type"), "application/sdp")
            self.assertEqual(json_request(server, "GET", "/api/health")[2]["ring"]["active_streams"], 1)
            self.assertEqual(request(server, "DELETE", local_url)[0], 204)
            self.assertEqual(upstream.requests[-1].full_url, upstream.location)
            self.assertEqual(upstream.requests[-1].method, "DELETE")
            self.assertEqual(request(server, "DELETE", local_url)[0], 404)
            self.assertEqual(json_request(server, "GET", "/api/health")[2]["ring"]["active_streams"], 0)

    def test_clearing_token_closes_stream_before_forgetting_credentials(self):
        with running_server(TOKEN) as (server, upstream):
            self.assertEqual(request(server, "POST", f"/api/ring/stream?device_id={DEVICE}", SDP, {"Content-Type": "application/sdp"})[0], 201)
            self.assertEqual(json_request(server, "DELETE", "/api/ring/session")[0], 200)
            self.assertEqual(upstream.requests[-1].method, "DELETE")
            self.assertEqual(upstream.requests[-1].get_header("Authorization"), "Bearer " + TOKEN)

    def test_official_playground_location_routing_query_is_preserved_only_upstream(self):
        with running_server(TOKEN) as (server, upstream):
            upstream.location += "?location=opaque-routing-value%2B123"
            status, headers, answer = request(server, "POST", f"/api/ring/stream?device_id={DEVICE}", SDP, {"Content-Type": "application/sdp"})
            self.assertEqual(status, 201)
            self.assertNotIn("location=", headers["Location"])
            self.assertNotIn(b"opaque-routing-value", answer)
            self.assertEqual(request(server, "DELETE", headers["Location"])[0], 204)
            self.assertEqual(upstream.requests[-1].full_url, upstream.location)

    def test_whep_refuses_arbitrary_or_malformed_upstream_locations(self):
        bad_urls = [
            "https://attacker.example/collect",
            "http://api.amazonvision.com/v1/collect",
            "https://api.amazonvision.com@attacker.example/collect",
            "https://api.amazonvision.com/v1/devices/other/media/streaming/whep/sessions/session",
            API_BASE + f"/v1/devices/{DEVICE}/media/streaming/whep/sessions/%2e%2e",
            API_BASE + f"/v1/devices/{DEVICE}/media/streaming/whep/sessions/a%2fb",
            API_BASE + f"/v1/devices/{DEVICE}/media/streaming/whep/sessions/id?token=secret",
        ]
        with running_server(TOKEN) as (server, upstream):
            for url in bad_urls:
                with self.subTest(url=url):
                    upstream.location = url
                    status, _, body = json_request_raw_sdp(server)
                    self.assertEqual(status, 502)
                    self.assertEqual(body["error"]["code"], "invalid_ring_session")
            self.assertFalse(any(item.method == "DELETE" for item in upstream.requests))

    def test_invalid_request_inputs_are_rejected_before_contacting_ring(self):
        with running_server(TOKEN) as (server, upstream):
            cases = [
                ("GET", "/api/ring/devices?include=password", None, {}),
                ("GET", "/api/ring/devices?include=status&include=capabilities", None, {}),
                ("GET", "/api/ring/events?device_id=..", None, {}),
                ("GET", "/api/ring/events?device_id=a%2fb", None, {}),
                ("GET", "/api/ring/frame?device_id=" + DEVICE, None, {}),
                ("POST", "/api/ring/session", "{}", {"Content-Type": "application/json"}),
                ("POST", "/api/ring/session", '{"access_token":"a\\nb"}', {"Content-Type": "application/json"}),
                ("POST", "/api/ring/session", "{}", {"Content-Type": "text/plain"}),
                ("POST", "/api/ring/session", "x" * (MAX_BODY + 1), {"Content-Type": "application/json"}),
                ("POST", "/api/ring/stream?device_id=" + DEVICE, b"invalid", {"Content-Type": "application/sdp"}),
                ("POST", "/api/ring/stream?device_id=" + DEVICE + "&component_id=abc", SDP, {"Content-Type": "application/sdp"}),
            ]
            for method, path, body, headers in cases:
                with self.subTest(path=path, method=method):
                    self.assertGreaterEqual(request(server, method, path, body, headers)[0], 400)
            self.assertEqual(upstream.requests, [])

    def test_upstream_failure_returns_safe_error_and_invalidates_verified_flag(self):
        with running_server(TOKEN) as (server, upstream):
            self.assertEqual(json_request(server, "GET", "/api/ring/devices")[0], 200)
            upstream.error = APIError(401, "ring_request_failed", "Token expired.", 401)
            status, headers, result = json_request(server, "GET", "/api/ring/devices")
            self.assertEqual(status, 401)
            self.assertEqual(result["error"]["upstream_status"], 401)
            self.assertEqual(headers["Cache-Control"], "no-store")
            self.assertFalse(json_request(server, "GET", "/api/health")[2]["ring"]["verified"])


def json_request_raw_sdp(server):
    status, headers, body = request(server, "POST", f"/api/ring/stream?device_id={DEVICE}", SDP, {"Content-Type": "application/sdp"})
    return status, headers, json.loads(body)


class TransportTests(unittest.TestCase):
    def test_simultaneous_whep_requests_reserve_the_session_limit(self):
        waiting = threading.Condition()
        release = threading.Event()
        upstream = RingUpstreamDouble()
        started = 0
        errors = []

        def blocked_transport(request):
            nonlocal started
            with waiting:
                started += 1
                waiting.notify_all()
            if not release.wait(timeout=3):
                raise APIError(504, "test_timeout", "Mock upstream timeout.")
            return upstream(request)

        ring = RingClient(TOKEN, blocked_transport)

        def connect():
            try:
                ring.start_stream(DEVICE, SDP)
            except Exception as exc:
                errors.append(exc)

        threads = [threading.Thread(target=connect) for _ in range(4)]
        for thread in threads:
            thread.start()
        try:
            with waiting:
                self.assertTrue(waiting.wait_for(lambda: started == 4, timeout=2))
            with self.assertRaises(APIError) as raised:
                ring.start_stream(DEVICE, SDP)
            self.assertEqual(raised.exception.code, "stream_limit")
        finally:
            release.set()
            for thread in threads:
                thread.join(timeout=3)
        self.assertEqual(errors, [])
        self.assertEqual(ring.status()["active_streams"], 4)

    def test_invalid_sdp_answer_closes_the_valid_official_session(self):
        upstream = RingUpstreamDouble()
        upstream.answer = b"not SDP"
        ring = RingClient(TOKEN, upstream)
        with self.assertRaises(APIError) as raised:
            ring.start_stream(DEVICE, SDP)
        self.assertEqual(raised.exception.code, "invalid_ring_sdp")
        self.assertEqual(upstream.requests[-1].method, "DELETE")
        self.assertEqual(ring.status()["active_streams"], 0)

    def test_no_redirect_handler_never_forwards_credentials(self):
        self.assertIsNone(NoRedirects().redirect_request(None, None, 302, "", {}, "https://attacker.example"))

    def test_official_transport_rejects_non_ring_origins(self):
        for url in ("http://api.amazonvision.com/v1/devices", "https://attacker.example/v1/devices", "https://api.amazonvision.com.attacker.example/v1/devices"):
            with self.subTest(url=url), self.assertRaises(APIError) as raised:
                official_transport(Request(url))
            self.assertEqual(raised.exception.code, "invalid_upstream")

    def test_upstream_error_body_and_reason_never_reach_local_error(self):
        raw_error = HTTPError(API_BASE + "/v1/devices", 401, TOKEN, {}, io.BytesIO(TOKEN.encode()))
        with patch("server.build_opener") as opener:
            opener.return_value.open.side_effect = raw_error
            with self.assertRaises(APIError) as raised:
                official_transport(Request(API_BASE + "/v1/devices"))
        self.assertEqual(raised.exception.status, 401)
        self.assertNotIn(TOKEN, str(raised.exception))

    def test_upstream_timeout_maps_to_504(self):
        with patch("server.build_opener") as opener:
            opener.return_value.open.side_effect = URLError(socket.timeout())
            with self.assertRaises(APIError) as raised:
                official_transport(Request(API_BASE + "/v1/devices"))
        self.assertEqual(raised.exception.status, 504)

    def test_tls_verification_failure_is_distinct_and_never_leaks_details(self):
        with patch("server.build_opener") as opener:
            opener.return_value.open.side_effect = URLError(ssl.SSLCertVerificationError(TOKEN))
            with self.assertRaises(APIError) as raised:
                official_transport(Request(API_BASE + "/v1/devices"))
        self.assertEqual(raised.exception.code, "ring_tls_verification_failed")
        self.assertNotIn(TOKEN, str(raised.exception))

    def test_tls_context_always_requires_certificate_and_hostname_validation(self):
        context = ring_tls_context()
        self.assertEqual(context.verify_mode, ssl.CERT_REQUIRED)
        self.assertTrue(context.check_hostname)

    def test_server_cannot_bind_all_interfaces(self):
        with self.assertRaises(ValueError):
            LocalServer(("0.0.0.0", 0), Path("."))


if __name__ == "__main__":
    unittest.main()
