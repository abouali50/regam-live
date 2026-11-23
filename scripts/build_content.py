#!/usr/bin/env python3
"""Build the complete offline-capable ar/fr/en catalogue from authored locales."""
from pathlib import Path
import argparse
import copy
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
SITE = ROOT / 'site'
CONTENT = ROOT / 'content' / 'locales'
LANGUAGES = ('ar', 'fr', 'en')
LANGUAGE_LABELS = {'ar': 'العربية الفصحى', 'fr': 'Français', 'en': 'English'}
VERSION = '1.3.0'
ORDER = ['limites','formes-indeterminees','continuite','derivation','fonctions-reciproques','etude-fonction','suites','logarithme','exponentielle','primitives-integrales','equations-differentielles','theoremes-analyse-sm','suites-adjacentes','integration-sm','complexes','complexes-sm','arithmetique','structures','espaces-vectoriels','geometrie-complexe','geometrie-espace','spheres','denombrement','probabilites','variables-aleatoires']
MEDIA_NOTE = {
    'ar': '<p>الدروس والتمارين متاحة بالعربية الفصحى والفرنسية والإنجليزية. يتوفر الشرح الصوتي الاصطناعي باللغة المختارة في {native} من فيديوهات المكتبة، والصوت مدمج في ملفات الفيديو. يجمع مسار دراسة الدوال ثمانية دروس وثلاث دراسات محلولة لدوال كسرية ولوغاريتمية وأسّية. وتبقى {silent} شروح بصرية دون صوت. تحتفظ المقاطع السبعة الخاصة بالحالات غير المحددة بصوتها بالدارجة المغربية وترجمتها النصية باللغات الثلاث. يُبيَّن نوع كل فيديو ولغة صوته بجانب المشغّل.</p>',
    'fr': '<p>Les cours et exercices sont disponibles en arabe standard, en français et en anglais. La bibliothèque contient {native} vidéo{native_suffix} avec narration synthétique dans la langue choisie, intégrée aux MP4. Le parcours Étude des fonctions réunit huit cours et trois études guidées de fonctions rationnelle, logarithmique et exponentielle. Il reste {silent} explications visuelles sans voix. Les sept clips sur les formes indéterminées conservent leur narration en darija, avec des sous-titres dans les trois langues. Chaque lecteur précise la langue audio.</p>',
    'en': '<p>Courses and exercises are available in Standard Arabic, French and English. The library contains {native} video{native_suffix} with synthetic narration in the selected language embedded in the MP4 files. The Function study path brings together eight lessons and three worked studies of rational, logarithmic and exponential functions. There are still {silent} visual explanations without narration. The seven indeterminate-form clips retain their Darija narration with subtitles in all three languages. Each player identifies its spoken language.</p>'
}


def normalize(value):
    if isinstance(value, str):
        return re.sub(r'\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$', lambda m: html.unescape(m[0]), value)
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    return value


def file_exists(value):
    path = SITE / value
    assert path.is_file() and not path.is_symlink() and path.resolve().is_relative_to(SITE.resolve()), f'Missing/unsafe media: {value}'


def counts(data):
    lessons = data['lessons']
    return {'lessons': len(lessons), 'sections': sum(len(l['sections']) for l in lessons), 'exercises': sum(len(l['exercises']) for l in lessons), 'quizzes': sum(len(l.get('quiz', [])) for l in lessons), 'videos': sum(len(l['videos']) for l in lessons), 'tracks': {t: sum(t in l['tracks'] for l in lessons) for t in ('pc','sm')}}


def build(allow_unrendered=False, draft=False):
    locales = {}
    for lang in LANGUAGES:
        data = normalize(json.loads((CONTENT / f'{lang}.json').read_text(encoding='utf-8')))
        lessons = data['lessons']
        assert [l['id'] for l in lessons] == ORDER, f'Unexpected lesson inventory in {lang}'
        catalog_path = CONTENT / f'video_catalog_{lang}.json'
        if not allow_unrendered:
            assert catalog_path.is_file(), f'Render the {lang} videos before building'
        catalog = json.loads(catalog_path.read_text()) if catalog_path.exists() else {}
        if catalog:
            assert len(catalog) == 24
        narrated_path = CONTENT / f'video_catalog_narrated_{lang}.json'
        if not allow_unrendered:
            assert narrated_path.is_file(), f'Missing narrated catalogue for {lang}'
        if narrated_path.exists():
            narrated = json.loads(narrated_path.read_text())
            assert set(narrated) <= set(catalog), f'Unexpected narrated lessons in {lang}'
            for video_list in narrated.values():
                for video in video_list:
                    assert video.get('silent') is False and video.get('audioLanguage') == lang
            catalog.update(narrated)
        studies_path = CONTENT / f'video_catalog_function_study_{lang}.json'
        if not draft:
            assert studies_path.is_file(), f'Missing completed function-study videos for {lang}'
        studies = json.loads(studies_path.read_text()) if studies_path.is_file() else {'etude-fonction':[]}
        assert set(studies) == {'etude-fonction'}
        if not draft:
            assert len(studies['etude-fonction']) == 3
        for video in studies['etude-fonction']:
            assert video.get('silent') is False and video.get('audioLanguage') == lang
        catalog['etude-fonction'] = catalog['etude-fonction'] + studies['etude-fonction']
        authored_studies = json.loads((ROOT / 'content' / 'function_study_lessons.json').read_text())['videos']
        synthesis = next(lesson for lesson in lessons if lesson['id'] == 'etude-fonction')
        data['functionStudies'] = []
        for study in authored_studies:
            local = study['translations'][lang]
            image = f'media/studies/{lang}/{study["id"]}.jpg'
            file_exists(image)
            data['functionStudies'].append({'id':study['id'],'title':local['title'],'summary':local['summary'],'segments':local['segments'],'image':image})
            exercise = local['exercise']
            synthesis['exercises'].append({
                'id': study['id'] + '-practice', 'title': local['title'],
                'level': {'ar':'تركيب','fr':'Synthèse','en':'Synthesis'}[lang],
                'statement': exercise['prompt'], 'hint': exercise.get('hint', ''),
                'steps': exercise['steps'], 'answer': exercise['answer'],
            })
            quiz = local['quiz']
            synthesis['quiz'].append({'question':quiz['question'], 'choices':quiz['options'], 'correct':quiz['answerIndex'], 'explanation':quiz['explanation']})
        for lesson in lessons:
            assert lesson['tracks'] and set(lesson['tracks']) <= {'pc','sm'}
            assert lesson['domain'] in {'analyse','algebre','geometrie','probabilites'}
            assert lesson['sections'] and lesson['summary'] and lesson['exercises']
            if lesson['id'] in catalog:
                lesson['videos'] = copy.deepcopy(catalog[lesson['id']])
            for video in lesson['videos']:
                if not video.get('silent') and lesson['id'] == 'formes-indeterminees':
                    video['audioLanguage'] = 'ary'
                    stem = Path(video['src']).stem
                    caption_tracks = [{'src': f'media/captions/{code}/{stem}.vtt', 'language': code, 'label': LANGUAGE_LABELS[code]} for code in LANGUAGES]
                    if not allow_unrendered or all((SITE / item['src']).is_file() for item in caption_tracks):
                        video['tracks'] = caption_tracks
                for value in [video['src'], video.get('poster'), *[track['src'] for track in video.get('tracks', [])]]:
                    if value:
                        file_exists(value)
            for exercise in lesson['exercises']:
                assert exercise['statement'] and exercise['steps'] and exercise['answer']
            for q in lesson.get('quiz', []):
                assert 0 <= q['correct'] < len(q['choices'])
        actual = counts(data)
        expected_videos = 31 + len(studies['etude-fonction'])
        assert actual == {'lessons':25,'sections':133,'exercises':78,'quizzes':46,'videos':expected_videos,'tracks':{'pc':18,'sm':23}}, (lang, actual)
        data['meta'].update(version=VERSION + ('-rc1' if draft else ''), releaseStatus='draft' if draft else 'complete', language=lang, updated={'ar':'23 نوفمبر 2026','fr':'23 novembre 2026','en':'23 November 2026'}[lang])
        paragraphs = re.findall(r'<p>.*?</p>', data['meta']['curriculumNote'], flags=re.S)
        all_videos = [video for lesson in lessons for video in lesson['videos']]
        native = sum(not video.get('silent') and video.get('audioLanguage') == lang for video in all_videos)
        silent = sum(bool(video.get('silent')) for video in all_videos)
        if not draft:
            assert native == 11 and silent == 16, f'Incomplete audio coverage: {lang}/{native}/{silent}'
        data['meta']['curriculumNote'] = ''.join(paragraphs[:2]) + MEDIA_NOTE[lang].format(native=native, native_suffix='' if native == 1 else 's', silent=silent)
        locales[lang] = data
    destination = SITE / 'data' / 'courses.js'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('/* Generated from complete authored locales by scripts/build_content.py. */\nwindow.REGAM_LOCALES = ' + json.dumps(locales, ensure_ascii=False, separators=(',', ':')) + ';\nwindow.REGAM_DATA = window.REGAM_LOCALES.ar;\n', encoding='utf-8')
    videos = [v for data in locales.values() for lesson in data['lessons'] for v in lesson['videos']]
    report = {'version':VERSION + ('-rc1' if draft else ''), 'languages':list(locales), 'counts_per_language':counts(locales['ar']), 'bundle_bytes':destination.stat().st_size, 'localized_silent_videos':sum(bool(v.get('silent')) for v in videos), 'localized_narrated_videos':sum(v.get('audioLanguage') in LANGUAGES for v in videos), 'development_build':allow_unrendered or draft}
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-unrendered', action='store_true', help='Development only: allow original media while translated variants render')
    parser.add_argument('--draft', action='store_true', help='Review written studies with the existing videos; never claim the new audio is finished')
    args=parser.parse_args()
    build(args.allow_unrendered,args.draft)
