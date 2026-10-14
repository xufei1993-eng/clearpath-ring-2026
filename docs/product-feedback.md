# ClearPath — product feedback and friction log

Prepared 14 October 2026 for the Ring track. These observations come from this project's recorded local implementation and integration work. They are not reports of a global outage or a survey of other developers. See the [English Ring integration record](ring-validation_2026-10-14.en.md), [engineering/local-video testing summary](testing.en.md), and [reproducible Ring setup](ring-setup.en.md).

## Ring Developer Playground and Ring APIs

**Used for:** discovering the official Playground device, reading event history, creating a WHEP live-video session, receiving video in the browser, and closing the session. This is direct REST/WHEP use through our local Python adapter, rather than an unofficial consumer Ring library.

**What worked well:** Playground let us exercise a real authenticated Ring path without buying a camera or subscription. We received an actual 201 WHEP answer and decoded the resulting 1280×720 stream inside our application. The ability to keep the rest of the product local made it practical to inspect every step from device discovery to a frame comparison.

**What needs work:** the complete path involves separate credential, HTTPS, ICE, SDP, session-lifetime and first-frame states. A successful device request does not prove a playable stream. Examples that show complete successful responses, including session routing details, would reduce unnecessary debugging. We would also value a consolidated network troubleshooting checklist that distinguishes candidate gathering, negotiation and first-frame delivery.

**Onboarding:** we progressed from a user-generated short-lived Playground token to device discovery, then WHEP and browser decoding. Our first run required the compatibility fixes below. We have recorded successful input and local processing, but have not tested a physical Ring device, production account linking, delivery webhooks or a production app deployment.

**Would we use it again?** Yes. The official simulator provides a useful starting point for an accessibility-oriented camera application. We would keep simulator footage clearly labeled and validate a production device path separately before making deployment claims.

## Reproducible friction observations

### 1. Python HTTPS trust configuration blocked the initial device request

- **Task and steps:** call the official devices endpoint from the local Python adapter; compare an unauthenticated system `curl` request to the same endpoint.
- **Expected:** a verified HTTPS connection, followed by the appropriate API response.
- **Observed:** Python raised `SSLCertVerificationError`; system `curl` reached the endpoint and received 401. This isolated a local Python trust-store problem rather than proving Ring was unreachable.
- **Severity:** blocked our initial local integration.
- **Workaround:** use the existing macOS system CA bundle only when Python has no default CA file/directory and no explicit `SSL_CERT_FILE`/`SSL_CERT_DIR`. Certificate and hostname verification remain enabled.
- **Suggestion:** add a short Python trust-store preflight and a diagnostic example that distinguishes TLS failure from an authenticated API error.
- **Ownership:** local Python environment compatibility; not a claim that Ring's certificate was invalid.

### 2. Our initial ICE wait was too short on the tested network

- **Task and steps:** gather ICE candidates before posting the WHEP offer; try the initial Google STUN configuration and inspect whether candidate gathering completes.
- **Expected:** complete candidate gathering before submitting the offer.
- **Observed:** the initial 12-second limit ended too early. The later verified run used a 45-second limit and completed local candidate gathering with `iceServers: []` on this network, after which the Ring stream arrived.
- **Severity:** blocked video startup during development.
- **Workaround:** wait for the actual completion state and support configurable ICE servers. Empty ICE servers are the observed working configuration here, not a recommendation for every network.
- **Suggestion:** document the gathering and connectivity phases separately, with NAT/STUN/TURN troubleshooting guidance and a complete non-trickle WHEP example.
- **Ownership:** our timeout/configuration and local network behavior; no universal Ring connectivity claim.

### 3. A valid WHEP session routing query exposed an overly strict local proxy

- **Task and steps:** create an official session, validate its returned `Location`, and preserve the information required to close it.
- **Expected:** accept the official session resource while preventing arbitrary upstream requests.
- **Observed:** the actual 201 response included a same-origin `location` query parameter. Our first proxy rejected every query, including this valid one.
- **Severity:** blocked correct session handling in our implementation.
- **Workaround:** allow only the same official HTTPS origin, the expected device session path and one non-empty `location` parameter. Keep that upstream location behind a local random handle; do not expose it or forward credentials to other hosts.
- **Suggestion:** show a full representative `Location`, including a routing query when present, beside the create/delete session examples.
- **Ownership:** an application compatibility bug revealed by a valid server response, not a Ring service failure.

## OpenCV SIFT and NumPy

**Used for:** optional same-machine feature matching, homography estimation, image warping, visibility checks and deterministic reduction to the browser's analysis size. NumPy supplies image arrays and numerical validation.

**What worked well:** standard high-resolution SIFT matching found useful floor correspondences where our initial low-resolution patch matcher had too little independent support. This gave us a practical local path without an image-processing cloud service. The optional dependency boundary also lets basic browser comparison run when SIFT is unavailable.

**What needs work in our application:** reliable integration required more than a matrix. We added disjoint training and held-out source regions, descriptor-footprint separation, spatial support checks, bounded geometry, and complete sampling support through warp, filtering and resize. Synthetic controls also exposed local chromatic changes that filtering could otherwise conceal. These were application-design issues we corrected, not defects attributed to OpenCV or NumPy.

**Onboarding:** neither initial Python environment had `cv2`. We verified the dependency absence and installed the free packages in an isolated temporary research directory before the project moved to its documented virtual-environment setup. The first sandboxed PyPI attempt failed DNS resolution; the approved download then succeeded. The shipped instructions use a separate Python 3.12 environment and pinned dependencies; no automatic global installation or cloud fallback occurs.

**Would we use them again?** Yes. They make the processing reproducible and inspectable. We would retain the optional installation, explicit protocol version and independent negative controls. No separate NumPy defect was observed in this build, and one successful development video does not establish general SIFT robustness.

## Browser Canvas, WebRTC and the Python standard library

**Used for:** the interface, decoded-frame capture, basic visual comparison, video-only transport, localhost HTTP and the official Ring adapter.

**What worked well:** a no-build browser interface and a small Python server kept the basic setup simple. The same review workflow could receive official simulator video and separately labeled local footage. We could export the analyzed frame, source, media time and decision history for inspection.

**Recorded application friction:** hidden-video drawing initially failed to populate the Canvas with the first decoded frame; the browser regression record documents the correction. Asynchronous media and enhancement operations also needed cancellation and stale-result protection. Captured-frame time now stays distinct from result-log time, and a later result cannot replace a newer source/session. These are our implementation corrections; we are not reporting browser standards violations.

**Would we use this stack again?** Yes. It suits a local prototype with explicit user control. A production version still needs broader network, browser, device and intended-user testing.

## Demonstration production: local reference-voice synthesis

This is a film-production toolchain, separate from ClearPath's runtime visual comparison. The creator explicitly supplied and authorized their own short reference recording. We used Qwen3-TTS Base through MLX-Audio and local Whisper transcription; no reference audio or narration text was sent to a hosted synthesis/transcription service.

The reference-voice path generated the requested English text locally. The initial full script took longer to speak than the existing caption windows, so we shortened narration, rebuilt captions and used only small timing adjustments. This was a production-editing issue, not a claimed defect in Ring. Similarity and naturalness remain subjective; the creator received a playable preview rather than an unsupported claim of a perfect voice match. Original references, transcripts, voice representations and models are excluded from the source release. We would use the local approach again when the speaker has authorized the reference and the output can be reviewed before publication.

## Feature requests and scope

| Priority | Request | Why it matters |
|---|---|---|
| Important | One Ring walkthrough from Playground token through device discovery, complete ICE, WHEP response, first frame and teardown. | Helps developers diagnose the specific incomplete stage instead of treating every failure as authentication or video failure. |
| Important | Representative WHEP response examples with permitted session routing details. | Avoids repeating our strict-proxy compatibility mistake while preserving secure origin/path validation. |
| Nice-to-have | More controlled before/occupied/after simulator scenarios, or an official documented custom-scenario path. | Would help evaluate a doorway handling loop directly through the simulator. This is a request, not a claim that such an upload feature exists. |

No AWS service was provisioned or used by this project, so we provide no AWS runtime feedback or AWS mini-challenge claim. We did not buy hardware, a Ring subscription, cloud hosting or a paid vision API for the local prototype; existing equipment, connectivity and development time were still required.
