#!/usr/bin/env python3
"""Local-only ClearPath host and a small, official Ring Partner API adapter.

Run after building the web app: python3 server.py
No packages, account passwords, client secrets, database, or paid services needed.
This is a single-user development server, not a production OAuth integration.
"""

from __future__ import annotations

import argparse
from dataclasses import dataclass
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
import json
import mimetypes
import os
from pathlib import Path
import re
import secrets
import socket
import ssl
import threading
import time
from typing import Callable
from urllib.error import HTTPError, URLError
from urllib.parse import parse_qs, quote, unquote, urlencode, urljoin, urlsplit
from urllib.request import HTTPRedirectHandler, HTTPSHandler, Request, build_opener


API_BASE = "https://api.amazonvision.com"
MAX_BODY = 128 * 1024
MAX_VISION_BODY = 2 * 1024 * 1024
MAX_UPSTREAM_BODY = 2 * 1024 * 1024
MAX_SESSIONS = 4


class APIError(Exception):
    def __init__(self, status: int, code: str, message: str, upstream_status=None):
        super().__init__(message)
        self.status, self.code, self.message = status, code, message
        self.upstream_status = upstream_status


@dataclass(frozen=True)
class UpstreamResponse:
    status: int
    headers: dict[str, str]
    body: bytes


class NoRedirects(HTTPRedirectHandler):
    """Do not forward a Bearer token to an upstream redirect target."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):
        return None


def ring_tls_context():
    """Use verified platform trust when a python.org install has no CA bundle.

    Do not replace an explicitly configured SSL_CERT_FILE/SSL_CERT_DIR or
    disable certificate/hostname validation. macOS ships /etc/ssl/cert.pem.
    """
    paths = ssl.get_default_verify_paths()
    system_bundle = Path("/etc/ssl/cert.pem")
    if (not paths.cafile and not paths.capath
            and not os.environ.get("SSL_CERT_FILE") and not os.environ.get("SSL_CERT_DIR")
            and system_bundle.is_file()):
        return ssl.create_default_context(cafile=str(system_bundle))
    return ssl.create_default_context()


def official_transport(request: Request) -> UpstreamResponse:
    """Only Ring's fixed HTTPS origin is reachable through this adapter."""
    parsed = urlsplit(request.full_url)
    try:
        port = parsed.port
    except ValueError:
        raise APIError(502, "invalid_upstream", "Ring returned an unsupported endpoint.") from None
    if (parsed.scheme != "https" or parsed.hostname != "api.amazonvision.com"
            or port not in (None, 443) or parsed.username or parsed.password):
        raise APIError(502, "invalid_upstream", "Ring returned an unsupported endpoint.")
    try:
        with build_opener(NoRedirects(), HTTPSHandler(context=ring_tls_context())).open(request, timeout=15) as response:
            body = response.read(MAX_UPSTREAM_BODY + 1)
            if len(body) > MAX_UPSTREAM_BODY:
                raise APIError(502, "upstream_too_large", "Ring response exceeded the local limit.")
            return UpstreamResponse(response.status, dict(response.headers.items()), body)
    except HTTPError as exc:
        # Do not expose upstream bodies or reason strings: they may contain secrets.
        status = exc.code
        exc.close()
        if status in (400, 401, 403, 404, 409, 429, 503):
            local_status = status
        else:
            local_status = 502
        messages = {
            401: "Ring token is invalid or expired. Generate a new Playground token.",
            403: "This token does not permit the requested Ring operation.",
            404: "Ring could not find this device or stream.",
            429: "Ring rate limit reached. Wait before trying again.",
            503: "Ring device or service is currently unavailable.",
        }
        raise APIError(local_status, "ring_request_failed", messages.get(
            status, "Ring rejected the request."), status) from None
    except (socket.timeout, TimeoutError):
        raise APIError(504, "ring_timeout", "Ring did not respond in time. Try again.") from None
    except URLError as exc:
        if isinstance(exc.reason, ssl.SSLCertVerificationError):
            raise APIError(502, "ring_tls_verification_failed", "Python could not verify Ring's HTTPS certificate. Check the local CA certificate configuration; certificate verification remains enabled.") from None
        if isinstance(exc.reason, (socket.timeout, TimeoutError)):
            raise APIError(504, "ring_timeout", "Ring did not respond in time. Try again.") from None
        raise APIError(502, "ring_unreachable", "Could not reach the official Ring API.") from None


def device_segment(value: str) -> str:
    # IDs are opaque. Encode one segment instead of inferring Ring's ID format.
    if (not value or len(value) > 512 or value in (".", "..")
            or any(ord(char) < 32 for char in value) or any(char in value for char in "/\\?#")):
        raise APIError(400, "invalid_device", "Provide the device ID returned by Ring.")
    return quote(value, safe="")


def header_value(headers: dict, name: str) -> str | None:
    return next((value for key, value in headers.items() if key.lower() == name.lower()), None)


class RingClient:
    def __init__(self, token="", transport: Callable = official_transport):
        self._lock = threading.RLock()
        self._token = self._validate_token(token) if token else ""
        self._source = "environment" if token else "none"
        self._verified = False
        self._transport = transport
        self._sessions: dict[str, tuple[str, str, float]] = {}
        self._pending_streams = 0

    @staticmethod
    def _validate_token(token):
        if (not isinstance(token, str) or not token.strip() or len(token) > 16384
                or any(ord(char) < 33 or ord(char) > 126 for char in token.strip())):
            raise APIError(400, "invalid_token", "Provide a valid access token, without a Bearer prefix.")
        token = token.strip()
        if token.lower().startswith("bearer "):
            raise APIError(400, "invalid_token", "Paste the token only, without the Bearer prefix.")
        return token

    def status(self):
        with self._lock:
            self._prune_sessions()
            return {"configured": bool(self._token), "token_source": self._source,
                    "verified": self._verified, "active_streams": len(self._sessions)}

    def set_token(self, token):
        checked = self._validate_token(token)
        self.clear_token()
        with self._lock:
            self._token, self._source, self._verified = checked, "memory", False

    def clear_token(self):
        with self._lock:
            sessions = list(self._sessions.values())
            self._sessions.clear()
            self._token, self._source, self._verified = "", "none", False
        for url, token, _ in sessions:
            try:
                self._request("DELETE", url, token=token)
            except APIError:
                pass  # Ring's short-lived live stream expires even if cleanup fails.

    def _request(self, method, path, body=None, content_type="application/json", token=None):
        with self._lock:
            token = token if token is not None else self._token
        if not token:
            raise APIError(401, "ring_token_required", "Connect a Ring Playground access token first.")
        url = path if path.startswith(API_BASE + "/") else API_BASE + path
        request = Request(url, data=body, method=method, headers={
            "Authorization": "Bearer " + token,
            "Content-Type": content_type,
            "Accept": "application/sdp" if content_type == "application/sdp" else "application/json",
            "User-Agent": "ClearPath-local-prototype/0.1",
        })
        try:
            response = self._transport(request)
        except APIError as exc:
            if exc.upstream_status in (401, 403):
                with self._lock:
                    if self._token == token:
                        self._verified = False
            raise
        if not 200 <= response.status < 300:
            raise APIError(502, "unexpected_ring_response", "Ring returned an unexpected status.", response.status)
        return response, token

    @staticmethod
    def _redact(value, token):
        if isinstance(value, str):
            return value.replace(token, "[redacted]")
        if isinstance(value, list):
            return [RingClient._redact(item, token) for item in value]
        if isinstance(value, dict):
            return {key.replace(token, "[redacted]"): RingClient._redact(item, token) for key, item in value.items()
                    if key.lower() not in ("access_token", "refresh_token", "client_secret")}
        return value

    def get_json(self, path):
        response, token = self._request("GET", path)
        try:
            result = json.loads(response.body)
        except (ValueError, UnicodeError):
            raise APIError(502, "invalid_ring_json", "Ring returned an unreadable JSON response.") from None
        if not isinstance(result, dict) or not isinstance(result.get("data"), list):
            raise APIError(502, "invalid_ring_json", "Ring returned an unexpected JSON:API response.")
        with self._lock:
            if self._token == token:
                self._verified = True
        return self._redact(result, token)

    def _prune_sessions(self):
        # Official streams have already expired by this conservative local TTL.
        self._sessions = {key: item for key, item in self._sessions.items()
                          if time.monotonic() - item[2] < 120}

    def start_stream(self, device_id, offer, component_id=None):
        with self._lock:
            self._prune_sessions()
            if len(self._sessions) + self._pending_streams >= MAX_SESSIONS:
                raise APIError(409, "stream_limit", "Close an existing live stream before starting another.")
            self._pending_streams += 1
        try:
            return self._start_stream(device_id, offer, component_id)
        finally:
            with self._lock:
                self._pending_streams -= 1

    def _start_stream(self, device_id, offer, component_id):
        segment = device_segment(device_id)
        path = f"/v1/devices/{segment}/media/streaming/whep/sessions"
        if component_id is not None:
            path += "?" + urlencode({"component_id": component_id})
        response, token = self._request("POST", path, offer, "application/sdp")
        location = header_value(response.headers, "Location")
        expected_prefix = f"/v1/devices/{segment}/media/streaming/whep/sessions/"
        session_url = urljoin(API_BASE + path, location or "")
        parsed = urlsplit(session_url)
        # Playground returns an opaque `location` routing query. Preserve it
        # for DELETE; never expose it or follow redirects to another origin.
        session_query = parse_qs(parsed.query, keep_blank_values=True)
        valid_query = (not session_query or (set(session_query) == {"location"}
                       and len(session_query["location"]) == 1
                       and 0 < len(session_query["location"][0]) <= 2048))
        suffix = parsed.path[len(expected_prefix):] if parsed.path.startswith(expected_prefix) else ""
        if (response.status != 201 or not location or parsed.scheme != "https"
                or parsed.netloc != "api.amazonvision.com" or not valid_query or parsed.fragment
                or not suffix or "/" in suffix or unquote(suffix) in (".", "..")
                or any(ord(char) < 32 for char in location)
                or any(char in unquote(suffix) for char in "/\\%")):
            known = {"v1", "devices", "media", "streaming", "whep", "sessions", "session"}
            shape = "/".join(part if part in known or not part else "{id}" for part in parsed.path.split("/"))
            query_keys = ",".join(key if re.fullmatch(r"[A-Za-z_]{1,40}", key) else "opaque" for key in parse_qs(parsed.query))
            origin = "official" if parsed.hostname == "api.amazonvision.com" else "other"
            raise APIError(502, "invalid_ring_session", f"Ring session URL validation failed (HTTP {response.status}; origin {origin}; path {shape}; query keys {query_keys or 'none'}). No session values are displayed.")
        if not response.body.startswith(b"v=0"):
            try:
                self._request("DELETE", session_url, token=token)
            except APIError:
                pass
            raise APIError(502, "invalid_ring_sdp", "Ring returned an unreadable SDP answer.")
        handle = secrets.token_urlsafe(24)
        with self._lock:
            if token != self._token:
                self._request("DELETE", session_url, token=token)
                raise APIError(409, "ring_session_changed", "Ring token changed while connecting. Try again.")
            self._sessions[handle] = (session_url, token, time.monotonic())
            self._verified = True
        return response.body.replace(token.encode(), b"[redacted]"), "/api/ring/stream/" + handle

    def stop_stream(self, handle):
        with self._lock:
            session = self._sessions.get(handle)
        if session is None:
            raise APIError(404, "unknown_stream", "This local stream session is no longer available.")
        self._request("DELETE", session[0], token=session[1])
        with self._lock:
            self._sessions.pop(handle, None)


class LocalServer(ThreadingHTTPServer):
    daemon_threads = True

    def __init__(self, address, static_root, ring=None):
        if address[0] != "127.0.0.1":
            raise ValueError("ClearPath must bind to 127.0.0.1")
        self.static_root = Path(static_root).resolve()
        self.ring = ring or RingClient()
        self.vision_slot = threading.Lock()
        super().__init__(address, ClearPathHandler)

    def handle_error(self, request, client_address):
        # No request details, headers, bodies, tracebacks, or tokens in server logs.
        pass


class ClearPathHandler(BaseHTTPRequestHandler):
    server_version = "ClearPathLocal/0.1"

    def setup(self):
        super().setup()
        self.connection.settimeout(10)

    def log_message(self, format, *args):
        pass

    def send_error(self, code, message=None, explain=None):
        self._json(code, {"error": {"code": "http_error", "message": "The HTTP request could not be processed."}})

    def _headers(self, status, content_type, length, extra=None):
        self.send_response(status)
        self.send_header("Content-Type", content_type)
        self.send_header("Content-Length", str(length))
        self.send_header("Cache-Control", "no-store")
        self.send_header("X-Content-Type-Options", "nosniff")
        self.send_header("Referrer-Policy", "no-referrer")
        self.send_header("Cross-Origin-Resource-Policy", "same-origin")
        for key, value in (extra or {}).items():
            self.send_header(key, value)
        self.end_headers()

    def _json(self, status, value):
        body = json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")
        self._headers(status, "application/json; charset=utf-8", len(body))
        if getattr(self, "command", None) != "HEAD":
            self.wfile.write(body)

    def _local_request(self):
        port = self.server.server_port
        allowed_hosts = {f"127.0.0.1:{port}", f"localhost:{port}"}
        if port == 80:
            allowed_hosts.update(("127.0.0.1", "localhost"))
        host = self.headers.get("Host", "").lower()
        if len(self.headers.get_all("Host", [])) != 1 or host not in allowed_hosts:
            raise APIError(403, "local_host_required", "Use the local ClearPath address.")
        origin = self.headers.get("Origin")
        if origin is not None and origin != "http://" + host:
            raise APIError(403, "local_origin_required", "Only the ClearPath page may call this API.")
        if self.headers.get("Sec-Fetch-Site", "none") not in ("same-origin", "none"):
            raise APIError(403, "local_origin_required", "Only the ClearPath page may call this API.")

    def _body(self, content_type, max_size=MAX_BODY):
        if self.headers.get("Transfer-Encoding"):
            raise APIError(400, "invalid_body", "Chunked request bodies are unsupported.")
        lengths = self.headers.get_all("Content-Length", [])
        if len(lengths) != 1 or not re.fullmatch(r"[0-9]+", lengths[0]):
            raise APIError(411, "body_length_required", "Provide a Content-Length header.")
        length = int(lengths[0])
        if length > max_size:
            raise APIError(413, "body_too_large", "Request exceeds the local size limit.")
        if self.headers.get_content_type() != content_type:
            raise APIError(415, "invalid_content_type", f"Use {content_type} for this request.")
        body = self.rfile.read(length)
        if len(body) != length:
            raise APIError(400, "invalid_body", "Request body was incomplete.")
        return body

    @staticmethod
    def _params(query, allowed):
        params = parse_qs(query, keep_blank_values=True)
        if set(params) - set(allowed) or any(len(value) != 1 for value in params.values()):
            raise APIError(400, "invalid_query", "Unsupported or repeated query parameter.")
        return {key: value[0] for key, value in params.items()}

    def _health(self):
        return {"ok": True, "ring": self.server.ring.status(), "api_base": API_BASE}

    def _static(self, path):
        decoded = unquote(path)
        if any(part.startswith(".") for part in decoded.split("/") if part) or "\\" in decoded:
            raise APIError(404, "not_found", "File not found.")
        relative = decoded.lstrip("/") or "index.html"
        candidate = (self.server.static_root / relative).resolve()
        if not candidate.is_relative_to(self.server.static_root) or not candidate.is_file():
            raise APIError(404, "not_found", "Build the frontend first, or check the file address.")
        content_type = mimetypes.guess_type(str(candidate))[0] or "application/octet-stream"
        self._headers(200, content_type, candidate.stat().st_size)
        if self.command != "HEAD":
            with candidate.open("rb") as file:
                while block := file.read(64 * 1024):
                    self.wfile.write(block)

    def _dispatch(self):
        try:
            self._local_request()
            parsed = urlsplit(self.path)
            if parsed.scheme or parsed.netloc or parsed.fragment:
                raise APIError(400, "invalid_path", "Use a local relative request path.")
            path = parsed.path
            if path == "/api/health" and self.command == "GET":
                self._params(parsed.query, ())
                return self._json(200, self._health())
            if path == "/api/vision/status" and self.command == "GET":
                self._params(parsed.query, ())
                try:
                    from registration import registration_status
                    state = registration_status()
                except ImportError:
                    state = {"available": False, "reason": "not_installed"}
                return self._json(200, state)
            if path == "/api/vision/register" and self.command == "POST":
                self._params(parsed.query, ())
                try:
                    value = json.loads(self._body("application/json", MAX_VISION_BODY))
                except (ValueError, UnicodeError):
                    raise APIError(400, "invalid_json", "Provide reference, current and polygon.") from None
                if not isinstance(value, dict) or set(value) != {"reference", "current", "polygon"}:
                    raise APIError(400, "invalid_json", "Provide only reference, current and polygon.")
                if not self.server.vision_slot.acquire(blocking=False):
                    raise APIError(429, "vision_busy", "A local image comparison is already running.")
                try:
                    from registration import register_frames
                    assessment = register_frames(value["reference"], value["current"], value["polygon"])
                except ImportError:
                    raise APIError(503, "registration_unavailable", "The optional local vision dependency is unavailable.") from None
                except (ValueError, TypeError):
                    raise APIError(400, "invalid_frames", "Provide supported local image data and a valid region.") from None
                finally:
                    self.server.vision_slot.release()
                return self._json(200, assessment)
            if path == "/api/ring/session":
                self._params(parsed.query, ())
                if self.command == "POST":
                    try:
                        value = json.loads(self._body("application/json"))
                    except (ValueError, UnicodeError):
                        raise APIError(400, "invalid_json", "Provide a JSON object with access_token.") from None
                    if not isinstance(value, dict) or set(value) != {"access_token"}:
                        raise APIError(400, "invalid_json", "Provide only the access_token field.")
                    self.server.ring.set_token(value["access_token"])
                    return self._json(200, self._health())
                if self.command == "DELETE":
                    self.server.ring.clear_token()
                    return self._json(200, self._health())
            if path == "/api/ring/devices" and self.command == "GET":
                params = self._params(parsed.query, ("include",))
                include = params.get("include", "status,capabilities")
                if not include or set(include.split(",")) - {"status", "capabilities", "location", "configurations"}:
                    raise APIError(400, "invalid_query", "Unsupported Ring include relationship.")
                return self._json(200, self.server.ring.get_json("/v1/devices?" + urlencode({"include": include})))
            if path == "/api/ring/events" and self.command == "GET":
                params = self._params(parsed.query, ("device_id", "event_types", "page[key]"))
                segment = device_segment(params.pop("device_id", ""))
                if "event_types" in params and not re.fullmatch(r"[A-Za-z_]+(?:\.[A-Za-z_]+)*(?:,[A-Za-z_]+(?:\.[A-Za-z_]+)*)*", params["event_types"]):
                    raise APIError(400, "invalid_query", "Invalid Ring event_types filter.")
                if any(len(value) > 1024 or any(ord(c) < 32 for c in value) for value in params.values()):
                    raise APIError(400, "invalid_query", "Query parameter exceeds the local limit.")
                upstream = f"/v1/history/devices/{segment}/events"
                if params:
                    upstream += "?" + urlencode(params)
                return self._json(200, self.server.ring.get_json(upstream))
            if path == "/api/ring/stream" and self.command == "POST":
                params = self._params(parsed.query, ("device_id", "component_id"))
                component = params.get("component_id")
                if component is not None and not re.fullmatch(r"[0-9]{1,8}", component):
                    raise APIError(400, "invalid_query", "component_id must be an integer from Ring capabilities.")
                offer = self._body("application/sdp")
                if not offer.startswith(b"v=0") or b"m=video " not in offer:
                    raise APIError(400, "invalid_sdp", "Provide a WebRTC SDP offer containing a video track.")
                answer, location = self.server.ring.start_stream(params.get("device_id", ""), offer, component)
                self._headers(201, "application/sdp", len(answer), {"Location": location})
                return self.wfile.write(answer)
            if path.startswith("/api/ring/stream/") and self.command == "DELETE":
                self._params(parsed.query, ())
                handle = path.removeprefix("/api/ring/stream/")
                if not re.fullmatch(r"[A-Za-z0-9_-]{32}", handle):
                    raise APIError(404, "unknown_stream", "Unknown local stream session.")
                self.server.ring.stop_stream(handle)
                return self._headers(204, "application/json", 0)
            if path.startswith("/api/"):
                raise APIError(404, "not_found", "Unsupported API route or method.")
            if self.command in ("GET", "HEAD"):
                return self._static(path)
            raise APIError(405, "method_not_allowed", "Unsupported HTTP method.")
        except APIError as exc:
            error = {"code": exc.code, "message": exc.message}
            if exc.upstream_status is not None:
                error["upstream_status"] = exc.upstream_status
            self._json(exc.status, {"error": error})
        except (BrokenPipeError, ConnectionResetError, socket.timeout):
            pass
        except Exception:
            self._json(500, {"error": {"code": "internal_error", "message": "The local request could not be completed."}})

    do_GET = do_POST = do_DELETE = do_HEAD = do_OPTIONS = _dispatch


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--dist", type=Path, default=Path(__file__).resolve().parent / "dist")
    args = parser.parse_args()
    try:
        ring = RingClient(os.environ.get("RING_ACCESS_TOKEN", ""))
        server = LocalServer(("127.0.0.1", args.port), args.dist, ring)
    except APIError:
        parser.exit(2, "RING_ACCESS_TOKEN is invalid; set a valid token or leave it unset.\n")
    print(f"ClearPath: http://127.0.0.1:{server.server_port} (local only)", flush=True)
    if not (args.dist / "index.html").is_file():
        print("Frontend build missing. Build the web app to create dist/index.html.", flush=True)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        ring.clear_token()
        server.server_close()


if __name__ == "__main__":
    main()
