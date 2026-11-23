#!/usr/bin/env python3
"""Render the eight-course function-study path and its three worked studies.

Limits retain their existing narrated assets. Seven formerly silent course
examples and three new full studies receive an embedded narration per language.
No speech service or credentials are required on the deployed static site.
"""
from pathlib import Path
import argparse
import json

import function_study_frames
import render_localized_videos as visual
from narrated_media import assemble, write_json_atomic
from voice_backend import generate_scenes

ROOT = Path(__file__).resolve().parents[1]
COURSES = ['continuite','derivation','fonctions-reciproques','logarithme','exponentielle','etude-fonction','primitives-integrales']


def render_language(lang, only=None, allow_online=False):
    courses = json.loads((ROOT/'content'/'locales'/f'video_scripts_{lang}.json').read_text())
    studies = json.loads((ROOT/'content'/'function_study_lessons.json').read_text())['videos']
    jobs = []
    for lesson in courses:
        if lesson['id'] in COURSES:
            jobs.append((visual.localize_equation_labels(lesson,lang), None))
    for study in studies:
        local = study['translations'][lang]
        jobs.append((dict(id=study['id'],title=local['title'],segments=local['segments'],courseTitle=local['title']),study))
    if only:
        ids = {lesson['id'] for lesson, _ in jobs}
        if not set(only) <= ids:
            raise ValueError('Unknown lesson requested')
        jobs = [(lesson,study) for lesson,study in jobs if lesson['id'] in only]
    ordinary_path = ROOT/'content'/'locales'/f'video_catalog_narrated_{lang}.json'
    study_path = ROOT/'content'/'locales'/f'video_catalog_function_study_{lang}.json'
    ordinary = json.loads(ordinary_path.read_text())
    current_studies = json.loads(study_path.read_text()).get('etude-fonction',[]) if study_path.exists() else []
    study_catalog = {entry['id']:entry for entry in current_studies}
    for lesson, study in jobs:
        lesson_id = lesson['id']
        print(f"VOICE {lang}/{lesson_id}: {len(lesson['segments'])} scenes",flush=True)
        manifest = generate_scenes(lang,lesson_id,[segment['text'] for segment in lesson['segments']],backend='edge',allow_online=allow_online)
        scenes = manifest['scenes']
        assert len(scenes) == len(lesson['segments'])
        assert [scene['text'] for scene in scenes] == [segment['text'] for segment in lesson['segments']]
        audio_paths = []
        for scene in scenes:
            path = Path(scene['path'])
            audio_paths.append(path if path.is_absolute() else ROOT/path)
        frames = ROOT/'video_build'/'module_frames'/lang/lesson_id
        frames.mkdir(parents=True,exist_ok=True)
        for i, segment in enumerate(lesson['segments']):
            if study:
                image = function_study_frames.frame(study,study['translations'][lang],segment,i,lang)
            else:
                image = visual.frame(lesson,segment,i,lang,audio_label=function_study_frames.COPY[lang]['voice'])
            image.save(frames/f'{i+1:02}.png')
        voice = manifest['voice']
        if isinstance(voice,str):
            voice={'name':voice}
        voice = dict(voice,provider=manifest['provider'])
        entry=assemble(lesson,lang,audio_paths,voice,frames)
        if study:
            study_catalog[lesson_id]=entry
            entries=[study_catalog[item['id']] for item in studies if item['id'] in study_catalog]
            write_json_atomic(study_path, {'etude-fonction':entries})
        else:
            ordinary[lesson_id]=[entry]
            write_json_atomic(ordinary_path, ordinary)
    print(f'RENDER COMPLETE {lang}: {len(jobs)} videos',flush=True)


if __name__ == '__main__':
    parser=argparse.ArgumentParser()
    parser.add_argument('--lang',choices=['ar','fr','en'],required=True)
    parser.add_argument('--only',nargs='+')
    parser.add_argument('--allow-online-voice',action='store_true',help='Requires explicit user approval of transmission to Microsoft speech')
    args=parser.parse_args()
    render_language(args.lang,args.only,args.allow_online_voice)
