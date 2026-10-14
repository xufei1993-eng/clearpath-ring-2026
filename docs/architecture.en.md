# Architecture

ClearPath runs as a single-user localhost application. The submitted source contains the application, tests, dependency pins and English instructions; private development footage is not a runtime dependency.

## Data flow

```text
Official Ring Playground
  -> Python: authenticated devices/history REST + WHEP signaling
  -> Browser: video-only WebRTC -> decoded frame -> Canvas

Synthetic scenes / camera / user-selected local media
  -> Browser: Canvas frame

Human-confirmed empty reference + current frame + selected polygon
  -> Browser comparison
  -> If eligible and local enhancement is available:
       same-computer Python SIFT registration -> fixed-size lossless pair
       -> Browser comparison
  -> Captured evidence + possible change / clear / uncertain
  -> Human confirms or dismisses
  -> Later evidence required for recheck
```

## Main components

| Component | Responsibility |
|---|---|
| `server.py` | Serves `dist/`, enforces localhost/same-origin access, proxies official Ring signaling and handles optional vision requests. |
| `dist/app.mjs` | Input selection, calibration, captured evidence, human decisions and recheck lifecycle. |
| `dist/vision.mjs` | Reference comparison, brightness handling, changed regions, polygon overlap and quality guards. |
| `dist/ring.mjs` | Video-only WebRTC, complete ICE gathering, WHEP negotiation, cancellation and teardown. |
| `dist/local-registration.mjs` | Optional local enhancement contract, output validation, coordinate mapping and failure handling. |
| `registration.py` | Lazy optional OpenCV/NumPy loading, SIFT matching, geometric validation and fixed analysis output. |
| `dist/freshness.mjs` | Prevents old, repeated or cross-session evidence from resolving an observation. |
| `dist/i18n.mjs`, `dist/recording.mjs` | English page session and local presentation export. |

## Optional registration contract

Registration accepts same-size JPEG/PNG data URIs and a normalized convex ROI; it does not fetch file paths or arbitrary URLs. The protocol fixes bidirectional matching, physical-point uniqueness, disjoint training/held-out descriptor support, spatial coverage and bounded homography checks. A change-sensitive fraction of all reference features is diagnostic only, because an obstacle can hide reference texture.

The entire ROI and its filtering/resampling support must remain visible in the original current image. The backend performs the common filter and deterministic `INTER_AREA` reduction to 240-wide lossless PNGs. It preserves real current pixels in the downstream ROI neighborhood and fills reference only beyond that support. The browser consumes these pixels without another resize. `coordinateSize` describes input dimensions; the reference-to-current matrix stays in those input coordinates.

The matrix applies to the validated ROI plane. It is not evidence that a door, wall and floor share one plane. Insufficient texture, competing matches, clipped support, excessive motion or suppressed chromatic evidence keep the result uncertain.

## Privacy and state

Reference frames, observations and evidence stay in page memory until an explicit local export; reload clears that page state. Optional registration sends only two reduced frames to loopback and does not save them. No private footage is sent to a cloud image-processing service.

Ring tokens remain in local server process memory, not source files or logs. The browser receives an opaque local session handle; the backend restricts upstream access to the documented official origin and expected resource. Disconnect removes the local token and closes known sessions. Ring's own video transport is a real external service; “local processing” does not mean Ring media originates offline.

Human confirmation records a decision rather than proving a physical change. Resolution requires a later comparison. This application does not automate a physical response or contact another person.
