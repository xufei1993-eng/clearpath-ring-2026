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

Narration text, title cards, interface graphics and subtitle graphics are original ClearPath production material. The creator explicitly authorized using their own reference recording for locally synthesized narration. The final voice is synthesized from that reference; it is not a claim that the creator originally recorded the English sentences.

The local reference-voice production path uses [Qwen3-TTS Base](https://huggingface.co/Qwen/Qwen3-TTS-12Hz-0.6B-Base) (Apache License 2.0), its [MLX-community 4-bit conversion](https://huggingface.co/mlx-community/Qwen3-TTS-12Hz-0.6B-Base-4bit), and [MLX-Audio](https://github.com/Blaizzy/mlx-audio/blob/main/LICENSE) (MIT). Reference transcription uses locally run Whisper, whose [code and model weights are MIT licensed](https://github.com/openai/whisper/blob/main/LICENSE). These optional production tools are separate from the application's visual-change processing.

Original reference recordings, transcripts, voice representations, generated audio segments, downloaded model weights and dependency binaries are excluded from the source release. No third-party music is included.
