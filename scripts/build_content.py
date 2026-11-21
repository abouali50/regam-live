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
ORDER = ['limites','formes-indeterminees','continuite','derivation','fonctions-reciproques','etude-fonction','suites','logarithme','exponentielle','primitives-integrales','equations-differentielles','theoremes-analyse-sm','suites-adjacentes','integration-sm','complexes','complexes-sm','arithmetique','structures','espaces-vectoriels','geometrie-complexe','geometrie-espace','spheres','denombrement','probabilites','variables-aleatoires']
MEDIA_NOTE = {
    'ar': '<p>الدروس والتمارين متاحة بالعربية الفصحى والفرنسية والإنجليزية. يتضمن فيديو النهايات تعليقًا صوتيًا اصطناعيًا باللغة المختارة، مدمجًا في ملف الفيديو. وتبقى الشروح البصرية لثلاثة وعشرين درسًا دون صوت. أما المقاطع السبعة الخاصة بالحالات غير المحددة فتحتفظ بصوتها بالدارجة المغربية، مع ترجمة نصية باللغات الثلاث. يُبيَّن نوع كل فيديو ولغة صوته بجانب المشغّل.</p>',
    'fr': '<p>Les cours et exercices sont disponibles en arabe standard, en français et en anglais. La vidéo des limites comporte une narration synthétique dans la langue choisie, intégrée au MP4. Les explications visuelles de vingt-trois autres cours restent sans voix. Les sept clips sur les formes indéterminées conservent leur narration en darija marocaine, avec des sous-titres dans les trois langues. Le type de vidéo et la langue de sa voix sont indiqués près du lecteur.</p>',
    'en': '<p>Courses and exercises are available in Standard Arabic, French and English. The limits video includes synthetic narration in the selected language, embedded in the MP4. The visual explanations for twenty-three other courses remain silent. The seven indeterminate-form clips retain their Moroccan Darija narration and include subtitles in all three languages. Each player identifies the video format and spoken language.</p>'
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


def build(allow_unrendered=False):
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
        assert actual == {'lessons':25,'sections':133,'exercises':75,'quizzes':43,'videos':31,'tracks':{'pc':18,'sm':23}}, (lang, actual)
        data['meta'].update(version='1.2.0', language=lang, updated={'ar':'21 نوفمبر 2026','fr':'21 novembre 2026','en':'21 November 2026'}[lang])
        paragraphs = re.findall(r'<p>.*?</p>', data['meta']['curriculumNote'], flags=re.S)
        data['meta']['curriculumNote'] = ''.join(paragraphs[:2]) + MEDIA_NOTE[lang]
        locales[lang] = data
    destination = SITE / 'data' / 'courses.js'
    destination.parent.mkdir(parents=True, exist_ok=True)
    destination.write_text('/* Generated from complete authored locales by scripts/build_content.py. */\nwindow.REGAM_LOCALES = ' + json.dumps(locales, ensure_ascii=False, separators=(',', ':')) + ';\nwindow.REGAM_DATA = window.REGAM_LOCALES.ar;\n', encoding='utf-8')
    videos = [v for data in locales.values() for lesson in data['lessons'] for v in lesson['videos']]
    report = {'version':'1.2.0', 'languages':list(locales), 'counts_per_language':counts(locales['ar']), 'bundle_bytes':destination.stat().st_size, 'localized_silent_videos':sum(bool(v.get('silent')) for v in videos), 'localized_narrated_videos':sum(v.get('audioLanguage') in LANGUAGES for v in videos), 'development_build':allow_unrendered}
    print(json.dumps(report, ensure_ascii=False))
    return report


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--allow-unrendered', action='store_true', help='Development only: allow original media while translated variants render')
    build(parser.parse_args().allow_unrendered)
