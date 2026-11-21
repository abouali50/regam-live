#!/usr/bin/env python3
"""Build narrated MP4s from retained speech assets, without generating new speech.

Every scene uses the corresponding returned audio clip at its original speed.
Timings are measured from the actual files. Two seconds after each sentence
leave time to read the displayed calculation. Silent media remain unchanged.
"""
from pathlib import Path
import argparse
import concurrent.futures
import hashlib
import json
import re
import subprocess
import urllib.request

from PIL import Image
import render_localized_videos as visual

ROOT = Path(__file__).resolve().parents[1]
LABELS = {
    'ar': 'تعليق صوتي بالعربية الفصحى',
    'fr': 'Avec narration en français',
    'en': 'With English narration',
}


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe', '-v', 'error', '-show_streams', '-show_format', '-of', 'json', str(path)]))


def run(*args):
    subprocess.run(['ffmpeg', '-y', '-hide_banner', '-loglevel', 'error', *map(str, args)], check=True)


def download(item):
    url, path = item
    if path.exists():
        return path
    if not url.startswith('https://assets.vidiq.com/voiceovers/'):
        raise ValueError('Unexpected audio asset URL')
    with urllib.request.urlopen(url, timeout=45) as response:
        content = response.read()
    if not content:
        raise ValueError('Empty audio download')
    path.write_bytes(content)
    return path


def render(lang, lesson_id):
    source_dir = ROOT / 'content' / 'narration' / lesson_id
    source = json.loads((source_dir / f'{lang}.json').read_text())
    lessons = json.loads((ROOT / 'content' / 'locales' / f'video_scripts_{lang}.json').read_text())
    lesson = visual.localize_equation_labels(next(l for l in lessons if l['id'] == lesson_id), lang)
    assert source['scriptLines'] == [s['text'] for s in lesson['segments']], 'Speech script differs from visible explanation'
    lines = source['result']['lines']
    assert len(lines) == len(lesson['segments']) and [l['index'] for l in lines] == list(range(len(lines)))
    audio_dir = source_dir / lang
    audio_dir.mkdir(exist_ok=True)
    downloads = [(source['result']['audioUrl'], audio_dir / 'joined-original.mp3')]
    downloads += [(line['audioUrl'], audio_dir / f'{i+1:02}.mp3') for i, line in enumerate(lines)]
    with concurrent.futures.ThreadPoolExecutor(max_workers=4) as pool:
        list(pool.map(download, downloads))
    work = ROOT / 'video_build' / 'narrated' / lang / lesson_id
    work.mkdir(parents=True, exist_ok=True)
    media = ROOT / 'site' / 'media' / lang
    media.mkdir(parents=True, exist_ok=True)
    stem = f'{lesson_id}-narrated'
    video_entries, audio_entries, cues, timings = [], [], ['WEBVTT', ''], []
    elapsed = 0.0
    for i, segment in enumerate(lesson['segments']):
        audio_file = audio_dir / f'{i+1:02}.mp3'
        info = probe(audio_file)
        assert len([s for s in info['streams'] if s['codec_type'] == 'audio']) == 1
        audio_duration = float(info['format']['duration'])
        assert abs(audio_duration - lines[i]['durationSeconds']) < 0.25
        # Round to a whole number of six-fps video frames, with a reading pause.
        scene_duration = (int((audio_duration + 2.0) * 6) + 1) / 6
        frame_file = work / f'{i+1:02}.png'
        visual.frame(lesson, segment, i, lang, audio_label=LABELS[lang]).save(frame_file)
        audio_prepared = work / f'{i+1:02}.wav'
        run('-i', audio_file, '-af', 'apad', '-t', f'{scene_duration:.6f}', '-ar', '48000', '-ac', '1', '-c:a', 'pcm_s16le', audio_prepared)
        video_entries += [f"file '{frame_file.as_posix()}'", f'duration {scene_duration:.6f}']
        audio_entries.append(f"file '{audio_prepared.as_posix()}'")
        cues += [str(i+1), f'{visual.timestamp(elapsed)} --> {visual.timestamp(elapsed+audio_duration)}', segment['text'], '']
        timings.append({'index': i, 'start': elapsed, 'audio_duration': audio_duration, 'scene_duration': scene_duration, 'source': audio_file.relative_to(ROOT).as_posix(), 'source_sha256': hashlib.sha256(audio_file.read_bytes()).hexdigest()})
        elapsed += scene_duration
    video_entries.append(f"file '{frame_file.as_posix()}'")
    (work / 'frames.txt').write_text('\n'.join(video_entries)+'\n')
    (work / 'audio.txt').write_text('\n'.join(audio_entries)+'\n')
    run('-f', 'concat', '-safe', '0', '-i', work/'audio.txt', '-c:a', 'pcm_s16le', work/'narration.wav')
    # Match voice loudness across the languages without changing speed or pitch.
    measurement = subprocess.run(['ffmpeg','-hide_banner','-i',str(work/'narration.wav'),'-af','loudnorm=I=-18:TP=-2:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
    loudness_match = re.search(r'\{\s*"input_i"[\s\S]*?\}', measurement)
    if not loudness_match:
        raise ValueError('Audio loudness measurement missing')
    levels = json.loads(loudness_match[0])
    audio_filter = 'loudnorm=I=-18:TP=-2:LRA=11:linear=true:' + ':'.join([
        'measured_I='+levels['input_i'], 'measured_LRA='+levels['input_lra'],
        'measured_TP='+levels['input_tp'], 'measured_thresh='+levels['input_thresh'],
        'offset='+levels['target_offset'],
    ])
    output = media / f'{stem}.mp4'
    run('-f', 'concat', '-safe', '0', '-i', work/'frames.txt', '-i', work/'narration.wav', '-map', '0:v:0', '-map', '1:a:0', '-t', f'{elapsed:.6f}', '-vf', 'fps=6', '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '22', '-threads', '2', '-pix_fmt', 'yuv420p', '-af', audio_filter, '-c:a', 'aac', '-b:a', '128k', '-ar', '48000', '-movflags', '+faststart', output)
    Image.open(work/'01.png').save(media/f'{stem}.jpg', quality=88, optimize=True)
    (media/f'{stem}.vtt').write_text('\n'.join(cues), encoding='utf-8')
    final = probe(output)
    assert sorted(s['codec_type'] for s in final['streams']) == ['audio', 'video']
    assert abs(float(final['format']['duration']) - elapsed) < 0.3
    loudness = subprocess.run(['ffmpeg','-hide_banner','-i',str(output),'-map','0:a:0','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True).stderr
    assert 'mean_volume: -inf' not in loudness and 'max_volume: -inf' not in loudness
    prefix = f'media/{lang}/{stem}'
    video = {'title':lesson['title'], 'src':prefix+'.mp4', 'poster':prefix+'.jpg', 'duration':float(final['format']['duration']), 'silent':False, 'audioLanguage':lang, 'aspectRatio':'16:9', 'narration':'synthetic', 'textLanguage':lang, 'description':LABELS[lang], 'voiceName':source['voice']['name'], 'tracks':[{'src':prefix+'.vtt','language':lang,'label':visual.LANGUAGE_NAMES[lang]}], 'transcript':lesson['segments']}
    catalog_path = ROOT/'content'/'locales'/f'video_catalog_narrated_{lang}.json'
    catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {}
    catalog[lesson_id] = [video]
    catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    report = {'language':lang, 'lesson':lesson_id, 'duration':float(final['format']['duration']), 'audio_codec':next(s['codec_name'] for s in final['streams'] if s['codec_type']=='audio'), 'video_sha256':hashlib.sha256(output.read_bytes()).hexdigest(), 'timings':timings, 'loudness_target':{'integrated_lufs':-18,'true_peak_db':-2,'source_measurement':levels}, 'volume_measurement':loudness[loudness.rfind('mean_volume:'):].strip(), 'listening_review':'Not independently listened to or transcribed in this environment.'}
    (source_dir/f'{lang}-validation.json').write_text(json.dumps(report,ensure_ascii=False,indent=2)+'\n')
    print(json.dumps({k:v for k,v in report.items() if k not in ('timings','volume_measurement')},ensure_ascii=False),flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--lang',choices=['ar','fr','en'],required=True)
    parser.add_argument('--lesson',default='limites')
    args=parser.parse_args()
    render(args.lang,args.lesson)
