#!/usr/bin/env python3
"""Exact charts and synchronized teaching frames for the function-study module.

All curves are evaluated from the stated functions. No generated illustration
is used for mathematical information. Arabic prose is shaped with Pillow RAQM.
"""
from functools import lru_cache
from io import BytesIO
import math

import matplotlib
matplotlib.use('Agg')
import matplotlib.pyplot as plt
import numpy as np
from PIL import Image, ImageDraw

import render_visual_explainers as drawing

W, H = 1600, 900
NAVY, PANEL = '#0d2433', '#153447'
CREAM, GOLD, TEAL, MUTED, CORAL = '#f7f4ed', '#edcb8e', '#71dec7', '#b5c7cf', '#f59996'
COPY = {
    'ar': {'course': 'دراسة الدوال خطوة بخطوة', 'step': 'الخطوة', 'voice': 'شرح صوتي بالعربية الفصحى', 'pause': 'أوقف الفيديو وحاول حل كل خطوة قبل متابعة التصحيح.'},
    'fr': {'course': 'Étude des fonctions · méthode guidée', 'step': 'ÉTAPE', 'voice': 'Narration en français', 'pause': 'Mettez en pause et essayez chaque étape avant de poursuivre.'},
    'en': {'course': 'Function study · a guided method', 'step': 'STEP', 'voice': 'English narration', 'pause': 'Pause and try each step before continuing with the solution.'},
}
WRITTEN_COPY = {
    'ar': ('دراسة مكتوبة بالعربية الفصحى', 'حاول حل كل خطوة قبل متابعة التصحيح.'),
    'fr': ('Étude écrite en français', 'Essayez chaque étape avant de lire la suite du corrigé.'),
    'en': ('Written study in English', 'Try each step before reading the next part of the solution.'),
}


def centered_text(im, text, y, size, color=CREAM, bold=False, lang='fr', width=1450):
    return drawing.centered(im, text, y, size, color, bold, ar=lang == 'ar', width=width)


def wrap_text(text, width, size, rtl):
    draw = ImageDraw.Draw(Image.new('RGB', (1, 1)))
    font = drawing.font(size)
    lines, line = [], ''
    for word in text.split():
        trial = (line + ' ' + word).strip()
        if line and draw.textlength(trial, font=font, direction='rtl' if rtl else 'ltr') > width:
            lines.append(line)
            line = word
        else:
            line = trial
    if line:
        lines.append(line)
    return lines


def put_formula(im, equation, box):
    eq = drawing.equation_image(equation).copy()
    x, y, width, height = box
    factor = min(1.0, width / eq.width, height / eq.height)
    if factor < 1:
        eq = eq.resize((max(1, round(eq.width * factor)), max(1, round(eq.height * factor))), Image.Resampling.LANCZOS)
    im.alpha_composite(eq, (int(x + (width - eq.width) / 2), int(y + (height - eq.height) / 2)))


def function(kind, x):
    if kind == 'rational':
        return x + 1 + 4 / (x - 1)
    if kind == 'logarithmic':
        return np.log(x) / x
    if kind == 'exponential':
        return (x + 1) * np.exp(-x)
    raise ValueError(f'Unknown function {kind}')


@lru_cache(maxsize=100)
def curve(kind, stage, focus=''):
    fig, ax = plt.subplots(figsize=(7.8, 4.2), dpi=115)
    fig.patch.set_facecolor(PANEL)
    ax.set_facecolor(PANEL)
    settings = {
        'rational': ((-5.8, 7.8), (-10, 14), [(-5.8, .985), (1.015, 7.8)], [(-1, -2), (3, 6)]),
        'logarithmic': ((-.25, 9.0), (-2.2, .65), [(.08, 9)], [(1, 0), (math.e, 1/math.e)]),
        'exponential': ((-1.8, 6), (-3, 1.5), [(-1.8, 6)], [(-1, 0), (0, 1)]),
    }
    xr, yr, domains, points = settings[kind]
    if focus == 'intermediate-values':
        if kind == 'logarithmic':
            xr, yr, domains = ((-.2, 18), (-.12, .5), [(.6, 18)])
        elif kind == 'exponential':
            xr, yr, domains = ((-1.25, 5), (-.15, 1.3), [(-1.25, 5)])
    for low, high in domains:
        x = np.linspace(low, high, 700)
        ax.plot(x, function(kind, x), color=TEAL, linewidth=3, zorder=4)
    ax.axhline(0, color='#92aab5', linewidth=1, alpha=.8)
    ax.axvline(0, color='#92aab5', linewidth=1, alpha=.8)
    if kind == 'rational':
        ax.axvline(1, color=CORAL, linestyle=(0, (5, 4)), linewidth=1.5)
        if stage not in ('curve', 'domain') or focus == 'complete':
            x = np.array(xr)
            ax.plot(x, x+1, color=GOLD, linestyle=(0, (6, 4)), linewidth=1.8)
            ax.text(4.6, 4.2, '$y=x+1$', color=GOLD, fontsize=11)
    elif kind in ('logarithmic', 'exponential'):
        if stage not in ('curve', 'domain') or focus == 'complete':
            ax.axhline(0, color=GOLD, linestyle=(0, (6, 4)), linewidth=1.8)
        if kind == 'logarithmic':
            ax.axvline(0, color=CORAL, linestyle=(0, (5, 4)), linewidth=1.5)
    if stage in ('derivative', 'variation', 'check', 'tangent', 'sign', 'curve'):
        for x, y in points:
            ax.scatter([x], [y], s=42, color=GOLD, zorder=6, edgecolors=NAVY, linewidth=.8)
        if kind == 'rational':
            ax.annotate('$(-1,-2)$', (-1, -2), xytext=(-42, 10), textcoords='offset points', color=GOLD, fontsize=11)
            ax.annotate('$(3,6)$', (3, 6), xytext=(8, 10), textcoords='offset points', color=GOLD, fontsize=11)
        elif kind == 'logarithmic':
            ax.annotate('$(e,1/e)$', (math.e, 1/math.e), xytext=(10, 12), textcoords='offset points', color=GOLD, fontsize=11)
        else:
            ax.annotate('$(0,1)$', (0, 1), xytext=(10, 10), textcoords='offset points', color=GOLD, fontsize=11)
    if stage == 'tangent' or focus == 'complete':
        x = np.linspace(*xr, 500)
        if kind == 'rational':
            y, point = -3*x-3, (0, -3)
        elif kind == 'logarithmic':
            y, point = x-1, (1, 0)
        elif focus == 'at-zero':
            y, point = np.ones_like(x), (0, 1)
        else:
            y, point = (3-x)/math.e, (1, 2/math.e)
        ax.plot(x, y, color=CORAL, linewidth=1.8, label='$T_1$' if kind != 'rational' else '$T_0$')
        ax.scatter(*point, color=CORAL, s=52, zorder=8)
        if kind == 'exponential' and focus == 'complete':
            ax.axhline(1, color='#c3b3f0', linewidth=1.5, label='$T_0$')
        if focus == 'complete':
            ax.legend(facecolor=PANEL, edgecolor='#34576a', labelcolor=CREAM, fontsize=10, loc='lower right')
            if kind == 'rational':
                ax.annotate('$C(0,-3)$', (0, -3), xytext=(-74, -29), textcoords='offset points', color=CORAL, fontsize=10, bbox={'facecolor':PANEL,'edgecolor':'none','alpha':.9,'pad':1.5})
    if focus == 'inflection' or (focus == 'complete' and kind in ('logarithmic', 'exponential')):
        point = (math.exp(1.5), 1.5/math.exp(1.5)) if kind == 'logarithmic' else (1, 2/math.e)
        ax.scatter(*point, color=CORAL, s=52, zorder=8)
        ax.annotate('$I$', point, xytext=(8, -16), textcoords='offset points', color=CORAL, fontsize=13)
    if focus in ('horizontal-intersections', 'intermediate-values'):
        if kind == 'rational':
            level, intersections = 8, [4-math.sqrt(5), 4+math.sqrt(5)]
            label = '$y=8$'
        else:
            level = 1/(2*math.e) if kind == 'logarithmic' else .5
            brackets = [(1, math.e), (math.e, 18)] if kind == 'logarithmic' else [(-1, 0), (0, 5)]
            intersections = []
            for lo, hi in brackets:
                for _ in range(55):
                    mid = (lo+hi)/2
                    if (float(function(kind, lo))-level)*(float(function(kind, mid))-level) <= 0:
                        hi = mid
                    else:
                        lo = mid
                intersections.append((lo+hi)/2)
            label = '$y=1/(2e)$' if kind == 'logarithmic' else '$y=1/2$'
        ax.axhline(level, color=CORAL, linewidth=1.6, linestyle=(0, (3, 3)))
        ax.scatter(intersections, [level]*len(intersections), color=CORAL, s=45, zorder=9)
        ax.text(xr[1]*.65, level+(yr[1]-yr[0])*.035, label, color=CORAL, fontsize=11)
    ax.set_xlim(*xr)
    ax.set_ylim(*yr)
    ax.grid(color='#426074', alpha=.4, linewidth=.6)
    ax.tick_params(colors=MUTED, labelsize=10)
    for spine in ax.spines.values():
        spine.set_color('#456274')
    ax.set_xlabel('$x$', color=CREAM, fontsize=13, labelpad=0)
    ax.set_ylabel('$y$', color=CREAM, fontsize=13, rotation=0, labelpad=10)
    fig.tight_layout(pad=1.1)
    buffer = BytesIO()
    fig.savefig(buffer, format='png', facecolor=PANEL)
    plt.close(fig)
    return Image.open(buffer).convert('RGBA')


def variation_table(im, kind, top=365):
    """A table separates the rational function's two branches at x = 1."""
    draw = ImageDraw.Draw(im)
    left, right, bottom = 95, 1505, 620
    draw.rounded_rectangle((left, top, right, bottom), 18, fill=PANEL, outline='#527180', width=2)
    label_right = left + 140
    row_y = [top+42, top+115, top+205]
    for y in (top+78, top+151):
        draw.line((left, y, right, y), fill='#527180', width=1)
    draw.line((label_right, top, label_right, bottom), fill='#527180', width=1)
    symbol = {'rational':'f','logarithmic':'g','exponential':'h'}[kind]
    for label, y in zip(['x', symbol+r'^{\prime}(x)', symbol+'(x)'], row_y):
        put_formula(im, label, (left+10, y-24, 120, 48))
    if kind == 'rational':
        knots = [r'-\infty', '-1', '1', '3', r'+\infty']
        values = [r'-\infty', '-2', r'-\infty\;\Vert\;+\infty', '6', r'+\infty']
        signs, arrows, zero_indices, forbidden = ['+', '-', '-', '+'], ['up', 'down', 'down', 'up'], [1, 3], 2
    elif kind == 'logarithmic':
        knots, values = [r'0^{+}', 'e', r'+\infty'], [r'-\infty', r'1/e', '0']
        signs, arrows, zero_indices, forbidden = ['+', '-'], ['up', 'down'], [1], None
    else:
        knots, values = [r'-\infty', '0', r'+\infty'], [r'-\infty', '1', '0']
        signs, arrows, zero_indices, forbidden = ['+', '-'], ['up', 'down'], [1], None
    positions = np.linspace(label_right+95, right-95, len(knots))
    for i, (x, knot, value) in enumerate(zip(positions, knots, values)):
        put_formula(im, knot, (x-80, row_y[0]-25, 160, 50))
        put_formula(im, value, (x-105, row_y[2]-27, 210, 54))
        if i in zero_indices:
            put_formula(im, '0', (x-20, row_y[1]-20, 40, 40))
        if i == forbidden:
            for offset in (-4, 4):
                draw.line((int(x+offset), top+80, int(x+offset), top+150), fill=CORAL, width=3)
    for i, (sign, arrow) in enumerate(zip(signs, arrows)):
        x = (positions[i]+positions[i+1])/2
        put_formula(im, sign, (x-30, row_y[1]-22, 60, 44))
        put_formula(im, r'\nearrow' if arrow == 'up' else r'\searrow', (x-45, row_y[2]-22, 90, 44))


def frame(video, translation, segment, index, lang, written=False):
    im = Image.new('RGBA', (W, H), NAVY)
    draw = ImageDraw.Draw(im)
    draw.text((62, 30), 'REGAM / ACADEMY', font=drawing.font(25, True), fill=GOLD)
    voice = WRITTEN_COPY[lang][0] if written else COPY[lang]['voice']
    font = drawing.font(22)
    bbox = draw.textbbox((0, 0), voice, font=font, direction='rtl' if lang == 'ar' else 'ltr')
    draw.text((1538-bbox[2], 30-bbox[1]), voice, font=font, fill=MUTED, direction='rtl' if lang == 'ar' else 'ltr')
    centered_text(im, translation['title'], 89, 43, GOLD, True, lang)
    centered_text(im, COPY[lang]['course'], 151, 25, MUTED, False, lang)
    count = len(translation['segments'])
    step_label = f"الخطوة {index+1} من {count} · {segment['note']}" if lang == 'ar' else f"{COPY[lang]['step']} {index+1:02} / {count:02} · {segment['note']}"
    centered_text(im, step_label, 196, 26, TEAL, False, lang)
    stage = segment.get('visual', 'curve')
    focus = segment.get('focus', '')
    kind = video['topic']
    if stage == 'variation' or (stage == 'sign' and focus != 'function'):
        put_formula(im, segment['equation'], (100, 245, 1400, 100))
        variation_table(im, kind)
    else:
        draw.rounded_rectangle((60, 248, 735, 624), 20, fill=PANEL, outline='#34576a', width=1)
        put_formula(im, segment['equation'], (90, 290, 615, 180))
        put_formula(im, video['functionLatex'], (125, 515, 545, 72))
        plot = curve(kind, stage, focus).resize((790, 424), Image.Resampling.LANCZOS)
        im.alpha_composite(plot, (752, 231))
    size = 31
    lines = wrap_text(segment['text'], 1430, size, lang == 'ar')
    while len(lines) > 4 and size > 24:
        size -= 1
        lines = wrap_text(segment['text'], 1430, size, lang == 'ar')
    if len(lines) > 4:
        raise ValueError(f"Narration text overflows: {video['id']}/{lang}/{index}")
    first_y = 726 - len(lines) * (size+9) / 2
    for j, line in enumerate(lines):
        centered_text(im, line, first_y+j*(size+9), size, CREAM, False, lang)
    draw.line((65, 830, 1535, 830), fill='#34576a', width=4)
    draw.line((65, 830, 65+1470*(index+1)/count, 830), fill=TEAL, width=4)
    centered_text(im, WRITTEN_COPY[lang][1] if written else COPY[lang]['pause'], 854, 21, MUTED, False, lang)
    return im.convert('RGB')
