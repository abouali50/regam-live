#!/usr/bin/env python3
"""Build the static course catalogue from the original authored lesson files.

No packages or network are required. Media must already be present in site/media.
Optional content/video_catalog_extra.json adds genuinely rendered new videos.
"""
from pathlib import Path
import copy
import html
import json
import re

ROOT = Path(__file__).resolve().parents[1]
CONTENT = ROOT / 'content'
SITE = ROOT / 'site'
ORDER = [
    'limites', 'formes-indeterminees', 'continuite', 'derivation',
    'fonctions-reciproques', 'etude-fonction', 'suites', 'logarithme',
    'exponentielle', 'primitives-integrales', 'equations-differentielles',
    'theoremes-analyse-sm', 'suites-adjacentes', 'integration-sm',
    'complexes', 'complexes-sm', 'arithmetique', 'structures',
    'espaces-vectoriels', 'geometrie-complexe', 'geometrie-espace',
    'spheres', 'denombrement', 'probabilites', 'variables-aleatoires',
]

def normalize(value):
    """Use literal TeX inside math delimiters; app.js escapes it before HTML parsing."""
    if isinstance(value, str):
        return re.sub(r'\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\)|\$\$[\s\S]*?\$\$', lambda m: html.unescape(m[0]), value)
    if isinstance(value, list):
        return [normalize(v) for v in value]
    if isinstance(value, dict):
        return {k: normalize(v) for k, v in value.items()}
    return value

def build():
    lessons = []
    for name in ('core_lessons.json', 'analysis_extra.json', 'other_lessons.json', 'sm_lessons.json'):
        lessons.extend(json.loads((CONTENT / name).read_text(encoding='utf-8')))
    ids = [lesson['id'] for lesson in lessons]
    assert len(ids) == len(set(ids)), 'Duplicate lesson IDs'
    assert set(ids) == set(ORDER), 'Unexpected lesson inventory'
    lessons.sort(key=lambda lesson: ORDER.index(lesson['id']))
    videos = {}
    for name in ('video_catalog.json', 'video_catalog_extra.json'):
        path = CONTENT / name
        if path.exists():
            for lesson_id, entries in json.loads(path.read_text(encoding='utf-8')).items():
                assert lesson_id in ids, f'Unknown video lesson {lesson_id}'
                videos.setdefault(lesson_id, []).extend(entries)
    for lesson in lessons:
        lesson.pop('videoLesson', None)
        lesson['videos'] = copy.deepcopy(videos.get(lesson['id'], []))
        assert lesson['tracks'] and set(lesson['tracks']) <= {'pc', 'sm'}
        assert lesson['domain'] in {'analyse', 'algebre', 'geometrie', 'probabilites'}
        assert lesson['sections'] and lesson['summary'] and lesson['exercises']
        for exercise in lesson['exercises']:
            assert exercise['statement'] and exercise['steps'] and exercise['answer']
        for q in lesson.get('quiz', []):
            assert 0 <= q['correct'] < len(q['choices'])
        for video in lesson['videos']:
            for value in [video['src'], video.get('poster'), *[t['src'] for t in video.get('tracks', [])]]:
                if not value:
                    continue
                path = SITE / value
                assert path.is_file() and path.resolve().is_relative_to(SITE.resolve()), f'Missing/unsafe media: {value}'

    data = {
        'meta': {
            'name': 'REGAM Academy', 'version': '1.0.0', 'updated': '20 novembre 2026',
            'curriculumNote': '<p>هاد المكتبة فيها دروس وتمارين أصلية للرياضيات فالثانية باكالوريا بالمغرب. ترتيب المواضيع مبني على التوجيهات التربوية المتاحة للعلوم التجريبية والعلوم الرياضية. تقسيمها لدروس قصيرة اختيار بيداغوجي ديال الموقع.</p><p>الوثائق المرجعية اللي تحت نسخ من وثائق الوزارة مستضافة فمواقع تعليمية. الدروس ماشي إصدار رسمي، وما كاينش هنا تأكيد لتعديلات خاصة بامتحان 2027. بالنسبة لشي دورة معيّنة، اعتمد الإطار المرجعي والمذكرات ديالها مع الأستاذ.</p><p>الشرح مكتوب بالدارجة والمصطلحات بالفرنسية. الفيديوهات السبعة ديال الأشكال غير المحددة فيها تعليق صوتي مولّد اصطناعياً. الشروحات البصرية فباقي الدروس فيها الخطوات مكتوبة، بلا تعليق صوتي، وهاد الفرق مبيّن فالمشغّل. عدد الفيديوهات اللي باين فكل درس هو عدد الملفات المتاحة فعلاً.</p>',
        },
        'tracks': [
            {'id': 'pc', 'name': 'Sciences Physiques / SVT', 'nameAr': 'العلوم الفيزيائية وعلوم الحياة والأرض', 'description': 'التحليل، الأعداد العقدية، الهندسة في الفضاء والاحتمالات. مسار مشترك للعلوم الفيزيائية وعلوم الحياة والأرض.'},
            {'id': 'sm', 'name': 'Sciences Mathématiques', 'nameAr': 'العلوم الرياضية A و B', 'description': 'الدروس المشتركة مع تعميق التحليل، الحسابيات، البنيات الجبرية والفضاءات المتجهية.'},
        ],
        'domains': [
            {'id': 'analyse', 'title': 'Analyse', 'titleAr': 'التحليل'},
            {'id': 'algebre', 'title': 'Algèbre', 'titleAr': 'الجبر'},
            {'id': 'geometrie', 'title': 'Géométrie', 'titleAr': 'الهندسة'},
            {'id': 'probabilites', 'title': 'Probabilités', 'titleAr': 'الاحتمالات'},
        ],
        'lessons': normalize(lessons),
        'sources': [
            {'title': 'Orientations pédagogiques · 2e Bac Sciences expérimentales', 'url': 'https://lycee.mathtutor.ma/wp-content/uploads/2026/06/orientations-pedagogiques-2bac-se.pdf', 'dateNote': 'نسخة مستضافة فموقع MathTutor. الموقع كيقدّم نسخة الثانية باكالوريا كإصدار 2015.', 'description': 'مرجع المواضيع المشتركة للعلوم الفيزيائية وSVT، بما فيها الهندسة في الفضاء.'},
            {'title': 'Orientations pédagogiques · 2e Bac Sciences Mathématiques', 'url': 'https://lycee.mathtutor.ma/wp-content/uploads/2026/06/orientations-pedagogiques-2bac-sm.pdf', 'dateNote': 'مقتطف من 12 صفحة. ترقيمه المطبوع 13–24 وكيوقف وسط البنيات الجبرية.', 'description': 'مرجع تعميق التحليل والحسابيات والأعداد العقدية. آخر أجزاء الجبر تكملات بالمرجع الكامل التالي.'},
            {'title': 'التوجيهات التربوية وبرامج الرياضيات بالثانوي التأهيلي', 'url': 'https://www.profeps.ma/documents/op/op-mathematiques-lycee-2007.pdf', 'dateNote': 'وثيقة الوزارة، نونبر 2007، نسخة على موقع Profeps.', 'description': 'الصفحتان المطبوعتان 113 و114 كتوضحا البنيات الجبرية والفضاءات المتجهية. مصدر تاريخي للبرنامج، ماشي إعلان إصلاح جديد.'},
            {'title': 'بيانات مصدر نسخ التوجيهات', 'url': 'https://lycee.mathtutor.ma/documents/orientations-pedagogiques/', 'dateNote': 'الموقع الناشر كيميّز إصدار 2014 للجذع و1BAC عن إصدار 2015 للثانية باكالوريا.', 'description': 'التاريخ 2026/06 فمسار ملفات PDF تاريخ ترتيب على الموقع، ماشي دليل على تحيين رسمي للبرنامج.'},
            {'title': 'مذكرات وزارة التربية الوطنية', 'url': 'https://www.men.gov.ma/fr/notes', 'dateNote': 'للتأكد من الإطار المرجعي والمذكرات الخاصة بالدورة اللي كتوجد ليها.'},
        ],
    }
    (SITE / 'data').mkdir(parents=True, exist_ok=True)
    (SITE / 'data' / 'courses.js').write_text(
        '/* Generated by scripts/build_content.py. Original teaching content. */\nwindow.REGAM_DATA = '
        + json.dumps(data, ensure_ascii=False, separators=(',', ':')) + ';\n', encoding='utf-8')
    counts = {
        'lessons': len(lessons), 'sections': sum(len(l['sections']) for l in lessons),
        'exercises': sum(len(l['exercises']) for l in lessons),
        'quizzes': sum(len(l.get('quiz', [])) for l in lessons),
        'videos': sum(len(l['videos']) for l in lessons),
        'tracks': {track: sum(track in l['tracks'] for l in lessons) for track in ('pc', 'sm')},
    }
    print(json.dumps(counts, ensure_ascii=False))
    return counts

if __name__ == '__main__':
    build()
