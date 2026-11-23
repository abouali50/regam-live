#!/usr/bin/env python3
"""Assemble verified scene audio and exact frames into standalone narrated MP4s."""
from pathlib import Path
import hashlib
import json
import math
import os
import re
import subprocess
import tempfile

from PIL import Image
from render_localized_videos import timestamp, LANGUAGE_NAMES

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(Path(path).read_bytes()).hexdigest()


def probe(path):
    return json.loads(subprocess.check_output(['ffprobe','-v','error','-show_streams','-show_format','-of','json',str(path)]))


def ffmpeg(*args):
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error',*map(str,args)], check=True)


def write_json_atomic(path, value):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = None
    try:
        with tempfile.NamedTemporaryFile('w', encoding='utf-8', dir=path.parent,
                                         prefix='.' + path.name + '.', suffix='.tmp', delete=False) as stream:
            temporary = Path(stream.name)
            json.dump(value, stream, ensure_ascii=False, indent=2)
            stream.write('\n')
            stream.flush()
            os.fsync(stream.fileno())
        temporary.replace(path)
    finally:
        if temporary is not None:
            temporary.unlink(missing_ok=True)


def assemble(lesson, lang, audio_paths, voice, frames_dir, catalog_kind='narrated'):
    lesson_id = lesson['id']
    if not re.fullmatch(r'[a-z][a-z0-9-]{1,60}', lesson_id):
        raise ValueError('Invalid lesson identifier')
    segments = lesson['segments']
    assert len(audio_paths) == len(segments) > 0
    frames_dir = Path(frames_dir)
    frames = [frames_dir/f'{i+1:02}.png' for i in range(len(segments))]
    assert all(p.is_file() for p in [*frames, *map(Path,audio_paths)])
    media = ROOT/'site'/'media'/lang
    media.mkdir(parents=True,exist_ok=True)
    output = media/f'{lesson_id}-narrated.mp4'
    poster = media/f'{lesson_id}-narrated.jpg'
    captions = media/f'{lesson_id}-narrated.vtt'
    source_dir = ROOT/'content'/'narration'/lesson_id
    source_dir.mkdir(parents=True,exist_ok=True)
    report_path = source_dir/f'{lang}-validation.json'
    signature = hashlib.sha256(json.dumps({
        'assembly':'1.3.0', 'lesson':lesson, 'voice':voice,
        'audio':[sha(p) for p in audio_paths], 'frames':[sha(p) for p in frames],
    },ensure_ascii=False,sort_keys=True).encode()).hexdigest()
    if all(path.is_file() for path in (output, poster, captions, report_path)):
        try:
            previous = json.loads(report_path.read_text())
        except (OSError, ValueError):
            previous = {}
        if not isinstance(previous, dict):
            previous = {}
        if (previous.get('build_signature') == signature
                and previous.get('video_sha256') == sha(output)
                and previous.get('poster_sha256') == sha(poster)
                and previous.get('captions_sha256') == sha(captions)):
            print(json.dumps({'language':lang,'lesson':lesson_id,'cached':True,'duration':previous['duration']},ensure_ascii=False),flush=True)
            return previous['catalog_entry']
    work = ROOT/'video_build'/'assembled'/lang/lesson_id
    work.mkdir(parents=True,exist_ok=True)
    elapsed, frame_entries, audio_entries, cues, transcript, timing = 0.0, [], [], ['WEBVTT',''], [], []
    for i, (segment, audio_path, frame) in enumerate(zip(segments,audio_paths,frames)):
        audio_path = Path(audio_path)
        info = probe(audio_path)
        assert any(stream['codec_type']=='audio' for stream in info['streams'])
        audio_duration = float(info['format']['duration'])
        assert .3 < audio_duration < 180, (lesson_id,lang,i,audio_duration)
        duration = math.ceil((audio_duration + 1.8)*6)/6
        normalized = work/f'{i+1:02}.wav'
        ffmpeg('-i',audio_path,'-af','apad','-t',f'{duration:.6f}','-ar','48000','-ac','1','-c:a','pcm_s16le',normalized)
        frame_entries.extend([f"file '{frame.as_posix()}'",f'duration {duration:.6f}'])
        audio_entries.append(f"file '{normalized.as_posix()}'")
        cues.extend([str(i+1),f'{timestamp(elapsed)} --> {timestamp(elapsed+audio_duration)}',segment['text'],''])
        transcript.append(dict(segment,startSeconds=round(elapsed,6),durationSeconds=round(duration,6)))
        timing.append({'index':i,'start':round(elapsed,6),'audio_duration':audio_duration,'scene_duration':duration,'audio_sha256':sha(audio_path)})
        elapsed += duration
    frame_entries.append(f"file '{frames[-1].as_posix()}'")
    (work/'frames.txt').write_text('\n'.join(frame_entries)+'\n')
    (work/'audio.txt').write_text('\n'.join(audio_entries)+'\n')
    ffmpeg('-f','concat','-safe','0','-i',work/'audio.txt','-c:a','pcm_s16le',work/'voice.wav')
    measurement=subprocess.run(['ffmpeg','-hide_banner','-i',str(work/'voice.wav'),'-af','loudnorm=I=-18:TP=-2:LRA=11:print_format=json','-f','null','-'],capture_output=True,text=True,check=True).stderr
    match=re.search(r'\{\s*"input_i"[\s\S]*?\}',measurement)
    if not match:
        raise RuntimeError('No loudness measurement')
    levels=json.loads(match[0])
    if not math.isfinite(float(levels['input_i'])):
        raise RuntimeError('Audio is silent')
    loudnorm='loudnorm=I=-18:TP=-2:LRA=11:linear=true:'+':'.join([
        'measured_I='+levels['input_i'],'measured_LRA='+levels['input_lra'],
        'measured_TP='+levels['input_tp'],'measured_thresh='+levels['input_thresh'],
        'offset='+levels['target_offset'],
    ])
    temp=media/f'{lesson_id}-building.mp4'
    ffmpeg('-f','concat','-safe','0','-i',work/'frames.txt','-i',work/'voice.wav',
           '-map','0:v:0','-map','1:a:0','-t',f'{elapsed:.6f}','-vf','fps=6',
           '-c:v','libx264','-preset','veryfast','-crf','22','-threads','2','-pix_fmt','yuv420p',
           '-af',loudnorm,'-c:a','aac','-b:a','128k','-ar','48000','-movflags','+faststart',temp)
    final=probe(temp)
    assert sorted(s['codec_type'] for s in final['streams']) == ['audio','video']
    assert next(s['codec_name'] for s in final['streams'] if s['codec_type']=='audio') == 'aac'
    assert abs(float(final['format']['duration'])-elapsed)<.3
    video_stream=next(s for s in final['streams'] if s['codec_type']=='video')
    assert (video_stream['width'],video_stream['height']) == (1600,900)
    volume=subprocess.run(['ffmpeg','-hide_banner','-i',str(temp),'-map','0:a:0','-af','volumedetect','-f','null','-'],capture_output=True,text=True,check=True).stderr
    volume_match=re.search(r'mean_volume: ([-\w.]+) dB',volume)
    assert volume_match and math.isfinite(float(volume_match[1])) and float(volume_match[1])>-45, 'Silent or inaudible output'
    temp.replace(output)
    prefix=f'media/{lang}/{lesson_id}-narrated'
    Image.open(frames[0]).save(poster,quality=90,optimize=True)
    captions.write_text('\n'.join(cues),encoding='utf-8')
    entry={
        'id':lesson_id,'title':lesson['title'],'src':prefix+'.mp4','poster':prefix+'.jpg',
        'duration':float(final['format']['duration']),'silent':False,'audioLanguage':lang,
        'aspectRatio':'16:9','narration':'synthetic','textLanguage':lang,
        'voiceName':voice.get('name',voice.get('voice','Synthetic voice')),
        'tracks':[{'src':prefix+'.vtt','language':lang,'label':LANGUAGE_NAMES[lang]}],
        'transcript':transcript,
    }
    report={
        'language':lang,'lesson':lesson_id,'duration':entry['duration'],'audio_codec':'aac',
        'video_sha256':sha(output),'poster_sha256':sha(poster),'captions_sha256':sha(captions),
        'build_signature':signature,'timings':timing,
        'voice':voice,'loudness_target':{'integrated_lufs':-18,'true_peak_db':-2,'source_measurement':levels},
        'mean_volume_db':float(volume_match[1]),'catalog_entry':entry,
        'listening_review':'Technical signal and timing validation; no full human listening review claimed.',
    }
    write_json_atomic(report_path, report)
    print(json.dumps({'language':lang,'lesson':lesson_id,'duration':entry['duration'],'bytes':output.stat().st_size,'mean_volume_db':report['mean_volume_db']},ensure_ascii=False),flush=True)
    return entry
