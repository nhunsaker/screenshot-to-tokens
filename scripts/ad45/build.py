#!/usr/bin/env python3
"""Assemble the Screenshot to Tokens promo ad (spec: spec/metatoy-studio/hackathons/ad-45s-script.md, B + C).

Run scripts/ad45/audio_prep.py and node scripts/ad45/render-end-card.mjs first, and fetch the music bed to
out/ad45/work/music.mp3 (ElevenLabs POST /v1/music). Then:  python3 scripts/ad45/build.py [stage ...]
Stages: mix, overlays, segments, final, sheet (default: all). One ffmpeg job at a time.

The picture follows the voice: each shot's slot = its VO clip(s) + 0.4 s per clip (0.2 s lead-in, 0.2 s tail); the
end card holds vo-8 + 1.5 s. 0.3 s crossfades start at each slot boundary, so shot-local time = global - slot start.
"""
import json, os, re, subprocess, sys
from PIL import Image, ImageDraw, ImageFont

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
A = os.path.join(ROOT, 'out/ad45'); W = os.path.join(A, 'work'); SH = os.path.join(A, 'shots')
VO = json.load(open(os.path.join(W, 'vo.json')))
FPS = 24; XF = 0.3; LEAD = 0.15; GAP = 0.3

# ---------------------------------------------------------------- timeline
SHOT_CLIPS = [['n1'], ['n2'], ['n3'], ['n4'], ['n5', 'req', 'n6'], ['n7'], ['n8']]
SLOTS, VOICE_AT = [], {}  # VOICE_AT[clip] = (shot index, shot-local start)
for i, clips in enumerate(SHOT_CLIPS):
    t = LEAD
    for c in clips:
        VOICE_AT[c] = (i, t); t += VO[c]['dur'] + GAP
    SLOTS.append(round(t - LEAD + (1.5 if i == 6 else 0), 3))
START = [round(sum(SLOTS[:i]), 3) for i in range(len(SLOTS))]
TOTAL = round(sum(SLOTS), 3)

def at(clip, t=0.0):
    """shot-local time of offset t inside a voice clip"""
    return VOICE_AT[clip][1] + t

def speech_after(clip, k):
    """shot-local start of the k-th speech run (after the k-th internal silence)"""
    return at(clip, VO[clip]['silences'][k - 1][1]) if k else at(clip)

def speech_end(clip):
    return at(clip, VO[clip]['dur'] - 0.15)

# ---------------------------------------------------------------- aspects
ASPECTS = {
    '16x9': dict(w=1920, h=1080, fs=34, big=52, cap=40, cap_bottom=60, cap_maxw=0.80),
    '1x1': dict(w=1080, h=1080, fs=32, big=46, cap=38, cap_bottom=60, cap_maxw=0.90),
    '9x16': dict(w=1080, h=1920, fs=40, big=58, cap=46, cap_bottom=330, cap_maxw=0.88),
}
REAL5 = dict(src=os.path.join(ROOT, 'out/video/final.mp4'), t0=86.6)
# Crop for the real footage (source px, 1920x1080): drops the take's top caption pill; 1x1/9x16 keep the panel.
REAL5_CROP = {'16x9': (0, 100, 1742, 980), '1x1': (0, 100, 980, 980), '9x16': (10, 100, 551, 980)}
# Generated shots: horizontal centre (in 1920-wide frame px) of the fill-crop for 1x1 / 9x16.
CX = {1: (860, 860), 2: (900, 700), 3: (960, 960), 4: (1120, 940), 6: (900, 900)}

# ---------------------------------------------------------------- overlays
INDIGO = (94, 114, 228); WHITE = (255, 255, 255); MONO = (176, 188, 255); GREEN = (126, 226, 168); MUTED = (200, 200, 196)
SF = '/System/Library/Fonts/SFNS.ttf'; SFM = '/System/Library/Fonts/SFNSMono.ttf'

def font(size, mono=False, weight='Semibold'):
    f = ImageFont.truetype(SFM if mono else SF, size)
    try: f.set_variation_by_name(weight if not mono else 'Medium')
    except Exception as e: pass
    return f

def N(s): return (s, INDIGO, False)   # number run
def T(s): return (s, WHITE, False)
def M(s): return (s, MONO, True)
def G(s): return (s, GREEN, False)

# Each overlay: shot, t0, t1 (shot-local, None = slot end), runs, size key, pos per aspect (x frac, y frac, align)
def overlays():
    O = []
    def add(shot, t0, t1, runs, size, pos, **kw):
        O.append(dict(shot=shot, t0=t0, t1=t1, runs=runs, size=size, pos=pos, **kw))
    # shot 1: the problem
    add(0, 1.0, None, [('■ ', INDIGO, False), N('#5e72e4')], 'big', {'16x9': (0.60, 0.36, 'l'), '1x1': (0.70, 0.34, 'l'), '9x16': (0.5, 0.30, 'c')})
    add(0, 2.1, None, [T('?')], 'huge', {'16x9': (0.60, 0.48, 'l'), '1x1': (0.70, 0.46, 'l'), '9x16': (0.5, 0.40, 'c')})
    # shot 2: SAM 3.1 sees the buttons (clip slowed to 0.8x: outlines bloom about 3.1 to 5.2 s)
    add(1, 0.9, 5.2, [N('0 of 8'), T(' from the code')], 'big', {'16x9': (0.04, 0.74, 'l'), '1x1': (0.05, 0.72, 'l'), '9x16': (0.5, 0.64, 'c')})
    add(1, 5.3, None, [N('8 of 8'), T(' from the pixels')], 'big', {'16x9': (0.04, 0.74, 'l'), '1x1': (0.05, 0.72, 'l'), '9x16': (0.5, 0.64, 'c')})
    add(1, speech_after('n2', 1), None, [T('SAM 3.1')], 'fs', {'16x9': (0.96, 0.06, 'r'), '1x1': (0.95, 0.06, 'r'), '9x16': (0.94, 0.12, 'r')})
    # shot 3: Muse Spark names the values (rows: bottom, middle, top)
    # rows in the generated shot: top shelf (left, high), middle shelf (right), bottom shelf (wide, low)
    for (k, pos, runs) in [
            (1, {'16x9': (0.03, 0.64, 'l'), '1x1': (0.5, 0.66, 'c'), '9x16': (0.5, 0.63, 'c')}, [M('color.blue.500'), T(' · the raw value')]),
            (2, {'16x9': (0.03, 0.47, 'l'), '1x1': (0.03, 0.44, 'l'), '9x16': (0.5, 0.45, 'c')}, [M('color.action.primary'), T(' · what it means')]),
            (3, {'16x9': (0.97, 0.06, 'r'), '1x1': (0.5, 0.035, 'c'), '9x16': (0.5, 0.08, 'c')}, [M('button.bg'), T(' · where it’s used')])]:
        add(2, speech_after('n3', k) - 0.1, None, runs, 'fs', pos)
    add(2, speech_after('n3', 4), None, [T('named by Muse Spark · '), N('3 to 5 s')], 'fs', {'16x9': (0.03, 0.06, 'l'), '1x1': (0.5, 0.76, 'c'), '9x16': (0.5, 0.72, 'c')})
    # shot 4: the rewrite and the four checks
    add(3, 1.0, None, [M('var(--button-bg, '), ('#5e72e4', INDIGO, True), M(')')], 'fs', {'16x9': (0.5, 0.035, 'c'), '1x1': (0.5, 0.035, 'c'), '9x16': (0.5, 0.10, 'c')})
    c0 = speech_after('n4', 2)
    for j, runs in enumerate([[G('✓ '), N('0 px'), T(' changed')], [G('✓ '), T('colors merged')], [G('✓ '), T('cleanup shown')], [G('✓ '), T('no text harder to read')]]):
        add(3, c0 + 0.35 * j, None, runs, 'fs', {'16x9': (0.03, 0.36 + 0.085 * j, 'l'), '1x1': (0.04, 0.44 + 0.075 * j, 'l'), '9x16': (0.06, 0.44 + 0.05 * j, 'l')})
    add(3, speech_end('n4') - 0.9, None, [T('Pull request')], 'big', {'16x9': (0.82, 0.46, 'c'), '1x1': (0.87, 0.30, 'c'), '9x16': (0.06, 0.645, 'l')})
    # shot 5: point and say (real footage)
    add(4, at('req') - 0.1, speech_end('req') + 0.2, [T('Meta’s speech model')], 'fs', {'16x9': (0.5, 0.78, 'c'), '1x1': (0.5, 0.74, 'c'), '9x16': (0.5, 0.71, 'c')})
    add(4, at('req') - 0.1, speech_end('req') + 0.2, [T('“This label is too light. Make it readable, keep our gray.”')], 'cap', {'16x9': 'cap', '1x1': 'cap', '9x16': 'cap'}, caption=True)
    add(4, speech_after('n6', 2) - 0.1, None, [N('21'), T(' labels · '), N('2.95:1 → 4.53:1')], 'big', {'16x9': (0.69, 0.30, 'c'), '1x1': (0.5, 0.68, 'c'), '9x16': (0.5, 0.640, 'c')})
    add(4, speech_after('n6', 4) - 0.1, None, [T('checked across the whole page · nothing got worse')], 'fs', {'16x9': (0.69, 0.41, 'c'), '1x1': (0.5, 0.76, 'c'), '9x16': (0.5, 0.688, 'c')})
    # shot 6: proof, then the block
    add(5, 0.4, speech_after('n7', 2) - 0.4, [N('28'), T(' public sites · '), N('0 px'), T(' changed')], 'big', {'16x9': (0.5, 0.08, 'c'), '1x1': (0.5, 0.08, 'c'), '9x16': (0.5, 0.14, 'c')})
    add(5, speech_after('n7', 2) + 1.0, None, [T('Asked for red buttons. Blocked: the text would be harder to read.')], 'big', sub=[T('Nothing changed.')], pos={'16x9': (0.5, 0.38, 'c'), '1x1': (0.5, 0.36, 'c'), '9x16': (0.5, 0.36, 'c')})
    # captions (narrator lines; the request has its own caption above; the end card says vo-8 on screen)
    CAP = [('n1', [(0, 'Every color in your app is a number nobody can explain.')]),
           ('n2', [(0, 'Screenshot to Tokens starts from the pixels.'), (1, 'SAM 3.1 finds the buttons your code never describes.')]),
           ('n3', [(0, 'Muse Spark names every value:'), (1, 'the raw color, what it means, where it’s used.'), (4, 'In seconds.')]),
           ('n4', [(0, 'Your source becomes tokens, originals kept as fallbacks,'), (2, 'and four checks prove the rewrite changed nothing.')]),
           ('n5', [(0, 'Then point at a label and say it.')]),
           ('n6', [(0, 'The app hears you, finds what you pointed at,'), (2, 'and fixes that label everywhere it appears.'), (4, 'Every change is checked across the whole page before it’s kept.')]),
           ('n7', [(0, 'We tested it on twenty-eight real sites we didn’t build.'), (1, 'Zero pixels changed.'), (2, 'And if a change would make anything harder to read,'), (3, 'it’s blocked.')])]
    for clip, parts in CAP:
        shot = VOICE_AT[clip][0]
        for j, (k, text) in enumerate(parts):
            t0 = speech_after(clip, k) - 0.05
            t1 = speech_after(clip, parts[j + 1][0]) - 0.1 if j + 1 < len(parts) else speech_end(clip) + 0.25
            add(shot, t0, t1, [T(text)], 'cap', {'16x9': 'cap', '1x1': 'cap', '9x16': 'cap'}, caption=True)
    return O

def wrap_runs(runs, f_of, maxw, draw):
    """split runs into lines on spaces so each line fits maxw"""
    words = []
    for s, c, mono in runs:
        for i, wd in enumerate(re.split(r'(?<= )', s)):
            if wd: words.append((wd, c, mono))
    lines, cur, cw = [], [], 0
    for wd, c, mono in words:
        w = draw.textlength(wd, font=f_of(mono))
        if cur and cw + w > maxw and wd.strip():
            lines.append(cur); cur, cw = [], 0
        cur.append((wd, c, mono)); cw += w
    if cur: lines.append(cur)
    return lines

def render_overlay(o, asp, cfg, path):
    size = {'fs': cfg['fs'], 'big': cfg['big'], 'cap': cfg['cap'], 'huge': int(cfg['big'] * 2.2)}[o['size']]
    fonts = {False: font(size), True: font(int(size * 0.92), mono=True)}
    f_of = lambda m: fonts[m]
    scratch = ImageDraw.Draw(Image.new('RGBA', (8, 8)))
    padx, pady = int(size * 0.55), int(size * 0.32)
    maxw = cfg['w'] * (cfg['cap_maxw'] if o.get('caption') else 0.9) - 2 * padx
    lines = wrap_runs(o['runs'], f_of, maxw, scratch); nmain = len(lines)
    sfonts = {False: font(int(size * 0.72)), True: font(int(size * 0.66), mono=True)}
    if o.get('sub'): lines += wrap_runs(o['sub'], lambda m: sfonts[m], maxw, scratch)
    fl = lambda li, m: (fonts if li < nmain else sfonts)[m]
    asc, desc = fonts[False].getmetrics(); lh = int((asc + desc) * 1.12)
    sasc, sdesc = sfonts[False].getmetrics(); slh = int((sasc + sdesc) * 1.25)
    lw = [sum(scratch.textlength(s.rstrip() if k == len(l) - 1 else s, font=fl(li, m)) for k, (s, c, m) in enumerate(l)) for li, l in enumerate(lines)]
    bw, bh = int(max(lw)) + 2 * padx, lh * nmain + slh * (len(lines) - nmain) + 2 * pady - int(lh * 0.12) + (int(size * 0.2) if len(lines) > nmain else 0)
    im = Image.new('RGBA', (bw, bh), (0, 0, 0, 0)); d = ImageDraw.Draw(im)
    alpha = 153 if o.get('caption') else 225
    d.rounded_rectangle([0, 0, bw - 1, bh - 1], radius=int(size * 0.38), fill=(17, 17, 17, alpha))
    for li, l in enumerate(lines):
        x = padx + (max(lw) - lw[li]) / 2 if o.get('caption') or len(lines) > 1 else padx
        y = pady + min(li, nmain) * lh + max(0, li - nmain) * slh + (int(size * 0.2) if li >= nmain else 0)
        for k, (s, c, m) in enumerate(l):
            f = fl(li, m); yy = y + ((asc if li < nmain else sasc) - f.getmetrics()[0])
            d.text((x, yy), s, font=f, fill=c + (255,)); x += d.textlength(s, font=f)
    im.save(path)
    if o['pos'][asp] == 'cap':
        x, y = (cfg['w'] - bw) // 2, cfg['h'] - cfg['cap_bottom'] - bh
    else:
        fx, fy, al = o['pos'][asp]
        x = int(fx * cfg['w'] - {'l': 0, 'c': bw / 2, 'r': bw}[al]); y = int(fy * cfg['h'])
        x = max(16, min(cfg['w'] - bw - 16, x))
    return x, y

def stage_overlays():
    meta = {}
    for asp, cfg in ASPECTS.items():
        items = []
        for n, o in enumerate(overlays()):
            p = os.path.join(W, f'ov-{asp}-{n:02d}.png'); x, y = render_overlay(o, asp, cfg, p)
            t1 = o['t1'] if o['t1'] is not None else SLOTS[o['shot']] - 0.05
            items.append(dict(png=p, x=x, y=y, t0=round(START[o['shot']] + o['t0'], 3), t1=round(START[o['shot']] + t1, 3)))
        meta[asp] = items
    json.dump(meta, open(os.path.join(W, 'overlays.json'), 'w'), indent=1)
    print('overlays', {k: len(v) for k, v in meta.items()})

# ---------------------------------------------------------------- picture segments
def run(cmd):
    r = subprocess.run(cmd, capture_output=True, text=True)
    if r.returncode: print(' '.join(cmd)); print(r.stderr[-3000:]); sys.exit(1)
    return r

def fill(asp, cfg, cx):
    """filter to fit a 1920x1080 picture to the aspect: 16x9 as is, else scale to fill height and crop around cx"""
    if asp == '16x9': return ''
    s = cfg['h'] / 1080; cw = cfg['w'] / s
    x0 = max(0, min(1920 - cw, cx - cw / 2)) * s
    return f',scale=-2:{cfg["h"]}:flags=lanczos,crop={cfg["w"]}:{cfg["h"]}:{int(x0)}:0'

def seg_filter(i, asp, cfg, L):
    up = 'scale=1920:1080:flags=lanczos'
    cx = CX.get(i + 1, (960, 960))[0 if asp == '1x1' else 1]
    if i == 0:  # shot 1: trim
        return f'[0:v]trim=0:{L},setpts=PTS-STARTPTS,fps={FPS},{up}{fill(asp, cfg, cx)}'
    if i in (1, 2, 3):  # 10 s clips; shot 2 slowed to 0.8x so the outlines land on "SAM 3.1 finds the buttons"
        slow = 'setpts=1.25*PTS,' if i == 1 else ''
        return f'[0:v]{slow}fps={FPS},trim=0:{L},setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={L},trim=0:{L},{up}{fill(asp, cfg, cx)}'
    if i == 5:  # shot 6b: 0.8x, with a hold on the checked grid (native 1.3 s) before the red card lands
        hold = min(2.4, max(0.0, L - (5.04 * 1.25)))
        return (f'[0:v]setpts=1.25*PTS,fps={FPS},split[a][b];[a]trim=0:1.625,setpts=PTS-STARTPTS,tpad=stop_mode=clone:stop_duration={hold:.3f}[a2];'
                f'[b]trim=start=1.625,setpts=PTS-STARTPTS[b2];[a2][b2]concat=n=2:v=1,tpad=stop_mode=clone:stop_duration=4,trim=0:{L},setpts=PTS-STARTPTS,{up}{fill(asp, cfg, cx)}')
    raise ValueError(i)

def stage_segments():
    only = [int(x) for x in os.environ.get('AD_SEGS', '0123456')]
    for asp, cfg in ASPECTS.items():
        for i in only:
            L = round(SLOTS[i] + (XF if i < 6 else 0), 3)
            out = os.path.join(W, f'seg-{asp}-{i}.mp4')
            enc = ['-an', '-c:v', 'libx264', '-preset', 'fast', '-crf', '12', '-pix_fmt', 'yuv420p', '-r', str(FPS), out]
            if i == 4:
                cx, cy, cw, ch = REAL5_CROP[asp]
                vf = f'[0:v]fps={FPS},crop={cw}:{ch}:{cx}:{cy},scale={cfg["w"]}:{cfg["h"]}:flags=lanczos,setsar=1'
                cmd = ['ffmpeg', '-v', 'error', '-y', '-ss', str(REAL5['t0']), '-t', str(L), '-i', REAL5['src'], '-filter_complex', vf] + enc
            elif i == 6:
                png = os.path.join(W, f'end-{asp}.png')
                vf = f'color=c=0x151514:s={cfg["w"]}x{cfg["h"]}:r={FPS}:d={L}[bg];[0:v]format=rgba,fade=t=in:st=0:d=1:alpha=1[c];[bg][c]overlay=0:0:shortest=1,format=yuv420p'
                cmd = ['ffmpeg', '-v', 'error', '-y', '-loop', '1', '-framerate', str(FPS), '-t', str(L), '-i', png, '-filter_complex', vf] + enc
            else:
                src = os.path.join(SH, {0: 'shot-1.mp4', 1: 'shot-2.mp4', 2: 'shot-3.mp4', 3: 'shot-4.mp4', 5: 'shot-6b.mp4'}[i])
                cmd = ['ffmpeg', '-v', 'error', '-y', '-i', src, '-filter_complex', seg_filter(i, asp, cfg, L) + ',setsar=1'] + enc
            run(cmd)
            d = float(run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).stdout)
            print('seg', asp, i, 'want', L, 'got', round(d, 3))

# ---------------------------------------------------------------- audio
def tone(path, expr, d):
    run(['ffmpeg', '-v', 'error', '-y', '-f', 'lavfi', '-i', f"aevalsrc='{expr}':s=48000:d={d}", '-c:a', 'pcm_f32le', path])

def stage_mix():
    click = os.path.join(W, 'sfx-click.wav'); tick = os.path.join(W, 'sfx-tick.wav')
    tone(click, '0.5*sin(2*PI*1800*t)*exp(-t*90)+0.3*sin(2*PI*900*t)*exp(-t*60)', 0.08)
    tone(tick, '0.45*sin(2*PI*1046.5*t)*exp(-t*18)+0.25*sin(2*PI*1568*t)*exp(-t*22)', 0.35)
    ins, parts = [], []
    order = ['n1', 'n2', 'n3', 'n4', 'n5', 'req', 'n6', 'n7', 'n8']
    for k, c in enumerate(order):
        shot, t = VOICE_AT[c]; ms = int(round((START[shot] + t) * 1000))
        ins += ['-i', os.path.join(W, f'{c}.wav')]; parts.append(f'[{k}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,adelay={ms}|{ms}[v{k}]')
    nv = len(order)
    ins += ['-i', os.path.join(W, 'music.mp3'), '-i', click, '-i', tick]
    click_ms = int((START[0] + 1.0) * 1000); tick_ms = int((START[4] + speech_after('n6', 2)) * 1000)
    fade_st = TOTAL - 2.0
    g = ';'.join(parts) + ';' + ''.join(f'[v{k}]' for k in range(nv)) + f'amix=inputs={nv}:normalize=0,apad=whole_dur={TOTAL}[voice];'
    g += '[voice]asplit[vo][sc];'
    # music: about 20 dB under the voice, ducked further while the voice speaks, fade out over the last 2 s
    g += f'[{nv}:a]aresample=48000,volume=-21dB,atrim=0:{TOTAL},apad=whole_dur={TOTAL},afade=t=out:st={fade_st:.3f}:d=2[mu];'
    g += '[mu][sc]sidechaincompress=threshold=0.02:ratio=4:attack=20:release=400:makeup=1[mud];'
    g += f'[{nv+1}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=-26dB,adelay={click_ms}|{click_ms}[ck];'
    g += f'[{nv+2}:a]aresample=48000,pan=stereo|c0=c0|c1=c0,volume=-24dB,adelay={tick_ms}|{tick_ms}[tk];'
    g += f'[vo][mud][ck][tk]amix=inputs=4:normalize=0:duration=first,atrim=0:{TOTAL},alimiter=limit=0.6:level=false[pre]'
    pre = os.path.join(W, 'mix-pre.wav')
    run(['ffmpeg', '-v', 'error', '-y'] + ins + ['-filter_complex', g, '-map', '[pre]', '-c:a', 'pcm_f32le', '-ar', '48000', pre])
    e = run(['ffmpeg', '-hide_banner', '-nostats', '-i', pre, '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-']).stderr
    m = json.loads(e[e.rindex('{'):e.rindex('}') + 1])
    ln = (f"loudnorm=I=-16:TP=-1.5:LRA=11:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}"
          f":measured_thresh={m['input_thresh']}:offset={m['target_offset']}:linear=true:print_format=json")
    master = os.path.join(W, 'master.wav')
    e2 = run(['ffmpeg', '-hide_banner', '-nostats', '-y', '-i', pre, '-af', ln + ',aresample=48000', '-c:a', 'pcm_f32le', master]).stderr
    m2 = json.loads(e2[e2.rindex('{'):e2.rindex('}') + 1])
    json.dump({'pass1': m, 'pass2': m2, 'slots': SLOTS, 'start': START, 'total': TOTAL}, open(os.path.join(W, 'mix.json'), 'w'), indent=1)
    print('mix', 'in', m['input_i'], 'out', m2['output_i'], 'tp', m2['output_tp'], 'type', m2['normalization_type'])

# ---------------------------------------------------------------- final
def stage_final():
    meta = json.load(open(os.path.join(W, 'overlays.json')))
    for asp, cfg in ASPECTS.items():
        if asp not in os.environ.get('AD_ASPECTS', '16x9 1x1 9x16').split(): continue
        ins = []
        for i in range(7): ins += ['-i', os.path.join(W, f'seg-{asp}-{i}.mp4')]
        g, prev = [], '[0:v]'
        for i in range(1, 7):
            g.append(f'{prev}[{i}:v]xfade=transition=fade:duration={XF}:offset={START[i]:.3f}[x{i}]'); prev = f'[x{i}]'
        k = 7
        for j, o in enumerate(meta[asp]):
            ins += ['-loop', '1', '-framerate', str(FPS), '-t', f'{o["t1"]:.3f}', '-i', o['png']]
            g.append(f'[{k}:v]format=rgba,fade=t=in:st={o["t0"]:.3f}:d=0.2:alpha=1,fade=t=out:st={o["t1"]-0.2:.3f}:d=0.2:alpha=1[o{j}]')
            g.append(f'{prev}[o{j}]overlay={o["x"]}:{o["y"]}:eof_action=pass:enable=\'between(t,{o["t0"]:.3f},{o["t1"]:.3f})\'[p{j}]'); prev = f'[p{j}]'; k += 1
        g.append(f'{prev}tpad=stop_mode=clone:stop_duration=0.1,format=yuv420p[vout]')
        ins += ['-i', os.path.join(W, 'master.wav')]
        out = os.path.join(A, f'ad-{asp}.mp4')
        run(['ffmpeg', '-v', 'error', '-y'] + ins + ['-filter_complex', ';'.join(g), '-map', '[vout]', '-map', f'{k}:a',
             '-c:v', 'libx264', '-preset', 'slow', '-crf', '17', '-r', str(FPS), '-pix_fmt', 'yuv420p', '-movflags', '+faststart',
             '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-t', f'{TOTAL:.3f}', out])
        print('final', asp, run(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', out]).stdout.strip())

def stage_sheet():
    """contact sheet of the 16x9 cut: 3 frames per shot (25%, 55%, 90% of each slot), labelled under each frame"""
    asp = os.environ.get('AD_SHEET', '16x9'); cfg = ASPECTS[asp]
    src = os.path.join(A, f'ad-{asp}.mp4'); tiles = []
    for i, s in enumerate(SLOTS):
        for f in (0.25, 0.55, 0.9):
            t = START[i] + s * f; p = os.path.join(W, f'sheet-{asp}-{i}-{int(f*100)}.png')
            run(['ffmpeg', '-v', 'error', '-y', '-ss', f'{t:.3f}', '-i', src, '-frames:v', '1', '-vf', f'scale={640 if asp == "16x9" else 400}:-2', p])
            tiles.append((p, f'shot {i+1} · {t:.1f} s'))
    cols, lab = 3, 34; tw = 640 if asp == '16x9' else 400; th = int(tw * cfg['h'] / cfg['w'])
    sheet = Image.new('RGB', (cols * tw, (len(tiles) // cols) * (th + lab)), (21, 21, 20)); d = ImageDraw.Draw(sheet); f = font(22)
    for n, (p, label) in enumerate(tiles):
        x, y = (n % cols) * tw, (n // cols) * (th + lab)
        sheet.paste(Image.open(p).convert('RGB'), (x, y)); d.text((x + 10, y + th + 5), label, font=f, fill=(230, 230, 226))
    sheet.save(os.path.join(A, 'ad-contact.png') if asp == '16x9' else os.path.join(W, f'contact-{asp}.png')); print('sheet', len(tiles))

if __name__ == '__main__':
    print('slots', SLOTS, 'start', START, 'total', TOTAL)
    stages = sys.argv[1:] or ['mix', 'overlays', 'segments', 'final', 'sheet']
    for s in stages: globals()['stage_' + s]()
