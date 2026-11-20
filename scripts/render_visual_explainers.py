#!/usr/bin/env python3
"""Render original silent, written step explanations into local MP4 files.

These videos deliberately contain no generated voice or audio stream. Their
visible label and catalogue descriptions say so. Each frame uses exact TeX
math and the authored Darija explanation. No external API is called.
"""
from pathlib import Path
from functools import lru_cache
import argparse
import concurrent.futures
import json
import math
import re
import subprocess

import numpy as np
from PIL import Image, ImageDraw, ImageFont
from matplotlib.mathtext import MathTextParser
from matplotlib.font_manager import FontProperties

ROOT = Path(__file__).resolve().parents[1]
WORK = ROOT / 'video_build'
FRAMES = WORK / 'visual_frames'
MEDIA = ROOT / 'site' / 'media'
FONTS = ROOT / 'tools' / 'fonts'
W, H, FPS = 1600, 900, 12
CREAM = '#f6f2e8'
GOLD = '#efca83'
TEAL = '#7cddc6'
MUTED = '#adbec5'
PARSER = MathTextParser('agg')


@lru_cache(maxsize=80)
def font(size, bold=False, ar=False):
    # DejaVu includes both Arabic and Latin glyphs, so mixed Darija/French
    # sentences do not produce missing-glyph boxes in words such as vecteurs.
    filename = 'DejaVuSans-Bold.ttf' if bold else 'DejaVuSans.ttf'
    return ImageFont.truetype(str(FONTS / filename), size)


def tex_atom(text, pos):
    while pos < len(text) and text[pos].isspace():
        pos += 1
    if text[pos] == '{':
        level, end = 1, pos + 1
        while level:
            if text[end] == '{': level += 1
            elif text[end] == '}': level -= 1
            end += 1
        return text[pos + 1:end - 1], end
    if text[pos] == '\\':
        match = re.match(r'\\[A-Za-z]+|\\.', text[pos:])
        return match[0], pos + len(match[0])
    return text[pos], pos + 1


def normalize_tex(text):
    # Some raw-string authored JSON uses doubled backslashes. No video formula
    # uses a TeX multiline environment, so these are escape normalization only.
    while '\\\\' in text:
        text = text.replace('\\\\', '\\')
    text = text.replace(r'\boxed{', r'\mathbf{')
    text = text.replace(r'\iff', r'\Longleftrightarrow')
    text = re.sub(r'\\(mathbb|mathcal)\s*([A-Z])', r'\\\1{\2}', text)
    text = re.sub(r'(?<!\{)\\prime', r'^{\\prime}', text)
    start = 0
    while True:
        pos = text.find(r'\frac', start)
        if pos < 0: break
        a, end = tex_atom(text, pos + 5)
        b, end = tex_atom(text, end)
        rep = '\\frac{' + a + '}{' + b + '}'
        text = text[:pos] + rep + text[end:]
        start = pos + len(rep)
    return text


@lru_cache(maxsize=200)
def equation_image(tex):
    fixed = normalize_tex(tex)
    result = PARSER.parse('$' + fixed + '$', dpi=160, prop=FontProperties(size=46))
    alpha = Image.fromarray(np.asarray(result.image), 'L')
    rgba = Image.new('RGBA', alpha.size, CREAM)
    rgba.putalpha(alpha)
    if rgba.getbbox(): rgba = rgba.crop(rgba.getbbox())
    scale = min(1.0, 1340 / rgba.width, 195 / rgba.height)
    if scale < 1:
        rgba = rgba.resize((round(rgba.width * scale), round(rgba.height * scale)), Image.Resampling.LANCZOS)
    return rgba


def centered(im, text, y, size=40, color=CREAM, bold=False, ar=False, width=1390):
    d = ImageDraw.Draw(im)
    while size > 20:
        ft = font(size, bold, ar)
        box = d.textbbox((0, 0), text, font=ft, direction='rtl' if ar else 'ltr')
        if box[2] - box[0] <= width: break
        size -= 1
    x = (W - box[2] - box[0]) / 2
    d.text((x, y - box[1]), text, font=ft, fill=color, direction='rtl' if ar else 'ltr')
    return box[3] - box[1]


def wrap(text, size, width=1350):
    d = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    ft = font(size, ar=True)
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if line and d.textlength(trial, font=ft, direction='rtl') > width:
            lines.append(line)
            line = word
        else:
            line = trial
    if line: lines.append(line)
    return lines


def background():
    yy, xx = np.mgrid[0:H, 0:W]
    light = np.exp(-(((xx-W*.42)/(W*.8))**2 + ((yy-H*.25)/(H*.8))**2))
    rgb = np.zeros((H, W, 3), dtype=np.uint8)
    for i, (base, strength) in enumerate(((12, 7), (28, 10), (39, 10))):
        rgb[:, :, i] = base + strength * light
    im = Image.fromarray(rgb).convert('RGBA')
    d = ImageDraw.Draw(im)
    for x in range(0, W, 80): d.line([(x, 0), (x, H)], fill=(33, 53, 66), width=1)
    for y in range(0, H, 80): d.line([(0, y), (W, y)], fill=(33, 53, 66), width=1)
    d.rounded_rectangle((58, 214, W-58, 798), radius=23, fill=(15, 33, 44), outline=(55, 77, 87), width=2)
    return im


BG = background()


def scene(lesson, seg, index):
    im = BG.copy()
    d = ImageDraw.Draw(im)
    d.text((72, 38), 'REGAM  /  ACADEMY', font=font(27, True), fill=GOLD)
    label = 'شرح بصري بلا تعليق صوتي'
    ft = font(27, ar=True)
    box = d.textbbox((0, 0), label, font=ft, direction='rtl')
    d.text((W-73-box[2], 28-box[1]), label, font=ft, fill=MUTED, direction='rtl')
    centered(im, lesson['courseTitle'], 95, 46, GOLD, True)
    centered(im, lesson['title'], 160, 31, MUTED, ar=bool(re.search(r'[\u0600-\u06ff]',lesson['title'])))
    centered(im, f"ÉTAPE {index+1} / {len(lesson['segments'])}", 246, 26, TEAL, True)
    eq = equation_image(seg['equation'])
    im.alpha_composite(eq, (round((W-eq.width)/2), round(386-eq.height/2)))
    centered(im, seg['note'], 525, 32, TEAL, width=1360)
    size = 40
    lines = wrap(seg['text'], size)
    while len(lines) > 3 and size > 31:
        size -= 1
        lines = wrap(seg['text'], size)
    assert len(lines) <= 3, (lesson['id'], index, lines)
    total_height = len(lines) * (size+14)
    top = 672 - total_height / 2
    for k, line in enumerate(lines):
        centered(im, line, top+k*(size+14), size, CREAM, ar=True, width=1370)
    d.line((74, 833, W-74, 833), fill=(53, 77, 90), width=4)
    d.line((74, 833, 74+(W-148)*(index+1)/len(lesson['segments']), 833), fill=TEAL, width=4)
    centered(im, 'Pause et relis chaque étape à ton rythme.', 856, 21, MUTED)
    return im.convert('RGB')


def lessons_data():
    lessons = []
    for filename in ('core_lessons.json','analysis_extra.json','other_lessons.json','sm_lessons.json'):
        for item in json.loads((ROOT/'content'/filename).read_text()):
            if item.get('videoLesson'):
                lessons.append(dict(id=item['id'], courseTitle=item['title'], **item['videoLesson']))
    assert len(lessons) == 24
    return lessons


def prepare(lesson):
    folder = FRAMES / lesson['id']
    folder.mkdir(parents=True, exist_ok=True)
    entries, durations = [], []
    for i, seg in enumerate(lesson['segments']):
        image_path = folder / f'{i+1:02}.png'
        scene(lesson, seg, i).save(image_path)
        # Written explanations are read, not voice-timed. 140 words/minute,
        # plus a brief pause to read the equation, gives 6–12 s per step.
        duration = max(6.5, min(12.5, len(seg['text'].split()) / 2.3 + 2.0))
        durations.append(duration)
        entries.extend([f"file '{image_path.as_posix()}'", f'duration {duration:.6f}'])
    entries.append(f"file '{image_path.as_posix()}'")
    manifest = folder / 'frames.txt'
    manifest.write_text('\n'.join(entries)+'\n')
    first = Image.open(folder/'01.png')
    first.save(MEDIA/f'{lesson["id"]}.jpg', quality=87, optimize=True)
    return dict(lesson=lesson, manifest=manifest, duration=sum(durations))


def render(job):
    lesson = job['lesson']
    output = MEDIA/f'{lesson["id"]}.mp4'
    command = ['ffmpeg','-y','-hide_banner','-loglevel','error','-f','concat','-safe','0',
               '-i',str(job['manifest']),'-t',f'{job["duration"]:.6f}',
               '-vf',f'fps={FPS}', '-an','-c:v','libx264','-preset','veryfast','-crf','23',
               '-threads','2','-pix_fmt','yuv420p','-movflags','+faststart',str(output)]
    subprocess.run(command, check=True)
    probe = json.loads(subprocess.check_output(['ffprobe','-v','error','-show_format','-show_streams','-of','json',str(output)]))
    assert len(probe['streams']) == 1 and probe['streams'][0]['codec_type'] == 'video'
    assert probe['streams'][0]['width'] == W and probe['streams'][0]['height'] == H
    seconds = float(probe['format']['duration'])
    print(f'{lesson["id"]}: {seconds:.2f} s, {output.stat().st_size} bytes, silent', flush=True)
    return lesson['id'], [dict(title=lesson['title']+' · شرح بصري', src=f'media/{output.name}',
                  duration=seconds, poster=f'media/{lesson["id"]}.jpg', silent=True,
                  description='شرح بصري مكتوب خطوة بخطوة، بلا تعليق صوتي. وقف الفيديو فكل مرحلة وقرا المعادلة مع الشرح بالدارجة.')]


def contact_sheet(lessons):
    thumbs = []
    for lesson in lessons:
        candidates = [FRAMES/lesson['id']/f'{i+1:02}.png' for i in (0,len(lesson['segments'])-1)]
        for path in candidates:
            im = Image.open(path).resize((640,360), Image.Resampling.LANCZOS)
            thumbs.append(im)
    sheet = Image.new('RGB', (1280,360*math.ceil(len(thumbs)/2)), '#162d3a')
    for i, im in enumerate(thumbs): sheet.paste(im, ((i%2)*640,(i//2)*360))
    sheet.save(WORK/'visual_contact_sheet.jpg',quality=92)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--frames-only',action='store_true')
    args = parser.parse_args()
    MEDIA.mkdir(parents=True,exist_ok=True)
    lessons = lessons_data()
    jobs = [prepare(lesson) for lesson in lessons]
    contact_sheet(lessons)
    print('All formulas and 138 written frames rendered successfully.', flush=True)
    if args.frames_only: return
    with concurrent.futures.ThreadPoolExecutor(max_workers=3) as executor:
        catalog = dict(executor.map(render,jobs))
    (ROOT/'content'/'video_catalog_extra.json').write_text(json.dumps(catalog,ensure_ascii=False,indent=2)+'\n')
    subprocess.run(['python',str(ROOT/'scripts'/'build_content.py')],check=True)


if __name__ == '__main__':
    main()
