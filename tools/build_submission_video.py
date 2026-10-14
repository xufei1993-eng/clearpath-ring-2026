#!/usr/bin/env python3
"""Build an English ClearPath contest video using local, original production assets.

Requires ffmpeg/ffprobe, Pillow, and licensed local WAV narration. Run
`prepare --voice-dir ...` first, then `build --ring-clip ... --workflow-clip ...`.
Voice files are <voice-dir>/<chapter-id>/voice-NN.wav, in SECTIONS cue order.
This tool does not synthesize speech or contact a cloud service. Only provide
recordings or generated voices you are authorized to publish. Source audio is never mapped.
All generated work files live in git-ignored evidence/contest-production.
"""
from __future__ import annotations

import argparse
from array import array
import json
import math
import shutil
import subprocess
import wave
from pathlib import Path

from PIL import Image, ImageDraw, ImageFont


ROOT = Path(__file__).resolve().parents[1]
W, H, TOP, BAND, FPS, RATE = 1280, 720, 642, 78, 24, 48000
BG, INK, GREEN, MUTED = '#F0F3ED', '#172A24', '#24594C', '#5B6C62'
SECTIONS = [
    dict(id='problem', title='Room for the next step', seconds=16, kind='card', cues=[
        'Doorway space matters for wheelchairs, walkers, and strollers.',
        'Deliveries change that space.',
        'The app shows changes. You decide.',
    ]),
    dict(id='ring', title='Official Ring input', seconds=29, kind='ring', cueStarts=[0.5, 5.2, 19.0, 23.0], cues=[
        'Connected to Ring Developer Playground.',
        'This simulated device uses the Ring API and real WebRTC video.',
        'Frames are compared locally.',
        'Connection works. Detection accuracy needs testing.',
    ]),
    dict(id='workflow', title='Self-recorded development workflow', seconds=57, kind='workflow', cueStarts=[0.5, 5.0, 12.0, 19.0, 28.0, 36.7, 49.2], cues=[
        'This is our phone recording.',
        'At two seconds, save an empty reference and smaller region.',
        'This smaller region covers less ground. The original still fails.',
        'At twelve seconds, the box triggers a change for review.',
        'Older or repeated frames cannot close this follow-up.',
        'I confirm, then use twenty seconds, after removing the box.',
        'The new comparison clears the follow-up with fresh evidence.',
    ]),
    dict(id='failure', title='Keep the failures visible', seconds=16, kind='card', cues=[
        'First recording: broad false detection.',
        'Second recording: original region rejected.',
        'One reused scene worked with a smaller region. Ten unseen scenes remain.',
    ]),
    dict(id='architecture', title='Local processing, explicit evidence', seconds=23, kind='card', cues=[
        'Basic comparison runs in your browser.',
        'Optional OpenCV alignment stays on this computer.',
        'Hosted pages never send images for processing.',
        'Zero paid services. Tests are not real-world evidence.',
    ]),
    dict(id='closing', title='ClearPath', seconds=15, kind='card', cues=[
        'Flag the change. Require fresh evidence to close it.',
        'ClearPath does not certify safe passage or measure usable width.',
        'More testing comes next.',
    ]),
]


def run(args):
    subprocess.run([str(x) for x in args], check=True, stdout=subprocess.DEVNULL)


def probe(path):
    return json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-show_format', '-show_streams', '-show_chapters', '-of', 'json', str(path)
    ]))


def duration(path):
    details = probe(path)
    if details.get('format', {}).get('duration'):
        return float(details['format']['duration'])
    # MediaRecorder WebM commonly omits container duration; use actual packets.
    packets = json.loads(subprocess.check_output([
        'ffprobe', '-v', 'error', '-select_streams', 'v:0', '-show_packets',
        '-show_entries', 'packet=pts_time,duration_time', '-of', 'json', str(path)
    ]))['packets']
    end = max((float(p.get('pts_time', 0)) + float(p.get('duration_time', 1/FPS)) for p in packets), default=0)
    if end <= 0:
        raise ValueError('The screen recording has no timed video packets.')
    return end


def font(size, bold=False):
    choices = [
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf' if bold else '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Helvetica.ttc',
        '/usr/share/fonts/truetype/dejavu/DejaVuSans-Bold.ttf' if bold else '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
    ]
    for candidate in choices:
        if Path(candidate).exists():
            return ImageFont.truetype(candidate, size)
    raise RuntimeError('No suitable local font was found.')


def wrapped(draw, text, face, width):
    lines, line = [], ''
    for word in text.split():
        trial = f'{line} {word}'.strip()
        if line and draw.textlength(trial, font=face) > width:
            lines.append(line)
            line = word
        else:
            line = trial
    return lines + ([line] if line else [])


def paragraph(draw, text, xy, size=30, color=INK, width=1110, bold=False, gap=8):
    face = font(size, bold)
    x, y = xy
    for line in wrapped(draw, text, face, width):
        draw.text((x, y), line, font=face, fill=color)
        y += size + gap
    return y


def base_card(section):
    image = Image.new('RGB', (W, TOP), BG)
    draw = ImageDraw.Draw(image)
    draw.rounded_rectangle((62, 44, 110, 92), radius=13, fill=GREEN)
    draw.text((77, 49), 'C', font=font(32, True), fill='white')
    draw.text((128, 51), 'ClearPath', font=font(28, True), fill=INK)
    draw.text((62, 130), section['title'], font=font(53, True), fill=INK)
    draw.line((64, 211, 1216, 211), fill='#C9D6CA', width=2)
    return image, draw


def draw_card(section, path):
    image, draw = base_card(section)
    sid = section['id']
    if sid == 'problem':
        paragraph(draw, 'A delivery alert says something arrived.', (64, 254), size=36)
        paragraph(draw, 'What changed in the area you want to keep empty?', (64, 317), size=36, bold=True)
        paragraph(draw, 'Choose a region. Review evidence. Check again after removal.', (64, 451), size=28, color=GREEN)
        paragraph(draw, 'People make the final decision.', (64, 535), size=24, color=MUTED)
    elif sid == 'failure':
        rows = [
            ('Original failures', 'Preserved, including uncertainty and false localization.'),
            ('One development scene', 'A new, smaller region worked. The original region did not.'),
            ('Next gate', 'At least ten independent unseen scenes are still pending.'),
        ]
        for i, (label, body) in enumerate(rows):
            y = 250 + i * 110
            draw.rounded_rectangle((64, y, 1216, y + 90), radius=12, fill='white')
            paragraph(draw, label, (85, y + 13), size=27, bold=True, width=330)
            paragraph(draw, body, (430, y + 19), size=25, width=745)
    elif sid == 'architecture':
        boxes = [(64, 256, 416, 416), (464, 256, 816, 416), (864, 256, 1216, 416)]
        labels = [
            ('Browser', 'Reference comparison\nHuman review'),
            ('Same computer', 'Optional OpenCV SIFT\nReduced frame pairs'),
            ('Evidence', 'Source + captured time\nFresh-frame recheck'),
        ]
        for box, (heading, body) in zip(boxes, labels):
            draw.rounded_rectangle(box, radius=14, fill='white', outline='#BDCEC2', width=2)
            paragraph(draw, heading, (box[0] + 22, 278), size=28, color=GREEN, bold=True, width=310)
            for j, line in enumerate(body.split('\n')):
                paragraph(draw, line, (box[0] + 22, 336 + 30 * j), size=22, width=310)
        for x in (426, 826):
            draw.line((x, 336, x + 28, 336), fill=GREEN, width=3)
            draw.polygon([(x + 28, 336), (x + 18, 330), (x + 18, 342)], fill=GREEN)
        paragraph(draw, 'Self-recorded images never go to a cloud processing service.', (64, 461), size=28, bold=True)
        paragraph(draw, 'Official Ring input is a separate source. Hosted preview uses browser processing.', (64, 517), size=24, color=MUTED)
    elif sid == 'closing':
        paragraph(draw, 'Review the change. Verify the follow-up.', (64, 247), size=36, bold=True)
        paragraph(draw, 'A prototype ready for broader testing, not a safety certification.', (64, 307), size=25, color=GREEN)
        paragraph(draw, 'Ring simulator media credit', (64, 381), size=26, bold=True)
        credits = [
            'frollard — “Thief stealing our package”',
            'https://www.youtube.com/watch?v=TfTFu8lGrwk',
            'CC BY 4.0 — https://creativecommons.org/licenses/by/4.0/',
            'Official Ring crop; ClearPath interface and region overlays added.',
            'Phone sequence: self-recorded development material. Original narration and cards.',
        ]
        for i, line in enumerate(credits):
            paragraph(draw, line, (64, 426 + i * 32), size=21, color=MUTED, width=1152)
    image.save(path)


def subtitle_image(text, path):
    image = Image.new('RGB', (W, BAND), '#14251F')
    draw = ImageDraw.Draw(image)
    face = font(27)
    lines = wrapped(draw, text, face, W - 100) if text else []
    if len(lines) > 2:
        raise ValueError(f'Subtitle exceeds two lines: {text}')
    top = (BAND - len(lines) * 31) // 2 - 2
    for i, line in enumerate(lines):
        width = draw.textlength(line, font=face)
        draw.text(((W - width) / 2, top + i * 31), line, font=face, fill='white')
    image.save(path)


def concat_quote(path):
    return str(path.resolve()).replace("'", "'\\''")


def prepare(assets, voice_dir=None):
    if voice_dir is None:
        raise ValueError('Provide --voice-dir containing authorized local WAV narration.')
    inputs = [voice_dir / section['id'] / f'voice-{index:02d}.wav'
              for section in SECTIONS for index, _ in enumerate(section['cues'])]
    if any(not path.is_file() for path in inputs):
        raise ValueError('Every chapter cue needs a WAV file in --voice-dir before preparation.')
    assets.mkdir(parents=True, exist_ok=True)
    manifest = []
    for source in SECTIONS:
        section = dict(source)
        directory = assets / section['id']
        directory.mkdir(exist_ok=True)
        audio_parts, cues, cursor = [], [], 0.45
        for index, text in enumerate(section['cues']):
            stem = directory / f'voice-{index:02d}'
            stem.with_suffix('.txt').write_text(text + '\n', encoding='utf-8')
            source_audio = voice_dir / section['id'] / f'voice-{index:02d}.wav'
            destination = stem.with_suffix('.wav')
            if source_audio.resolve() == destination.resolve():
                raise ValueError('Keep supplied voice WAVs separate from generated production assets.')
            run(['ffmpeg', '-v', 'error', '-y', '-i', source_audio, '-map', '0:a:0',
                 '-map_metadata', '-1', '-map_chapters', '-1', '-ar', RATE, '-ac', '1',
                 '-c:a', 'pcm_s16le', destination])
            with wave.open(str(stem.with_suffix('.wav')), 'rb') as audio:
                pcm = audio.readframes(audio.getnframes())
            seconds = len(pcm) / (RATE * 2)
            samples = array('h', pcm)
            peak = max((abs(value) for value in samples), default=0)
            rms = math.sqrt(sum(value * value for value in samples) / max(1, len(samples)))
            if seconds < 0.2 or peak < 100 or rms < 10:
                raise RuntimeError('The provided narration is empty or silent; replace it before building.')
            start = float(section['cueStarts'][index]) if section.get('cueStarts') else cursor
            audio_parts.append((start, pcm))
            cues.append(dict(start=start, end=start + seconds, text=text))
            cursor = max(cursor, start + seconds + 0.16)
        cues.sort(key=lambda cue: cue['start'])
        audio_parts.sort(key=lambda part: part[0])
        if any(cues[i]['end'] > cues[i+1]['start'] for i in range(len(cues)-1)):
            raise ValueError('Narration cues overlap; adjust chapter cue starts.')
        seconds = float(section['seconds'])
        if cues[-1]['end'] > seconds - 0.45:
            raise ValueError('Narration exceeds the fixed chapter window; shorten the supplied wording or audio.')
        section.update(seconds=seconds, cues=cues, audio=str(directory / 'narration.wav'))
        with wave.open(section['audio'], 'wb') as out:
            out.setparams((1, 2, RATE, 0, 'NONE', 'not compressed'))
            for start, pcm in audio_parts:
                out.writeframes(bytes(max(0, round(start * RATE) - out.getnframes()) * 2))
                out.writeframes(pcm)
            remaining = max(0, round(seconds * RATE) - out.getnframes())
            out.writeframes(bytes(remaining * 2))
        if section['kind'] == 'card':
            section['card'] = str(directory / 'card.png')
            draw_card(section, Path(section['card']))
        blank = directory / 'subtitle-blank.png'
        subtitle_image('', blank)
        timeline, last = [], 0.0
        for index, cue in enumerate(cues):
            if cue['start'] > last:
                timeline.append((blank, cue['start'] - last))
            png = directory / f'subtitle-{index:02d}.png'
            subtitle_image(cue['text'], png)
            timeline.append((png, cue['end'] - cue['start']))
            last = cue['end']
        if seconds > last:
            timeline.append((blank, seconds - last))
        concat = directory / 'subtitles.ffconcat'
        concat.write_text('ffconcat version 1.0\n' + ''.join(
            f"file '{concat_quote(png)}'\nduration {span:.6f}\n" for png, span in timeline
        ) + f"file '{concat_quote(blank)}'\n", encoding='utf-8')
        section['captions'] = str(directory / 'subtitles.mp4')
        run(['ffmpeg', '-v', 'error', '-y', '-safe', '0', '-i', concat, '-t', f'{seconds:.6f}', '-vf', f'fps={FPS}:start_time=0,tpad=stop_mode=clone:stop_duration=2',
             '-an', '-map_metadata', '-1', '-map_chapters', '-1', '-c:v', 'libx264', '-preset', 'fast', '-crf', '17', '-pix_fmt', 'yuv420p', section['captions']])
        manifest.append(section)
    total = sum(x['seconds'] for x in manifest)
    if total >= 180:
        raise RuntimeError(f'Narration is too long: {total:.2f}s. Shorten the source cues.')
    result = dict(width=W, height=H, fps=FPS, duration=total, voice='Authorized local WAV narration', sections=manifest)
    (assets / 'production-manifest.json').write_text(json.dumps(result, indent=2, ensure_ascii=False) + '\n', encoding='utf-8')
    (assets / 'narration-en.txt').write_text('\n\n'.join(x['title'] + '\n' + '\n'.join(c['text'] for c in x['cues']) for x in manifest) + '\n', encoding='utf-8')
    print(json.dumps(dict(prepared=True, duration=round(total, 3), chapterDurations={x['id']:round(x['seconds'], 3) for x in manifest})))
    return result


def timestamp(seconds):
    total = round(seconds * 1000)
    return f'{total // 3600000:02d}:{total // 60000 % 60:02d}:{total // 1000 % 60:02d},{total % 1000:03d}'


def build(args, assets):
    manifest_file = assets / 'production-manifest.json'
    production = json.loads(manifest_file.read_text(encoding='utf-8')) if manifest_file.exists() else prepare(assets, args.voice_dir)
    output = args.output_dir
    output.mkdir(parents=True, exist_ok=True)
    chunks, subtitles, offset = [], [], 0.0
    for section in production['sections']:
        target = section['seconds']
        command = ['ffmpeg', '-v', 'error', '-y']
        if section['kind'] == 'card':
            command += ['-loop', '1', '-framerate', str(FPS), '-i', section['card']]
            speed = 1.0
        else:
            path = getattr(args, section['kind'] + '_clip')
            if path is None or not path.is_file():
                raise ValueError(f'Provide the actual new {section["kind"]} screen recording.')
            start = getattr(args, section['kind'] + '_start')
            end = getattr(args, section['kind'] + '_end')
            available = (end if end is not None else duration(path)) - start
            if available <= 0:
                raise ValueError('Clip window must be positive.')
            speed = available / target
            command += ['-ss', str(start)]
            if end is not None:
                command += ['-t', str(available)]
            command += ['-i', str(path)]
        command += ['-i', section['audio'], '-i', section['captions']]
        if section['kind'] == 'card':
            video = f'[0:v]setpts=PTS-STARTPTS,scale={W}:{TOP},setsar=1,fps={FPS},pad={W}:{H}:0:0:color=0x14251F[v];[v][2:v]overlay=0:{TOP}:shortest=1[out]'
        else:
            label = assets / section['id'] / 'recording-label.png'
            image = Image.new('RGB', (W, 32), '#DDE7DD')
            draw = ImageDraw.Draw(image)
            source_label = 'Official Ring Playground recorded demonstration' if section['kind'] == 'ring' else 'Self-recorded development case; smaller region'
            draw.text((24, 5), f'{source_label}  |  {speed:.2f}x playback', font=font(18), fill=INK)
            image.save(label)
            command += ['-loop', '1', '-framerate', str(FPS), '-i', label]
            fit = TOP - 32
            video = f'[0:v]setpts=(PTS-STARTPTS)/{speed:.9f},scale={W}:{fit}:force_original_aspect_ratio=decrease,pad={W}:{TOP}:(ow-iw)/2:({fit}-ih)/2:color=0xF0F3ED,setsar=1,fps={FPS},pad={W}:{H}:0:0:color=0x14251F[v0];[v0][3:v]overlay=0:{fit}[v];[v][2:v]overlay=0:{TOP}:shortest=1[out]'
        chunk = assets / section['id'] / 'chapter.mp4'
        command += ['-filter_complex', video, '-map', '[out]', '-map', '1:a:0', '-t', str(target),
                    '-map_metadata', '-1', '-map_chapters', '-1', '-c:v', 'libx264', '-preset', 'medium', '-crf', '20', '-pix_fmt', 'yuv420p',
                    '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,aresample=48000', '-c:a', 'aac', '-b:a', '160k', '-ac', '2', '-movflags', '+faststart', chunk]
        run(command)
        chunks.append(chunk)
        for cue in section['cues']:
            subtitles.append(f'{len(subtitles)+1}\n{timestamp(offset+cue["start"])} --> {timestamp(offset+cue["end"])}\n{cue["text"]}\n')
        offset += target
        section['playbackRate'] = round(speed, 4)
    concat = assets / 'chapters.ffconcat'
    concat.write_text('ffconcat version 1.0\n' + ''.join(f"file '{concat_quote(path)}'\n" for path in chunks), encoding='utf-8')
    final = output / 'ClearPath_submission_demo_EN.mp4'
    run(['ffmpeg', '-v', 'error', '-y', '-safe', '0', '-i', concat, '-map', '0:v:0', '-map', '0:a:0',
         '-map_metadata', '-1', '-map_chapters', '-1',
         '-vf', f'fps={FPS}:start_time=0,tpad=stop_mode=clone:stop_duration=2',
         '-t', str(production['duration']), '-c:v', 'libx264', '-preset', 'medium',
         '-crf', '18', '-pix_fmt', 'yuv420p', '-c:a', 'copy', '-movflags', '+faststart', final])
    srt = final.with_suffix('.srt')
    srt.write_text('\n'.join(subtitles), encoding='utf-8')
    details = probe(final)
    streams = details['streams']
    if float(details['format']['duration']) >= 180 or len(streams) != 2 or {x['codec_type'] for x in streams} != {'video', 'audio'}:
        raise RuntimeError('Final duration or stream inventory failed verification.')
    if details.get('chapters'):
        raise RuntimeError('Unexpected source chapters survived.')
    for stream in streams:
        tags = stream.get('tags', {})
        if any('location' in key.lower() or 'creation_time' in key.lower() for key in tags):
            raise RuntimeError('Unexpected source metadata survived.')
    if any('location' in key.lower() or 'creation_time' in key.lower() for key in details['format'].get('tags', {})):
        raise RuntimeError('Unexpected format metadata survived.')
    report = dict(duration=float(details['format']['duration']), streams=[dict(type=x['codec_type'], codec=x['codec_name']) for x in streams],
                  sourceAudioMapped=False, metadataStripped=True, chaptersStripped=True,
                  chapterDurations={x['id']:x['seconds'] for x in production['sections']},
                  playbackRates={x['id']:x.get('playbackRate',1) for x in production['sections']},
                  narration=production.get('voice', 'Authorized local WAV narration') + '; original English text; no music',
                  scope='One reused self-recorded development scene; not unseen validation or safety certification')
    (assets / 'build-report.json').write_text(json.dumps(report, indent=2) + '\n', encoding='utf-8')
    shutil.copy2(assets / 'narration-en.txt', output / 'ClearPath_narration_EN.txt')
    print(json.dumps(dict(output=str(final), subtitles=str(srt), **report), ensure_ascii=False))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('action', choices=['prepare', 'build'])
    parser.add_argument('--assets', type=Path, default=ROOT / 'evidence/contest-production/producer-assets')
    parser.add_argument('--output-dir', type=Path, default=ROOT.parent / 'ClearPath_参赛提交包_2026-10-14')
    parser.add_argument('--voice-dir', type=Path, help='Authorized local WAV files; required by prepare')
    parser.add_argument('--ring-clip', type=Path)
    parser.add_argument('--workflow-clip', type=Path)
    for kind in ('ring', 'workflow'):
        parser.add_argument(f'--{kind}-start', type=float, default=0)
        parser.add_argument(f'--{kind}-end', type=float)
    args = parser.parse_args()
    if not shutil.which('ffmpeg') or not shutil.which('ffprobe'):
        raise RuntimeError('ffmpeg and ffprobe must be available on PATH.')
    if args.action == 'prepare':
        prepare(args.assets.resolve(), args.voice_dir.resolve() if args.voice_dir else None)
    else:
        build(args, args.assets.resolve())


if __name__ == '__main__':
    main()
