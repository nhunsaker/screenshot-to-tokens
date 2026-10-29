#!/usr/bin/env python3
# The v3 cut (spec/metatoy-studio/hackathons/final-cut-plan.md, script table with the 2026-10-29 rubric review).
# Run as `python3 scripts/mix-demo.py --v3`. Inputs in out/video:
#   vo-v3/<beat>/vo-1.mp3   Emma lines (node scripts/gen-vo.mjs vo-v3/<beat>/line.json vo-v3/<beat>); b6a/b6b/b6c are
#                           the non-italic parts of beat 6's line (b6c is split at its comma: "...hurts contrast," /
#                           "it's blocked.")
#   req/req-1.wav, req-2.wav the spoken requests (Michael; scripts/make-requests.sh), heard in beat 6 where the take held
#                           the mic (the fake mic played the same file into Meta's speech model)
#   beat-6-pas-v1.webm, beat-6-pas-v2.webm, beat-6-pas-v3.json   node scripts/record-pas-beat.mjs --voice out/video/req
#   beat-0.webm, beat-8.webm  node scripts/record-beats.mjs --only 0,8 --v3 (title card with the payoff loop; end card)
#   n1..n5, n6 (first 5 s: proposal link + Show original), n7, n9-v2   the v2 sources, re-paced here
# Emma's pauses between phrases are cut to PAUSE s and she is sped up by TEMPO (atempo, pitch kept) so the
# script (about 470 words after the founder's 10-29 edits) fits the 3:00 cap. Each beat's picture is cut
# or held to its speech, and no gap between spoken lines is over 1.4 s (the check is silencedetect at -40 dB, 1.5 s).
# Outputs: demo-v3-vo.mp4 (narration + requests, -16 LUFS), screen-track.mp4 (same picture, requests only, same gain),
# v3/beats.json (per-beat start/length, for the teleprompter), v3-contact.png.
import subprocess, os, json, re
os.chdir('out/video')
os.makedirs('v3', exist_ok=True)
TEMPO = float(os.environ.get('V3_TEMPO', '1.09'))
TAIL = float(os.environ.get('V3_TAIL', '0.4'))  # picture after each line ends
def ff(*a): subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', *a], check=True)
def dur(f): return float(subprocess.check_output(['ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', f]).strip())
def quiet(f, db=-40, d=0.08):
    out = subprocess.run(['ffmpeg', '-i', f, '-af', f'silencedetect=n={db}dB:d={d}', '-f', 'null', '-'], capture_output=True, text=True).stderr
    return [(float(a), float(b)) for a, b in re.findall(r'silence_start: ([\d.]+)\n.*?silence_end: ([\d.]+)', out, re.S)]
def speech(f):
    """(first speech start, last speech end) in seconds."""
    q, D = quiet(f), dur(f)
    s = q[0][1] if q and q[0][0] < 0.05 else 0.0
    e = q[-1][0] if q and q[-1][1] > D - 0.05 else D
    return s, e

# 1. Audio: Emma at TEMPO, each line to the same loudness; the requests to the same loudness as Emma.
NORM = 'loudnorm=I=-20:TP=-2:LRA=7'
KEYS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6a', 'b6b', 'b6c', 'b7', 'b9', 'b8']
# PAUSE: pauses between phrases longer than that are cut down to it (the 3:00 cap; the words keep their pace).
PAUSE = os.environ.get('V3_PAUSE', '0.22')
SQZ = f'silenceremove=stop_periods=-1:stop_duration={PAUSE}:stop_threshold=-45dB:stop_silence={PAUSE},' if PAUSE else ''
for k in KEYS: ff('-i', f'vo-v3/{k}/vo-1.mp3', '-af', f'{SQZ}atempo={TEMPO},{NORM}', '-ar', '44100', '-ac', '1', f'v3/{k}.wav')
inner = [q for q in quiet('v3/b6c.wav', d=0.15) if q[0] > 0.3 and q[1] < dur('v3/b6c.wav') - 0.3]
cut = (inner[0][0] + inner[0][1]) / 2
ff('-i', 'v3/b6c.wav', '-t', f'{cut:.3f}', 'v3/b6c1.wav'); ff('-ss', f'{cut:.3f}', '-i', 'v3/b6c.wav', 'v3/b6c2.wav')
for i in (1, 2): ff('-i', f'req/req-{i}.wav', '-af', NORM, '-ar', '44100', '-ac', '1', f'v3/req{i}.wav')
SP = {k: speech(f'v3/{k}.wav') for k in KEYS + ['b6c1', 'b6c2', 'req1', 'req2']}

# 2. One beat = picture segments (src, start, end, hold after) + audio placements (file, at, narration?) + length T.
def build(n, segs, audio, T):
    srcs = sorted({s[0] for s in segs}); ix = {s: i for i, s in enumerate(srcs)}
    f = ''; labels = ''
    for i, (src, a, b, hold) in enumerate(segs):
        f += f'[{ix[src]}:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS,fps=30,scale=1280:720,setsar=1,format=yuv420p' + (f',tpad=stop_mode=clone:stop_duration={hold:.3f}' if hold > 0 else '') + f'[p{i}];'
        labels += f'[p{i}]'
    pic = sum(b - a + h for _, a, b, h in segs)
    f += f'{labels}concat=n={len(segs)}:v=1:a=0,tpad=stop_mode=clone:stop_duration={max(0, T - pic) + 0.1:.3f},trim=0:{T:.3f},setpts=PTS-STARTPTS[v]'
    outs = {}
    for kind in ('full', 'screen'):
        use = [x for x in audio if kind == 'full' or not x[2]]
        inputs = sum((['-i', s] for s in srcs), [])
        af = ''
        for j, (file, at, _) in enumerate(use):
            inputs += ['-i', file]; ms = int(at * 1000)
            af += f'[{len(srcs) + j}:a]adelay={ms}|{ms}[a{j}];'
        if use: af += ''.join(f'[a{j}]' for j in range(len(use))) + f'amix=inputs={len(use)}:duration=longest:normalize=0,apad,atrim=0:{T:.3f}[a]'
        else: af = f'anullsrc=r=44100:cl=mono,atrim=0:{T:.3f}[a]'
        out = f'v3/w{n}-{kind}.mp4'
        ff(*inputs, '-filter_complex', f + ';' + af, '-map', '[v]', '-map', '[a]', '-t', f'{T:.3f}', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-r', '30', '-c:a', 'aac', '-ar', '44100', '-ac', '2', out)
        outs[kind] = out
    return outs

def plain(n, src, k, segs=None, tail=None, pre=None):
    """A narrated beat: the line starts 0.25 s in; the picture is cut (or its last frame held) to end `tail` after it."""
    end = 0.25 + SP[k][1]; T = end + (TAIL if tail is None else tail)
    if segs is None: segs = [(src, 0, dur(src), 0)]
    if pre: segs = pre + segs
    return build(n, segs, [(f'v3/{k}.wav', 0.25, True)], T), T

beats = {}
# Beat 0: title card + payoff loop.
beats[0] = plain(0, 'beat-0.webm', 'b0')
beats[1] = plain(1, 'n1.mp4', 'b1')
beats[2] = plain(2, 'n2.mp4', 'b2')
# Beat 3: the terminal replay (to the "done in" line), then the review report's first screen.
beats[3] = plain(3, 'n3.mp4', 'b3', [('n3.mp4', 0.6, 9.1, 0), ('n3.mp4', 9.5, 12.45, 0)])
# Beat 4: keep the end (the terminal's 21/21); trim the opening dwell to fit the shorter line.
T4 = 0.25 + SP['b4'][1] + TAIL; V4 = dur('n4.mp4')
beats[4] = plain(4, 'n4.mp4', 'b4', [('n4.mp4', max(0, V4 - T4), V4, 0)])
beats[5] = plain(5, 'n5.mp4', 'b5')

# Beat 6: 5 s of proposal link + Show original, then the two voice sessions, cut on the take's own event times.
r = json.load(open('beat-6-pas-v3.json')); e1, e2 = r['s1']['events'], r['s2']['events']
V1, V2 = 'beat-6-pas-v1.webm', 'beat-6-pas-v2.webm'
segs, aud, pos = [], [], 0.0
def add(src, a, b, hold=0.0):
    global pos; segs.append((src, a, b, hold)); pos += b - a + hold
def say(k, at, narr=True):
    aud.append((f'v3/{k}.wav', at, narr)); cues[k] = round(at + SP[k][0], 2); return at + SP[k][1]
marks, cues = {}, {}
add('n6.mp4', 0, 5.0)
endA = say('b6a', 0.25)
add(V1, e1['click1'] - 0.45, e1['click1'] + 0.5); add(V1, e1['pointed1'] - 0.3, e1['pointed1'] + 0.6)  # click, SAM's outline (its wait shortened)
m1 = pos + 0.35; add(V1, e1['micDown1'] - 0.35, e1['end'])          # hold to talk, transcript, contrast result
endR1 = say('req1', m1, False); marks['req1'] = m1 + SP['req1'][0]
endB = say('b6b', endR1 + 0.55)
S3 = max(pos, endB - 0.75)                                          # B's last words over the cut to the sidebar
segs[-1] = segs[-1][:3] + (S3 - pos,); pos = S3
add(V2, e2['click2'] - 0.45, e2['click2'] + 0.2); add(V2, e2['pointed2'] - 0.05, e2['micDown2'])
m2 = pos; endR2 = say('req2', m2, False); marks['req2'] = m2 + SP['req2'][0]
add(V2, e2['micDown2'], e2['micDown2'] + SP['req2'][1] + 0.25)     # speaking (the release itself is cut)
add(V2, e2['micUp2'] + 0.05, e2['micUp2'] + 0.29)                   # "Listening back (Meta speech model)…"
add(V2, e2['transcript2'] - 0.05, e2['transcript2'] + 0.66, 0.6)    # the transcript caption
endC1 = say('b6c1', endR2 + 1.3)
add(V2, e2['checkEnd'] - 0.1, e2['checkEnd'] + 1.15)                 # focus result (9 s check, its time on the caption)
add(V2, e2['tab1'] - 0.15, e2['tab2'] + 0.05)                        # Tab, Tab: the ring
add(V2, e2['click3'] - 0.25, e2['click3'] + 0.1); add(V2, e2['pointed3'] - 0.05, e2['pointed3'] + 0.25); add(V2, e2['enter3'] - 0.5, e2['enter3'] + 0.05)
card = pos
c2 = min(max(endC1 + 0.3, card - 0.1), endC1 + 1.35)
endC2 = say('b6c2', c2)
T6 = endC2 + 1.1
hold_used = T6 - card
add(V2, e2['done3'] - 0.05, e2['end'])
beats[6] = (build(6, segs, aud, T6), T6)
# Beat 7 opens on the rest of the BLOCKED card (a J-cut: the beat 7 line starts over it), then the 28-site table.
pre7 = [(V2, e2['done3'] - 0.05 + hold_used, e2['done3'] - 0.05 + hold_used + 1.3, 0)]
beats[7] = plain(7, 'n7.mp4', 'b7', pre=pre7)
# Beat 9: contrast row held through the why-now line, axe-core card, focus numbers card, dark mode.
T9 = 0.25 + SP['b9'][1] + TAIL
fixed = 7.13 + 10.0 + 2.5 + 4.7
beats[9] = plain(9, 'n9-v2.mp4', 'b9', [('n9-v2.mp4', 0, 7.13, max(0, T9 - fixed)), ('n9-v2.mp4', 7.13, 17.13, 0), ('n9-v2.mp4', 17.13, 19.63, 0), ('n9-v2.mp4', 22.2, 26.9, 0)])
beats[8] = plain(8, 'beat-8.webm', 'b8', tail=1.2)

# 3. Stitch, one gain for both tracks (so the requests sit at the same level in the screen track).
ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 9, 8]
table, t = [], 0.0
for kind in ('full', 'screen'):
    open(f'v3/list-{kind}.txt', 'w').write(''.join(f"file 'w{n}-{kind}.mp4'\n" for n in ORDER))
    ff('-f', 'concat', '-safe', '0', '-i', f'v3/list-{kind}.txt', '-c', 'copy', f'v3/tmp-{kind}.mp4')
I = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', subprocess.run(['ffmpeg', '-i', 'v3/tmp-full.mp4', '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr)[-1])
gain = -16.0 - I
for kind, out in (('full', 'demo-v3-vo.mp4'), ('screen', 'screen-track.mp4')):
    ff('-i', f'v3/tmp-{kind}.mp4', '-c:v', 'copy', '-af', f'volume={gain:.2f}dB,alimiter=limit=0.84:level=false', '-c:a', 'aac', '-ar', '44100', '-b:a', '160k', out)
    os.remove(f'v3/tmp-{kind}.mp4')
for n in ORDER:
    T = beats[n][1]; table.append({'beat': n, 'start': round(t, 2), 'len': round(T, 2)}); t += T
json.dump({'tempo': TEMPO, 'beats': table, 'beat6': {'requestSpeechAt': marks, 'speechStarts': cues, 'blockedCardAt': round(card, 2), 'itsBlockedAt': round(c2, 2)}}, open('v3/beats.json', 'w'), indent=1)
for b in table: print(f"beat {b['beat']}: {b['start']:6.1f}s  len {b['len']:5.1f}s")
print('total', round(dur('demo-v3-vo.mp4'), 2), 'screen', round(dur('screen-track.mp4'), 2), 'gain', round(gain, 2))
