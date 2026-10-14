# ClearPath — final submission copy

Prepared 14 October 2026. The project description below is ready for editorial use. The public MIT repository is verified; final submission and a public video link remain pending. See [readiness](contest-readiness.md) for the official-requirements audit and [product feedback](product-feedback.md) for the separate feedback answer.

## Project name

ClearPath

## Tagline

Notice a possible doorway obstruction. Review it. Check again.

## Primary track

Ring — accessibility and caretaking.

## Mini-challenges

None currently claimed. No AWS service or Kiro Crew integration is documented in this project. Its existing MIT license alone is not evidence of the additional Open Source mini-challenge contribution.

## Inspiration

A delivery left near a doorway can occupy space a resident wants to keep empty. A camera notification can show that something happened, but it does not necessarily help someone decide what needs attention or whether the situation has changed afterward.

We built ClearPath around that follow-up: notice a possible obstruction, inspect the evidence, make a human decision, and check a later view after the object is moved. People using a wheelchair, walker or stroller are a motivating use case. We have not yet validated that benefit with an intended-user study.

## What it does

The resident marks the area they want to keep empty and saves a reference they have confirmed is clear. ClearPath compares a later frame with that reference and highlights a possible new change inside the chosen area.

The evidence remains attached to the observation. The resident can confirm or dismiss it; confirmation alone does not complete the follow-up. A recheck needs later evidence, and the application prevents old or repeated video frames from resolving the observation. If the view cannot support a reliable comparison, it retains an uncertain result and asks for review or recalibration.

The app accepts video from the official Ring Developer Playground and separately labeled local footage. It does not unlock doors, identify people or automatically contact anyone.

## How we built it

The interface uses HTML, CSS and JavaScript modules. Canvas performs the basic reference comparison, brightness handling, changed-region grouping and polygon overlap. A small Python backend calls the official Ring REST endpoints, proxies WHEP signaling and closes sessions. Browser WebRTC receives video only and supplies decoded frames to the local workflow.

We exercised that actual Ring path: authenticated device discovery, a 201 WHEP response, 1280×720 decoding and comparison of a frame from the received Playground stream. This is official simulator input, rather than a physical Ring camera or production integration. The simulator comparison used an already-empty upper step area; it is evidence of integration, not a package-removal result.

For difficult camera/global-change cases, an optional same-machine Python path uses OpenCV SIFT. Matches must pass bidirectional uniqueness filtering, disjoint training and held-out validation, spatial support and geometry checks. The whole selected area and its processing neighborhood must remain visible. The backend returns lossless frames at a fixed analysis size; the browser continues the comparison. Rejecting registration preserves uncertainty.

Basic comparison stays in the browser. Optional registration sends two reduced frames only to the loopback service on the same computer, without saving them or calling a cloud vision API. Playground credentials stay in process memory. The project needs no new camera, paid model or cloud backend for this prototype.

## Challenges

Camera movement can resemble a new object. Our first phone development clip produced a broad false box and unsuccessful rechecks. The second clip also failed its first configuration. We kept those results and intermediate attempts.

Standard matching found usable floor texture in the second clip, but its original selected region moved partly outside the later image. The final system still rejects that original region. A separately registered, smaller development region left enough framing margin and allowed the demonstrated loop to complete.

We also had to protect frame freshness and preserve visual evidence through image processing. Independent counterexamples caught repetitive texture, competing planes, cropped sampling support and local color changes that smoothing could hide. Those checks now reject unsupported comparisons rather than silently returning a reassuring result.

## What we can demonstrate

ClearPath has a documented real Ring Playground input chain and one successful self-recorded development sequence: a 2-second empty reference, a 12-second occupied view, a confirmation action in the review interface and a 20-second cleared recheck. The latter uses the explicitly smaller development region and is separate from Ring simulator footage.

The recorded engineering run passed 158 tests: 109 JavaScript and 49 Python, with none skipped. The final two development comparisons had a 393.5 ms median local processing time, including registration and excluding frame extraction, decoding and human action. This is not an end-to-end alert-latency measurement.

These are development results, not unseen accuracy evidence. Only one reused development scene completed the real-footage handling loop; the first clip, original-region failures and earlier attempts remain documented.

## What is next

We plan to evaluate a frozen version on independent new scenes and collect feedback from consenting intended users. At least ten unseen scenes and 90% on each target rate are our own pending quality target, not a contest requirement or a result already achieved.

ClearPath detects visual change rather than classifying every package. It does not measure usable width or certify safe passage. Broader lighting, camera, doorway and user evaluation remains ahead.

## Built with

Ring Developer Playground and Ring REST APIs; WebRTC/WHEP; JavaScript modules; HTML/CSS; Canvas; Python; OpenCV SIFT; NumPy.

## Testing instructions

Follow the English [README](../README.md). The basic path needs Python 3.10+ and a modern browser. The optional enhancement has documented Python 3.12 virtual-environment setup with pinned free dependencies. Node 22 is used for the engineering tests and is not required to run the app.

Start the local server and open `http://127.0.0.1:8765/?lang=en`. Synthetic rehearsal is labeled and does not count as Ring or real-world evidence. To exercise live Ring input, use a short-lived token generated through your own official Playground access; no reusable private token is distributed. The batch evaluation page is available at `/evaluate.html`; the main English page is the recommended judging path.

The English setup and [testing summary](testing.en.md) explain the available checks and limitations. The owner-only static preview does not provide the local Ring adapter or SIFT service and should not be the sole judging route.

## Submission links

- **GitHub repository:** [xufei1993-eng/clearpath-ring-2026](https://github.com/xufei1993-eng/clearpath-ring-2026), verified PUBLIC and MIT licensed on 14 October 2026.
- **Public YouTube or Vimeo demo:** the 2:36 English MP4 with narration and captions is prepared locally. The entrant must upload it and paste a verified publicly visible link here.
- **Product feedback:** use [the prepared feedback answer](product-feedback.md).

The repository link is verified. Replace the video placeholder only after the entrant uploads the final export and verifies its public link.
