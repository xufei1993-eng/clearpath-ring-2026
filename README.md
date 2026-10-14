# ClearPath

**Notice a possible doorway obstruction. Review it. Check again.**

ClearPath helps a resident review visual changes in an area they want to keep empty. It connects to the official Ring Developer Playground, retains the analyzed frame, lets a person confirm or dismiss an observation, and requires later evidence for a recheck.

This is a working local prototype. Actual Ring video has reached the app and the same local comparison workflow. One self-recorded development sequence completed obstruction → human confirmation → later cleared recheck using an explicitly smaller region. Original failures remain documented; this is not unseen accuracy evidence or a safety assessment.

## Run the basic app

From this repository's root, with Python 3.10+ and a modern browser:

```sh
python3 server.py
```

Open [the English app](http://127.0.0.1:8765/?lang=en). There is no build step, database or third-party Python dependency for the basic browser comparison or Ring adapter. Stop the server with Ctrl+C. If port 8765 is occupied, use `python3 server.py --port 8766` and the corresponding localhost address.

## Try the complete flow without an account

1. Click **Try the complete flow**. The app saves a code-drawn empty reference and shows a possible obstruction.
2. Click **Confirm obstruction**.
3. Select **Empty path**, then click **Recheck a later frame**.
4. Inspect the captured evidence and activity record; optionally export the record.

These scenes are prominently labeled **Synthetic sample · Not Ring footage**. They demonstrate interaction and state handling, not live Ring connectivity or real-world performance. No private video download is required to run the app or tests.

## Optional same-computer vision enhancement

This path was tested with Python 3.12. It helps some camera/global-change comparisons, but can reject unsupported input. From the repository root:

```sh
python3.12 -m venv .venv-vision
.venv-vision/bin/python -m pip install -r requirements-vision.txt
.venv-vision/bin/python server.py
```

On Windows, use `.venv-vision\Scripts\python` in place of `.venv-vision/bin/python`. Package installation needs internet access. `requirements-vision.txt` pins the tested free OpenCV and NumPy packages; no model download, paid API or cloud vision service is used.

Basic comparison runs in the browser. Optional registration sends two reduced frames only to the same computer's loopback server, which does not save them. Its accepted output returns to the browser for comparison. It validates independent matches, spatial support and the complete sampling neighborhood; rejection preserves uncertainty.

## Real Ring input

Follow [Ring setup](docs/ring-setup.en.md). You need your own free Amazon Developer/Playground access and a short-lived token. No hardware purchase or private reusable token is included. The app actually calls official device and WHEP endpoints; it does not replace a failed connection with synthetic footage.

The [recorded 14 October 2026 English-session reconnection](docs/ring-validation_2026-10-14.en.md) received moving official simulator video, compared an empty step region from that same stream, and disconnected with the local token removed. This proves the input chain; it does not prove package removal or a physical Ring-device deployment. The separate self-recorded sequence in the demonstration proves the observed development handling loop.

## Presentation and recording

Open [English presentation mode](http://127.0.0.1:8765/?lang=en&presentation=1). It hides credential controls, device names and original filenames while preserving source labels, actual results and capture time. Local recording tools capture actual app output. They do not invent a connection or detection, and do not automatically remove private details inside footage. Changing language starts a fresh page session.

## Verification and limits

The recorded complete engineering run passed **109 JavaScript + 49 Python = 158 tests**, none skipped. See [testing](docs/testing.en.md) for commands, expected checks and the separate evidence scopes.

Only one reused phone development scene succeeded with a newly reduced region. The first clip and the second clip's original region failed; the original region remains rejected for clipped support. At least ten independent unseen scenes and 90% on each target rate are our own pending quality target, not a contest requirement.

ClearPath compares visual changes. It does not identify people, classify every package, measure usable width, guarantee safe passage, unlock a door or send messages to others. Existing equipment, connectivity and developer time are required even though the prototype adds no paid-service requirement.

## Documentation

- [Architecture and data flow](docs/architecture.en.md)
- [Testing and evidence boundaries](docs/testing.en.md)
- [Ring setup and troubleshooting](docs/ring-setup.en.md)
- [Actual English Ring integration record](docs/ring-validation_2026-10-14.en.md)
- [Project description](docs/submission-final.md)
- [Product feedback and actual friction](docs/product-feedback.md)
- [Submission readiness](docs/contest-readiness.md)

MIT licensed; see `LICENSE`. No private source footage, extracted phone frames, credentials or virtual environment is included in the competition source package.
