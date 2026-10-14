# Ring Playground setup

ClearPath uses official Ring REST APIs and WHEP with standard Python HTTP and browser WebRTC. This is a local development adapter, not a public multi-user OAuth service. Physical Ring hardware and a paid vision API are unnecessary for the Playground route.

## Start locally

From the repository root, run `python3 server.py` with Python 3.10+ or use the optional Python 3.12 environment from the root README. Open:

```text
http://127.0.0.1:8765/?lang=en
```

Optional recording/privacy mode is `/?lang=en&presentation=1`. In that mode, use **Show connection settings temporarily** to enter a token, then hide the settings before recording. Privacy mode hides UI identifiers; review the actual footage separately.

## Connect with your own free account

1. Open the official [Ring Developer Playground](https://developer.amazon.com/ring/console/playground) and use your own Amazon Developer access. Complete any account requirements yourself. No private reusable token is shipped with ClearPath.
2. Generate a short-lived Playground access token, select **Ring Playground** in ClearPath, paste the token and click **Connect**. The tested token lifetime was about 30 minutes; generate another after expiry.
3. Select the returned device and click **Start live view**. A successful devices response is not enough: wait for moving, decodable video in ClearPath.
4. Keep the official source label and watermark. Select a region that is actually empty before **Save empty-path reference**. In the Package sample, do not pretend the existing parcel is absent; the verified integration comparison used the empty upper step area.
5. Click **Check current frame** on a later frame from that same stream. Inspect the captured evidence and result. A clear comparison here is an integration check, not proof of a completed obstruction-handling loop.
6. Click **Disconnect**. ClearPath closes known sessions and removes the token from local server memory. The upstream token also expires according to its own lifetime.

The official sample streams are simulated live views, not user-uploaded phone clips. A phone-video demonstration is selected separately through **Local footage** and labeled accordingly. Playground sample/session behavior does not prove a delivery webhook, sensor or production-device capability.

## Actual runtime hook

`server.py` calls the official `https://api.amazonvision.com` device/history endpoints and creates/deletes WHEP resources. `dist/ring.mjs` gathers ICE candidates, posts the SDP offer through the local adapter, applies the real answer and receives a video-only track. Frames from that track enter Canvas and the ordinary review workflow.

The [recorded 14 October 2026 English-session reconnection](ring-validation_2026-10-14.en.md) displayed moving official video, compared an empty region from the same received stream, and disconnected with the token removed. [Testing](testing.en.md) separates this integration evidence from synthetic and phone-development results.

## Troubleshooting

| Symptom | Check |
|---|---|
| 401 / expired token | Generate a fresh Playground token; reconnect. Do not put it in a URL or log. |
| Device list succeeds but no picture | Read the video/session error. Device discovery, ICE gathering, SDP negotiation and first-frame delivery are separate stages. |
| ICE timeout | The app waits for complete gathering. The verified network used empty ICE servers; other networks may need configured STUN/TURN. Do not invent TURN credentials. |
| Python TLS verification error | Check the Python trust-store setup. The conditional macOS system-bundle fallback preserves certificate and hostname verification; do not disable TLS verification. |
| Live view expires | Explicitly start a new session; the app must not recheck old frozen footage as if it were live. |

Credentials stay in local process memory and are not written to source, logs or localStorage. The adapter accepts only same-origin localhost access, restricts upstream origin/path and uses local opaque session handles. It does not accept arbitrary media-fetch URLs.

References: [official Ring API documentation](https://developer.amazon.com/docs/ring/api-documentation.html), [official Playground](https://developer.amazon.com/ring/console/playground). These are documentation links, not substitute evidence that a particular run succeeded.
