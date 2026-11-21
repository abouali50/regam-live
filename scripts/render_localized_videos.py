#!/usr/bin/env python3
"""Render the 24 authored visual explanations in ar, fr or en.

These are deliberately silent MP4 lessons. Audio is never implied. Exact math,
translated captions, posters and transcripts are bundled locally with the site.
"""
from pathlib import Path
import argparse
import concurrent.futures
import copy
import json
import subprocess
import textwrap

from PIL import Image, ImageDraw
import render_visual_explainers as drawing

ROOT = Path(__file__).resolve().parents[1]
LANGUAGE_NAMES = {'ar': 'العربية الفصحى', 'fr': 'Français', 'en': 'English'}
LABELS = {
    'ar': {'silent': 'شرح بصري دون تعليق صوتي', 'step': 'الخطوة', 'footer': 'أوقف الفيديو وراجع كل خطوة بالوتيرة المناسبة لك.'},
    'fr': {'silent': 'Explication visuelle sans voix', 'step': 'ÉTAPE', 'footer': 'Mettez en pause pour revoir chaque étape à votre rythme.'},
    'en': {'silent': 'Visual explanation without narration', 'step': 'STEP', 'footer': 'Pause and review each step at your own pace.'},
}


def localize_equation_labels(lesson, lang):
    """Translate prose inside formulas without changing mathematical values."""
    lesson = copy.deepcopy(lesson)
    for segment in lesson['segments']:
        equation = segment['equation']
        if lang == 'en':
            replacements = {r'\text{hors }': r'\text{outside }', r'\text{sur }': r'\text{on }', r'\mathrm{ou}': r'\mathrm{or}', r'\mathrm{comites}': r'\mathrm{committees}', r'\mathrm{rouges}': r'\mathrm{red}', r'\mathrm{bleues}': r'\mathrm{blue}', r'\text{ groupe abélien}': r'\text{ Abelian group}'}
            for source, target in replacements.items():
                equation = equation.replace(source, target)
        elif lang == 'ar':
            equation = equation.replace(r'\mathrm{ou}', r'\vee')
            equation = equation.replace(r'\ \mathrm{comites}', '')
            equation = equation.replace(r'\text{ groupe abélien}', '')
            if r'\text{hors }' in equation:
                equation = r'f^{\prime}>0\quad(x\notin[-1,1]),\qquad f^{\prime}<0\quad(x\in]-1,1[)'
            if r'\mathrm{rouges}' in equation:
                equation = r'R:3,\qquad B:2'
                segment['text'] += ' يرمز R إلى الحمراء و B إلى الزرقاء.'
        segment['equation'] = equation
    return lesson


def wrapped(text, size, rtl):
    draw = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    font = drawing.font(size)
    result, line = [], ''
    for word in text.split():
        candidate = (line + ' ' + word).strip()
        if line and draw.textlength(candidate, font=font, direction='rtl' if rtl else 'ltr') > 1340:
            result.append(line)
            line = word
        else:
            line = candidate
    if line:
        result.append(line)
    return result


def frame(lesson, segment, index, lang, audio_label=None):
    rtl = lang == 'ar'
    labels = LABELS[lang]
    im = drawing.BG.copy()
    draw = ImageDraw.Draw(im)
    draw.text((72, 38), 'REGAM / ACADEMY', font=drawing.font(25, True), fill=drawing.GOLD)
    text = audio_label or labels['silent']
    font = drawing.font(24)
    bounds = draw.textbbox((0, 0), text, font=font, direction='rtl' if rtl else 'ltr')
    draw.text((1520 - bounds[2], 32 - bounds[1]), text, font=font, fill=drawing.MUTED, direction='rtl' if rtl else 'ltr')
    drawing.centered(im, lesson['courseTitle'], 94, 44, drawing.GOLD, True, ar=rtl)
    drawing.centered(im, lesson['title'], 163, 30, drawing.MUTED, ar=rtl)
    drawing.centered(im, f"{labels['step']} {index + 1} / {len(lesson['segments'])}", 244, 25, drawing.TEAL, True, ar=rtl)
    equation = drawing.equation_image(segment['equation'])
    im.alpha_composite(equation, (round((1600-equation.width)/2), round(382-equation.height/2)))
    drawing.centered(im, segment['note'], 515, 30, drawing.TEAL, ar=rtl)
    size = 38
    lines = wrapped(segment['text'], size, rtl)
    while len(lines) > 4 and size > 26:
        size -= 1
        lines = wrapped(segment['text'], size, rtl)
    if len(lines) > 4:
        raise ValueError(f"Text overflow: {lang}/{lesson['id']}/{index}")
    y = 667 - len(lines)*(size+12)/2
    for n, line in enumerate(lines):
        drawing.centered(im, line, y+n*(size+12), size, drawing.CREAM, ar=rtl)
    draw.line((74, 833, 1526, 833), fill=(53,77,90), width=4)
    draw.line((74, 833, 74+1452*(index+1)/len(lesson['segments']), 833), fill=drawing.TEAL, width=4)
    drawing.centered(im, labels['footer'], 855, 21, drawing.MUTED, ar=rtl)
    return im.convert('RGB')


def timestamp(seconds):
    millis = round(seconds*1000)
    return f'{millis//3600000:02}:{millis//60000%60:02}:{millis//1000%60:02}.{millis%1000:03}'


def prepare(lesson, lang):
    folder = ROOT/'video_build'/'localized_frames'/lang/lesson['id']
    media = ROOT/'site'/'media'/lang
    folder.mkdir(parents=True, exist_ok=True)
    media.mkdir(parents=True, exist_ok=True)
    entries, captions, durations = [], ['WEBVTT', ''], []
    elapsed = 0
    for index, segment in enumerate(lesson['segments']):
        output = folder/f'{index+1:02}.png'
        frame(lesson, segment, index, lang).save(output)
        duration = max(8.0, min(24.0, len(segment['text'].split())/2.2+3.0))
        durations.append(duration)
        entries += [f"file '{output.as_posix()}'", f'duration {duration:.6f}']
        captions += [str(index+1), f'{timestamp(elapsed)} --> {timestamp(elapsed+duration)}', segment['note'], textwrap.fill(segment['text'], width=78), '']
        elapsed += duration
    entries.append(f"file '{output.as_posix()}'")
    manifest = folder/'frames.txt'
    manifest.write_text('\n'.join(entries)+'\n')
    Image.open(folder/'01.png').save(media/f'{lesson["id"]}.jpg', quality=88, optimize=True)
    (media/f'{lesson["id"]}.vtt').write_text('\n'.join(captions), encoding='utf-8')
    return {'lesson': lesson, 'lang': lang, 'manifest': manifest, 'duration': sum(durations), 'folder': folder, 'media': media}


def render(job):
    lesson, lang = job['lesson'], job['lang']
    output = job['media']/f'{lesson["id"]}.mp4'
    subprocess.run(['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0','-i',str(job['manifest']),'-t',f'{job["duration"]:.6f}','-vf','fps=6','-an','-c:v','libx264','-preset','veryfast','-crf','22','-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(output)],check=True)
    probe=json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(output)]))
    assert len(probe['streams'])==1 and probe['streams'][0]['codec_type']=='video'
    assert probe['streams'][0]['width']==1600 and probe['streams'][0]['height']==900
    duration=float(probe['format']['duration'])
    prefix=f'media/{lang}/{lesson["id"]}'
    print(f'{lang}/{lesson["id"]}: {duration:.1f}s, {output.stat().st_size} bytes, silent',flush=True)
    return lesson['id'], [{'title':lesson['title'],'src':prefix+'.mp4','poster':prefix+'.jpg','duration':duration,'silent':True,'textLanguage':lang,'description':LABELS[lang]['silent'],'tracks':[{'src':prefix+'.vtt','language':lang,'label':LANGUAGE_NAMES[lang]}],'transcript':lesson['segments']}]


def main():
    parser=argparse.ArgumentParser()
    parser.add_argument('--lang',choices=['ar','fr','en'],required=True)
    parser.add_argument('--workers',type=int,default=4)
    parser.add_argument('--only',nargs='*',help='Rerender selected lessons and merge the catalogue')
    args=parser.parse_args()
    lessons=json.loads((ROOT/'content'/'locales'/f'video_scripts_{args.lang}.json').read_text())
    assert len(lessons)==24 and sum(len(l['segments']) for l in lessons)==138
    if args.only:
        assert set(args.only) <= {lesson['id'] for lesson in lessons}
        lessons = [lesson for lesson in lessons if lesson['id'] in args.only]
    lessons = [localize_equation_labels(lesson, args.lang) for lesson in lessons]
    jobs=[prepare(lesson,args.lang) for lesson in lessons]
    sheet=Image.new('RGB',(1200,225*8),'#102c39')
    for i,job in enumerate(jobs):
        thumb=Image.open(job['folder']/'01.png').resize((400,225),Image.Resampling.LANCZOS)
        sheet.paste(thumb,((i%3)*400,(i//3)*225))
    sheet.save(ROOT/'video_build'/f'contact_{args.lang}.jpg',quality=92)
    print(f"{args.lang}: {sum(len(lesson['segments']) for lesson in lessons)} frames prepared",flush=True)
    with concurrent.futures.ThreadPoolExecutor(max_workers=args.workers) as pool:
        catalog=dict(pool.map(render,jobs))
    catalog_path = ROOT/'content'/'locales'/f'video_catalog_{args.lang}.json'
    if args.only and catalog_path.exists():
        previous = json.loads(catalog_path.read_text())
        previous.update(catalog)
        catalog = previous
    catalog_path.write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')


if __name__=='__main__':
    main()
