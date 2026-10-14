# Third-party notices and footage credits

ClearPath source is released under the MIT license in the repository root.

## Optional local dependencies

- OpenCV: local SIFT matching, geometry, image decoding and registration. OpenCV 4.5.0 and later use Apache License 2.0. The `opencv-python-headless` distribution contains additional third-party components and its own license notices; install it from PyPI and retain those notices. This repository does not redistribute its binaries. [OpenCV licensing](https://opencv.org/license/).
- NumPy: local image arrays and numerical operations, under the NumPy license (BSD 3-Clause). No NumPy binaries are redistributed here. [NumPy license](https://numpy.org/doc/stable/license.html).
- Pillow: optional local generation of original film cards and subtitle graphics. It is not needed to run ClearPath. [Pillow licensing](https://pillow.readthedocs.io/en/stable/about.html#license).
- FFmpeg: optional locally installed video assembly tool. Its enabled components and license vary by build; it is not redistributed here. [FFmpeg legal](https://ffmpeg.org/legal.html).

The web application uses browser platform APIs without bundled third-party JavaScript libraries.

## Ring Playground sample

The official Package simulation includes footage by frollard, [Thief stealing our package](https://www.youtube.com/watch?v=TfTFu8lGrwk), licensed under [CC BY 4.0](https://creativecommons.org/licenses/by/4.0/). Ring cropped the original sample. ClearPath adds its actual application output, region overlay, status, and local comparison; the submission video edits the captured application output and retains the official watermark. The integration screenshot is a frame from that actual output. The film's end card includes attribution.

Ring and Amazon names identify the integration; this project does not claim endorsement or certification.

## Self-recorded development footage

The project owner provided the development clips. Original files and derivative evaluation evidence are excluded from this source repository. Any final film using that material must be reviewed by the owner before public upload. Source audio and GPS/device metadata are removed from the prepared film.

## Narration and graphics

The film narration is original English text rendered locally with an installed macOS system voice. It is a synthetic narration voice, not a recording or impersonation of a person. Title cards, interface graphics and subtitle graphics are original ClearPath production material. No third-party music is included.
