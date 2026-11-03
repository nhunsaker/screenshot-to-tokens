#!/usr/bin/env python3
# The final cut with the founder's own voice (2026-11-03). Run from the repo root: `python3 scripts/mix_final.py`.
# Inputs:
#   ~/Movies/2026-11-03 HH-MM-SS.mov   the founder's OBS recordings (read-only; the kept ones are copied to
#                                      out/video/founder/src/). Take 01 is an OBS composite (title + camera rectangle);
#                                      the rest are voice only (black picture).
#   out/video/founder/transcripts.json  scripts/founder-transcribe.mjs (Meta's speech model, store:false)
#   out/video/beat-0.webm              node scripts/record-beats.mjs --only 0 --v3 --title-ms 34000 (title card with the
#                                      Oct 26 to Nov 3 disclosure and the payoff loop)
#   n1..n5, n6, n7, n9-v2, beat-13, beat-8, beat-6-pas-v1/v2 + beat-6-pas-v3.json   the v3 picture (scripts/mix_v3.py)
# Every take: the kept read (edits cut stumbles out), highpass 70 Hz, light afftdn, pauses inside a line over MAXP
# shortened to MAXP (the words themselves are untouched: no tempo change), trimmed to speech with 0.15 s head and
# 0.25 s tail, gain to -20 LUFS. Beat 0 is not pause-edited (lip sync): its camera rectangle is cropped out of the OBS
# frame and laid over the clean title render as a round bubble. The picture of beats 1-9 is the v3 picture re-timed to
# the founder's lines. Mix: 48 kHz float, alimiter, two-pass linear loudnorm to -16 LUFS / TP -1.5, one AAC 256k encode.
# Outputs (out/video): final.mp4 (1920x1080), final-vo.wav, final-contact.png, founder/takes.json, founder/beats.json.
import subprocess, os, json, re, shutil
import numpy as np

# Beat 0's camera take (OBS composite, ~/Movies/2026-11-03 <stem>.mov). Swap the take here (or FIN_BEAT0=<stem>) and
# re-run; beat 0's length follows it (title hold = the take's trimmed length + 0.4 s, the payoff loop keeps cycling).
BEAT0 = os.environ.get('FIN_BEAT0', '12-48-24')

MOV = os.path.expanduser('~/Movies/2026-11-03 {}.mov')
os.chdir('out/video')
W = 'founder/work'; os.makedirs(W, exist_ok=True); os.makedirs('founder/src', exist_ok=True)
SR = 48000
MAXP = float(os.environ.get('FIN_MAXP', '0.5'))   # longest pause kept inside a line (s)
HEAD, TAILPAD = 0.15, 0.25                         # around each take's speech
TAIL = float(os.environ.get('FIN_TAIL', '0.4'))    # picture after each line ends
OW, OH = 1920, 1080
WAV = ['-ar', str(SR), '-ac', '1', '-c:a', 'pcm_f32le']

def ff(*a): subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *a], check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())
def lufs(f): return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', subprocess.run(['ffmpeg', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr)[-1])
def quiet(f, db=-40, d=0.08):
    out = subprocess.run(['ffmpeg', '-i', f, '-af', f'silencedetect=n={db}dB:d={d}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return [(float(a), float(b)) for a, b in re.findall(r'silence_start: ([\d.]+)\n.*?silence_end: ([\d.]+)', out, re.S)]
def load(src, af):
    raw = subprocess.run(['ffmpeg', '-loglevel', 'error', '-i', src, '-vn', '-af', af, '-ac', '1', '-ar', str(SR), '-f', 'f32le', '-'], capture_output=True, check=True).stdout
    return np.frombuffer(raw, np.float32).copy()
def save(x, out): subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-f', 'f32le', '-ar', str(SR), '-ac', '1', '-i', '-', *WAV, out], input=x.astype(np.float32).tobytes(), check=True)
def frames_db(x, hop=480):
    n = len(x) // hop; f = x[:n * hop].reshape(n, hop)
    return 20 * np.log10(np.sqrt((f ** 2).mean(1)) + 1e-9)

# 1. The takes. Each: (take, key, [(file, [(keep from, keep to or None)])], notes). Edits cut a stumble at a point
# found by transcribing short pieces (out/video/founder/fine.json); None = no clean read recorded.
TAKES = [
    ('01', 'b0', [(BEAT0, [(0, None)])], 'camera take (OBS composite), short version B; 12-48-24 is the cleaner of two reads (12-48-08: "most of the apps", "in a second"); the 32 s takes 12-43-29 / 12-44-16 are no longer used'),
    ('02', 'b1', [('12-30-09', [(0, None)])], 'only read; "No one can tell you" for "Nobody can tell you"'),
    ('03', 'b2', [('12-30-15', [(0, None)])], 'only read'),
    ('04', 'b3', [('12-30-27', [(0, 14.0), (15.10, None)])], 'misread "in a view report. Review report" cut to "in a review report" (14.0-15.1 s removed); 12-30-49 is a false start'),
    ('05', 'b4', [('12-31-45', [(0, None)])], '12-31-13 and 12-31-39 are near-silent false starts'),
    ('06', 'b5', [('12-32-07', [(0, 8.70), (11.45, None)])], 'only read; "merged colors invisible," cut (8.70-11.45 s) so it reads "zero pixels changed, and no text made harder to read"'),
    ('07', 'b6a', [('12-32-52', [(0, None)])], 'last of three; 12-32-34 stumbles ("merges, merges, just"), 12-32-45 stops early'),
    ('08', 'req1', [('12-33-07', [(0, None)])], 'request 1 (replaces the synthetic request voice)'),
    ('09', 'b6b', [('12-33-15', [(0, None)])], 'only read'),
    ('10', 'req2', [('12-33-33', [(0, None)])], 'request 2 (replaces the synthetic request voice); "...in our blue color"'),
    ('11', 'b6c', [('12-33-50', [(0, None)])], 'last of two; split at its pause so "it\'s blocked" lands on the BLOCKED card'),
    ('12', 'b7', None, 'dropped (founder 11-03: beat 7 does not add much); not recorded'),
    ('13', 'b9', [('12-34-39', [(0, 6.92)]), ('12-35-03', [(0, None)])], 'two files: "Low-contrast text... failure." from 12-34-39 (the Europe/WCAG sentence after 6.92 s cut, founder 11-03), then 12-35-03; 12-34-00 stumbles throughout'),
    ('14', 'b8', [('12-35-24', [(0.6, 20.58), (22.65, 24.12), (24.52, None)])], 'stray "using" before "Meta\'s models" cut (0-0.6 s), "under a cent a run" cut (20.58-22.65 s, founder 11-03: "...in seconds, on open weights."), "every" before "anyone" cut (24.12-24.52 s); 12-35-18 is a false start'),
]
GAP_FILES = 0.45   # pause between the two files of take 13
FILE_TAKE12 = os.environ.get('FIN_TAKE12')   # a re-recorded take 12 (file stem in ~/Movies), when there is one
if FILE_TAKE12: TAKES[11] = ('12', 'b7', [(FILE_TAKE12, [(0, None)])], 're-recorded')
tr = json.load(open('founder/transcripts.json'))

def clean(stem, keeps, squeeze):
    """One file -> (samples, src index per output sample, floor dB). highpass + light afftdn at the file's floor."""
    src = MOV.format(stem); shutil.copy2(src, f'founder/src/{stem}.mov') if not os.path.exists(f'founder/src/{stem}.mov') else None
    x0 = load(src, 'highpass=f=70')
    fl = float(np.percentile(frames_db(x0), 5))
    nf = min(-40, max(-70, round(fl)))
    x = load(src, f'highpass=f=70,afftdn=nr=8:nf={nf}:tn=1')
    idx = np.arange(len(x))
    parts = []
    for a, b in keeps:
        A = int(a * SR); B = len(x) if b is None else int(b * SR); parts.append((x[A:B], idx[A:B]))
    y, s = parts[0]
    for p, q in parts[1:]: y, s = xcat(y, s, p, q)
    return y, s, float(np.percentile(frames_db(x), 5))

def xcat(y, s, p, q, n=480):
    """Join with a 10 ms crossfade."""
    r = np.linspace(0, 1, n, dtype=np.float32)
    mid = y[-n:] * (1 - r) + p[:n] * r
    return np.concatenate([y[:-n], mid, p[n:]]), np.concatenate([s[:-n], q[:n], q[n:]])

def bounds(y, floor):
    """First/last speech sample (10 ms frames 12 dB over the floor, 3 in a row)."""
    v = frames_db(y) > floor + 12
    run = np.convolve(v.astype(int), np.ones(3, int), 'same') >= 3
    on = np.where(run)[0]
    return (on[0] - 1) * 480, (on[-1] + 2) * 480

def squeeze_pauses(y, s, floor):
    v = frames_db(y) > floor + 12
    keep = np.ones(len(y), bool); i = 0; L = int(MAXP * 100)
    while i < len(v):
        if not v[i]:
            j = i
            while j < len(v) and not v[j]: j += 1
            if i > 0 and j < len(v) and j - i > L:   # inside the line only
                a = (i + L // 2) * 480; b = (j - L // 2) * 480; keep[a:b] = False
            i = j
        else: i += 1
    # 5 ms fades at each cut to avoid clicks (cuts sit in the noise floor)
    return y[keep], s[keep]

audio, meta = {}, []
for take, key, files, notes in TAKES:
    if files is None:
        meta.append({'take': take, 'beat_key': key, 'file': None, 'transcript': None, 'start': None, 'end': None, 'notes': notes}); continue
    ys, ss = [], []
    for k, (stem, keeps) in enumerate(files):
        y, s, floor = clean(stem, keeps, key != 'b0')
        a, b = bounds(y, floor)
        a = max(0, a - int(HEAD * SR)); b = min(len(y), b + int(TAILPAD * SR))
        y, s = y[a:b], s[a:b]
        if key != 'b0': y, s = squeeze_pauses(y, s, floor)
        ys.append(y); ss.append(s + k * 10 ** 9)   # file k's source indices offset (only take 13 has two)
        meta.append({'take': take, 'beat_key': key, 'file': f'2026-11-03 {stem}.mov', 'transcript': tr[stem]['text'], 'start': round(s[0] / SR, 3), 'end': round(s[-1] / SR, 3), 'keep': [[a_, b_] for a_, b_ in keeps], 'notes': notes})
    y, s = ys[0], ss[0]
    for p, q in zip(ys[1:], ss[1:]):
        y = np.concatenate([y, np.zeros(int(GAP_FILES * SR), np.float32), p]); s = np.concatenate([s, np.full(int(GAP_FILES * SR), -1), q])
    tmp = f'{W}/{key}.tmp.wav'; save(y, tmp)
    ff('-i', tmp, '-af', f'volume={-20 - lufs(tmp):.2f}dB', *WAV, f'{W}/{key}.wav'); os.remove(tmp)
    audio[key] = s
json.dump(meta, open('founder/takes.json', 'w'), indent=1)

def at(key, t_raw, k=0):
    """Source time (s) in a take's file -> time in its cleaned WAV."""
    s = audio[key]; return float(np.searchsorted(np.where(s < 0, 0, s), k * 10 ** 9 + t_raw * SR)) / SR
SP = {}
for key in audio:
    f = f'{W}/{key}.wav'; D = dur(f); SP[key] = (HEAD, D - TAILPAD)
# take 11 split at its pause between "contrast," and "it's blocked." (3.61-3.96 s in 12-33-50)
cut = at('b6c', 3.78)
ff('-i', f'{W}/b6c.wav', '-t', f'{cut:.3f}', *WAV, f'{W}/b6c1.wav'); ff('-ss', f'{cut:.3f}', '-i', f'{W}/b6c.wav', *WAV, f'{W}/b6c2.wav')
SP['b6c1'] = (HEAD, cut); SP['b6c2'] = (at('b6c', 3.96) - cut, dur(f'{W}/b6c2.wav') - TAILPAD)
for k in SP: print(f'{k:5s} {SP[k][1] - SP[k][0]:6.2f} s speech')
print('speech total', round(sum(SP[k][1] - SP[k][0] for k in SP if k not in ('b6c1', 'b6c2')), 1))
if os.environ.get('FIN_AUDIO_ONLY'): raise SystemExit

# 2. Picture. A segment is (src, from, to, hold after); `to` past the source's end becomes a hold of its last frame.
DUR = {}
def sdur(f):
    if f not in DUR: DUR[f] = dur(f)
    return DUR[f]
SCALE = f'scale={OW}:{OH}:flags=lanczos,setsar=1,format=yuv420p'
def wavs(n, audio_list, T):
    inputs, af = [], ''
    for j, (file, t, _) in enumerate(audio_list):
        inputs += ['-i', file]; af += f'[{j}:a]adelay={int(round(t * 1000))}[a{j}];'
    af += ''.join(f'[a{j}]' for j in range(len(audio_list))) + f'amix=inputs={len(audio_list)}:duration=longest:normalize=0,apad=whole_len={round(T * SR)},atrim=end_sample={round(T * SR)}[a]'
    ff(*inputs, '-filter_complex', af, '-map', '[a]', *WAV, f'{W}/w{n}.wav')
def build(n, segs, audio_list, T):
    T = round(T * 30) / 30
    srcs = sorted({s[0] for s in segs}); ix = {s: i for i, s in enumerate(srcs)}
    f = ''; labels = ''
    for i, (src, a, b, hold) in enumerate(segs):
        end = min(b, sdur(src) - 0.04); hold += max(0, b - end)
        f += f'[{ix[src]}:v]trim={a:.3f}:{end:.3f},setpts=PTS-STARTPTS,fps=30,{SCALE}' + (f',tpad=stop_mode=clone:stop_duration={hold:.3f}' if hold > 0 else '') + f'[p{i}];'
        labels += f'[p{i}]'
    pic = sum(min(b, sdur(s) - 0.04) - a + h + max(0, b - min(b, sdur(s) - 0.04)) for s, a, b, h in segs)
    f += f'{labels}concat=n={len(segs)}:v=1:a=0,tpad=stop_mode=clone:stop_duration={max(0, T - pic) + 0.1:.3f},trim=0:{T:.4f},setpts=PTS-STARTPTS[v]'
    ff(*sum((['-i', s] for s in srcs), []), '-filter_complex', f, '-map', '[v]', '-frames:v', str(round(T * 30)), '-c:v', 'libx264', '-crf', '17', '-preset', 'medium', '-pix_fmt', 'yuv420p', '-r', '30', '-an', f'{W}/w{n}-v.mp4')
    wavs(n, audio_list, T); return T
def plain(n, src, k, segs=None, tail=None):
    T = 0.25 + SP[k][1] + (TAIL if tail is None else tail)
    if segs is None: segs = [(src, 0, sdur(src), 0)]
    return build(n, segs, [(f'{W}/{k}.wav', 0.25, True)], T)

beats = {}
# Beat 0: the clean title render with the founder's camera as a round bubble, bottom-left. The OBS composite's camera
# rectangle is x 70-331, y 466-613 (1280x720); a square around the face (146 px at x 148, y 467) is scaled to the
# bubble. Bubble: 220 px at 1280x720 (330 at 1920x1080), 24 px margins (36), a 2 px ring (3), lip sync from the same file.
B0 = W + '/b0.wav'
cam_from = audio['b0'][0] / SR - 0.25           # the camera clip starts 0.25 s before the trimmed audio, as the voice does
T0 = round((0.25 + SP['b0'][1] + TAIL) * 30) / 30
D_ = 330; R_ = 3; M_ = 36; CAM = D_ - 2 * R_
cx = (CAM - 1) / 2; rx = (D_ - 1) / 2
fc = (f'[0:v]trim=0:{T0:.3f},setpts=PTS-STARTPTS,fps=30,{SCALE},tpad=stop_mode=clone:stop_duration={T0:.3f},trim=0:{T0:.3f}[bg];'
      f'[1:v]trim=start={max(0, cam_from):.3f},setpts=PTS-STARTPTS,fps=30,crop=146:146:148:467,scale={CAM}:{CAM}:flags=lanczos,format=yuva444p,'
      f"geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='255*clip({CAM / 2}-hypot(X-{cx},Y-{cx})+0.5,0,1)',tpad=stop_mode=clone:stop_duration=2[cam];"
      f"color=c=0xE8E8E4:s={D_}x{D_}:r=30,format=yuva444p,geq=lum='p(X,Y)':cb='p(X,Y)':cr='p(X,Y)':a='150*clip({D_ / 2}-hypot(X-{rx},Y-{rx})+0.5,0,1)'[ring];"
      f'[bg][ring]overlay={M_}:{OH - M_ - D_}:shortest=1[b1];[b1][cam]overlay={M_ + R_}:{OH - M_ - D_ + R_}:eof_action=repeat,format=yuv420p,trim=0:{T0:.3f}[v]')
ff('-i', 'beat-0.webm', '-i', f'founder/src/{BEAT0}.mov', '-filter_complex', fc, '-map', '[v]', '-frames:v', str(round(T0 * 30)), '-c:v', 'libx264', '-crf', '17', '-pix_fmt', 'yuv420p', '-r', '30', '-an', f'{W}/w0-v.mp4')
wavs(0, [(B0, 0.25, True)], T0); beats[0] = T0

beats[1] = plain(1, 'n1.mp4', 'b1', tail=0.3)
beats[2] = plain(2, 'n2.mp4', 'b2')
# Beat 3: terminal replay, then the three-tier card from "the raw color" (9.57 s in 12-30-27) to "Twenty-three
# seconds" (16.42 s), when the terminal's "done in" line comes back.
T3 = 0.25 + SP['b3'][1] + 0.3
c0 = 0.25 + at('b3', 9.57) - 0.3; c1 = 0.25 + at('b3', 16.42) - 0.2
TERM = float(os.environ.get('FIN_B3_TERM', '0'))   # seconds cut from the terminal replay's start when over time
beats[3] = plain(3, 'n3.mp4', 'b3', [('n3.mp4', 0.6 + TERM, 0.6 + TERM + c0, 0), ('beat-13.webm', 0, c1 - c0, 0), ('n3.mp4', 9.0, 9.4, max(0, T3 - c1 - 0.4))], tail=0.3)
T4 = 0.25 + SP['b4'][1] + 0.3; V4 = sdur('n4.mp4')
beats[4] = plain(4, 'n4.mp4', 'b4', [('n4.mp4', max(0, V4 - T4), V4, 0)], tail=0.3)
beats[5] = plain(5, 'n5.mp4', 'b5')

# Beat 6: proposal link + Show original under take 07; the click lands on "point" (10.45 s in 12-32-52), request 1
# starts as SAM's outline lands (or just after take 07 ends), the mic press under its first word; take 09; the Icons
# click, request 2 with the mic press; take 11 split, "it's blocked" on the BLOCKED card.
r = json.load(open('beat-6-pas-v3.json')); e1, e2 = r['s1']['events'], r['s2']['events']
V1, V2 = 'beat-6-pas-v1.webm', 'beat-6-pas-v2.webm'
segs, aud, cues = [], [], {}
pos = 0.0
def add(src, a, b, hold=0.0):
    global pos; segs.append([src, a, b, hold]); pos += b - a + hold
def hold_last(h):
    global pos
    if h > 0: segs[-1][3] += h; pos += h
def say(k, t, narr=True):
    aud.append((f'{W}/{k}.wav', t, narr)); cues[k] = round(t + SP[k][0], 2); return t + SP[k][1]
add('n6.mp4', 0, 5.0)
endA = say('b6a', 0.25)
hold_last(0.25 + at('b6a', 10.45) - (pos + 0.45))
add(V1, e1['click1'] - 0.45, e1['click1'] + 0.5)
outline = pos + 0.3
add(V1, e1['pointed1'] - 0.3, e1['pointed1'] + 0.35)
R1 = max(outline, endA + 0.3)                       # request 1 speech start
hold_last(R1 - 0.1 - 0.25 - pos)                   # the mic press 0.1 s before the first word
add(V1, e1['micDown1'] - 0.25, e1['micUp1'] - 0.05)
endR1 = say('req1', R1 - SP['req1'][0], False)
hold_last(endR1 + 0.15 - pos)                       # hold the mic down until the request ends
add(V1, e1['micUp1'] - 0.05, e1['end'])
endB = say('b6b', endR1 + 0.55)
hold_last(endB - 0.75 - pos)
add(V2, e2['click2'] - 0.45, e2['click2'] + 0.2); add(V2, e2['pointed2'] - 0.05, e2['micDown2'])
endR2 = say('req2', pos + 0.1 - SP['req2'][0], False)
add(V2, e2['micDown2'], e2['micUp2'] - 0.05); hold_last(endR2 + 0.15 - pos)
add(V2, e2['micUp2'] + 0.05, e2['micUp2'] + 0.29)
add(V2, e2['transcript2'] - 0.05, e2['transcript2'] + 0.66, 0.6)
endC1 = say('b6c1', endR2 + 1.3)
add(V2, e2['checkEnd'] - 0.1, e2['checkEnd'] + 1.15)
add(V2, e2['tab1'] - 0.15, e2['tab2'] + 0.05)
add(V2, e2['click3'] - 0.25, e2['click3'] + 0.1); add(V2, e2['pointed3'] - 0.05, e2['pointed3'] + 0.25); add(V2, e2['enter3'] - 0.5, e2['enter3'] + 0.05)
if pos < endC1 - 0.2: hold_last(endC1 - 0.2 - pos)
card = pos
c2 = min(max(endC1 + 0.3, card - 0.1 - SP['b6c2'][0] + SP['b6c2'][0]), endC1 + 1.2)
c2 = max(c2, card - SP['b6c2'][0] + 0.05)          # "it's blocked" starts on the card
endC2 = say('b6c2', c2)
T6 = endC2 + 1.1
add(V2, e2['done3'] - 0.05, e2['end'])
beats[6] = build(6, [tuple(s) for s in segs], aud, T6)
B6 = {'req1At': round(R1, 2), 'outlineAt': round(outline, 2), 'req2At': cues['req2'], 'blockedCardAt': round(card, 2), 'itsBlockedAt': cues['b6c2'], 'speechStarts': cues}

# Beat 7 (take 12): the 28-site table, opening on the rest of the BLOCKED card. Left out until take 12 exists.
if 'b7' in audio:
    hu = T6 - card
    beats[7] = plain(7, 'n7.mp4', 'b7', [(V2, e2['done3'] - 0.05 + hu, e2['done3'] - 0.05 + hu + 1.3, 0), ('n7.mp4', 0, sdur('n7.mp4'), 0)], tail=0.3)
# Beat 9 (take 13): contrast row through the first file; the axe-core card from the second file ("On twenty-eight
# sites..."), then the focus numbers card; dark mode only if there is time.
T9 = 0.25 + SP['b9'][1] + TAIL
part2 = 0.25 + float(np.argmax(audio['b9'] >= 10 ** 9)) / SR
DARK = float(os.environ.get('FIN_DARK', '0'))
segs9 = [('n9-v2.mp4', 0, 7.13, max(0, part2 - 0.3 - 7.13)), ('n9-v2.mp4', 7.13, 17.13, 0), ('n9-v2.mp4', 17.13, 19.63, 0)] + ([('n9-v2.mp4', 23.6, 23.6 + DARK, 0)] if DARK > 0 else [])
beats[9] = plain(9, 'n9-v2.mp4', 'b9', segs9)
beats[8] = plain(8, 'beat-8.webm', 'b8', tail=1.2)

# 3. Stitch + master (the v3 chain).
ORDER = [n for n in [0, 1, 2, 3, 4, 5, 6, 7, 9, 8] if n in beats]
total = sum(beats[n] for n in ORDER)
open(f'{W}/list-v.txt', 'w').write(''.join(f"file 'w{n}-v.mp4'\n" for n in ORDER))
ff('-f', 'concat', '-safe', '0', '-i', f'{W}/list-v.txt', '-c', 'copy', f'{W}/picture.mp4')
ins = sum((['-i', f'{W}/w{n}.wav'] for n in ORDER), [])
ff(*ins, '-filter_complex', ''.join(f'[{i}:a]' for i in range(len(ORDER))) + f'concat=n={len(ORDER)}:v=0:a=1[a]', '-map', '[a]', *WAV, f'{W}/bed.wav')
pre = -16.0 - lufs(f'{W}/bed.wav')
ff('-i', f'{W}/bed.wav', '-af', f'volume={pre:.3f}dB,alimiter=limit=0.68:attack=1:release=50:level=false', *WAV, f'{W}/bed-lim.wav')
m = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', subprocess.run(['ffmpeg', '-i', f'{W}/bed-lim.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr)[-1])
LN = f"loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:print_format=json"
r2 = subprocess.run(['ffmpeg', '-y', '-i', f'{W}/bed-lim.wav', '-af', LN + ',aresample=48000', '-ac', '1', '-c:a', 'pcm_f32le', 'final-vo.wav'], capture_output=True, text=True).stderr
n2 = json.loads(re.findall(r'\{[^{}]*"normalization_type"[^{}]*\}', r2)[-1])
ff('-i', f'{W}/picture.mp4', '-i', 'final-vo.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-shortest', 'final.mp4')
table, t = [], 0.0
for n in ORDER:
    table.append({'beat': n, 'start': round(t, 2), 'len': round(beats[n], 2)}); t += beats[n]
sil = quiet('final-vo.wav', -40, 0.3); longest = max((b - a for a, b in sil), default=0)
json.dump({'maxPause': MAXP, 'loudnorm': {'measured': m, 'second': n2}, 'beats': table, 'beat6': B6, 'total': round(total, 2), 'longestSilence': round(longest, 2)}, open('founder/beats.json', 'w'), indent=1)
for b in table: print(f"beat {b['beat']}: {b['start']:6.1f}s  len {b['len']:5.1f}s")
print('total', round(total, 2), 'loudnorm', n2['normalization_type'], 'out I', n2['output_i'], 'TP', n2['output_tp'], 'longest silence', round(longest, 2), 'beat6', B6)

# 4. Contact sheet: 18 frames, the label under each frame (the caption pills sit at the top of the picture).
from PIL import Image, ImageDraw, ImageFont
B = {b['beat']: b for b in table}; s6 = B[6]['start']
pts = [('b0 title + bubble', 2), ('b0 late (disclosure)', B[0]['len'] - 1), ('b1', B[1]['start'] + 3), ('b2', B[2]['start'] + 5), ('b3 card', B[3]['start'] + 11), ('b3 end', B[3]['start'] + B[3]['len'] - 0.5),
       ('b4', B[4]['start'] + 10), ('b5', B[5]['start'] + 6), ('b6 outline lands', s6 + B6['outlineAt'] + 0.3), ('b6 REQ1 spoken', s6 + B6['req1At'] + 1.5),
       ('b6 result (take 09)', s6 + B6['speechStarts']['b6b'] + 3), ('b6 Icons click', s6 + B6['req2At'] - 1.0), ('b6 REQ2 spoken', s6 + B6['req2At'] + 1.5),
       ('b6 focus result', s6 + B6['speechStarts']['b6c1'] + 0.8), ('b6 "it\'s blocked"', s6 + B6['itsBlockedAt'] + 0.3), ('b9 contrast', B[9]['start'] + 5), ('b9 axe card', B[9]['len'] + B[9]['start'] - 4), ('b8 end card', B[8]['start'] + B[8]['len'] - 0.3)]
fnt = ImageFont.truetype('/System/Library/Fonts/Helvetica.ttc', 18); sheet = Image.new('RGB', (1920, 390 * 6), (0, 0, 0)); dr = ImageDraw.Draw(sheet)
for i, (lab, t) in enumerate(pts):
    fr = f'{W}/cs.png'; ff('-ss', f'{t:.2f}', '-i', 'final.mp4', '-frames:v', '1', '-vf', 'scale=640:360', fr)
    x, y = (i % 3) * 640, (i // 3) * 390; sheet.paste(Image.open(fr).convert('RGB'), (x, y))
    mm, ss = divmod(t, 60); dr.text((x + 6, y + 365), f'{lab}  {int(mm)}:{ss:04.1f}', fill=(255, 255, 0), font=fnt)
sheet.save('final-contact.png')
