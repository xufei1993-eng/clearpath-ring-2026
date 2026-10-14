# Testing and evidence

Engineering tests, live integration, synthetic rehearsal and private development video have different purposes. They are reported separately.

## Reproduce the engineering suite

Use Node 22 and the Python 3.12 environment described in the root README:

```sh
node --test tests/*.test.mjs
.venv-vision/bin/python -m unittest discover -s tests -p 'test_*.py'
```

On Windows, replace the Python executable with `.venv-vision\Scripts\python`. The complete recorded run is **109/109 JavaScript and 49/49 Python: 158 passed, none skipped**.

| Tests | Count | Scope |
|---|---:|---|
| Browser vision | 39 | Synthetic pixels, overlap, quality guards and constrained compensation. |
| Freshness | 6 | Old/repeated frames and cross-source/session rechecks. |
| Ring lifecycle | 8 | Cancellation, late replies and stream cleanup. |
| Metrics | 13 | Strict denominators, first results and unseen-scene accounting. |
| Media evaluation | 11 | Three-frame extraction and media error handling. |
| Local enhancement helper | 18 | Contract validation, mapping and static-page request boundaries. |
| Recording | 14 | Actual-output export lifecycle and failure handling. |
| Python Ring/local HTTP | 21 | Real loopback HTTP with an in-memory upstream double. |
| Python vision HTTP | 7 | Body/schema limits, dependency errors and single-request handling. |
| Python registration | 21 | Independent texture controls, occlusion, repeated/two-plane negatives, crop/support visibility and chromatic suppression. |

The HTTP tests do not call a real Ring account or paid service. Python tests require permission to bind loopback ports. Without optional OpenCV/NumPy, capability tests can be skipped; that partial run is not the complete 158-test result. Tests do not require the private phone clips, their frames or a secret token.

## Manual workflow check

Start the app and open `/?lang=en`. Click **Try the complete flow**, confirm the possible obstruction, switch to **Empty path**, and recheck. Inspect the evidence/source label and export if desired. This is **synthetic workflow evidence**, not footage or Ring validation.

Local videos can be reviewed through **Local footage**: save a confirmed empty reference, use the timeline to move to an occupied view, inspect and confirm, then move forward to a later cleared view and recheck. A backward seek must not resolve the observation. Judges can supply their own consenting footage; the app has no private-video download requirement.

## Observed live Ring integration

The 13 October 2026 run received an official Playground device, a WHEP 201 response and decoded 1280×720 video; a frame from that stream entered the comparison workflow. On 14 October the English app reconnected, displayed moving simulator footage, saved and compared an empty step region from the same stream, then disconnected and removed the local token. The [English integration record and screenshot](ring-validation_2026-10-14.en.md) show this actual path, separate from the demonstration film.

This is simulator integration, not physical-camera, delivery-webhook or production OAuth validation. The Package sample already contains a parcel. The integration check selected an empty upper step area; its clear result proves a functioning comparison path, not successful package-removal detection. Follow [Ring setup](ring-setup.en.md) to repeat with your own free Playground access.

## Development-video result and failures

Two phone clips were used for development, so neither is independent unseen data. The first exposed camera-motion false detection and unsuccessful rechecks. The second first failed its original marked region; that original region still fails the final complete-support visibility check.

A separately recorded, smaller development ROI left framing margin. On that same second clip, final local SIFT v3 returned an occupied result and a cleared result at the preselected times. The main page also completed the real interaction: 2-second empty reference → 12-second obstruction → human confirmation → 20-second cleared recheck.

This is **one reused development case with a reduced region**. It does not establish original-region success, unseen accuracy or general hand-held-camera support. First failures and subsequent attempts were retained locally rather than overwritten. The public source package excludes private media and detailed private case exports.

The final two development comparisons had a median **393.5 ms**, including local registration and excluding extraction, decoding, network and human action. This is neither an end-to-end alert time nor a broad performance benchmark.

## Pending quality evaluation

At least ten independent unseen scenes and at least 90% on each target rate are internal evaluation targets, not contest requirements. They remain unmet. Uncertain, failed and missing registered results receive no correctness credit. Reused development footage and adjacent frames cannot supply ten independent scenes.

No evaluation currently proves physical usable width, safe passage, cross-home generalization or benefit to intended users. The prototype provides reviewable visual-change evidence and keeps a person in control.
