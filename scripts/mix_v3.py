#!/usr/bin/env python3
# The v3 cut (spec/metatoy-studio/hackathons/final-cut-plan.md, script table with the 2026-10-29 rubric review).
# Run as `python3 scripts/mix-demo.py --v3`. Inputs in out/video:
#   vo-hq/<beat>/vo-1.mp3   Emma lines at 192 kbps (VO_FORMAT=mp3_44100_192 node scripts/gen-vo.mjs vo-hq/<beat>/line.json
#                           vo-hq/<beat>; the 128 kbps set in vo-v3/ is the fallback, V3_VO_DIR=vo-v3); b6a/b6b/b6c are
#                           the non-italic parts of beat 6's line (b6c is split at its comma: "...hurts contrast," /
#                           "it's blocked.")
#   req/vo-1.mp3, vo-2.mp3  the spoken requests (Michael, 44.1 kHz), heard in beat 6 where the take held the mic; the
#                           take's fake mic played req/req-<n>.wav, the 16 kHz copies (scripts/make-requests.sh)
#   beat-6-pas-v1.webm, beat-6-pas-v2.webm, beat-6-pas-v3.json   node scripts/record-pas-beat.mjs --voice out/video/req
#   beat-0.webm, beat-8.webm  node scripts/record-beats.mjs --only 0,8 --v3 (title card with the payoff loop; end card)
#   n1..n5, n6 (first 5 s: proposal link + Show original), n7, n9-v2   the v2 sources, re-paced here
# Emma's pauses between phrases are cut to PAUSE s (>= 0.35) and she is sped up by TEMPO (atempo, pitch kept, <= 1.04).
# At those limits the second 10-29 script (with the tier card) runs 3:05.4; over 3:00 the outputs get an -over
# suffix (see section 3). Each beat's picture is cut
# or held to its speech, and no gap between spoken lines is over 1.4 s (the check is silencedetect at -40 dB, 1.5 s).
# Outputs: demo-v3-vo.mp4 (narration + requests, -16 LUFS, AAC 256 kbps 48 kHz), screen-track.mp4 (same picture,
# requests only, same gain),
# v3/beats.json (per-beat start/length, for the teleprompter), v3-contact.png.
import subprocess, os, json, re
os.chdir('out/video')
os.makedirs('v3', exist_ok=True)
TEMPO = float(os.environ.get('V3_TEMPO', '1.04'))  # cap 1.04 (founder, 10-29: above that Emma sounds thin)
TAIL = float(os.environ.get('V3_TAIL', '0.4'))  # picture after each line ends
TAIL_SHORT = float(os.environ.get('V3_TAIL_SHORT', '0.3'))  # beats 1, 3, 4, 7
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

# 1. Audio, all in 48 kHz float WAV (one lossy encode at the very end). Emma: 192 kbps ElevenLabs MP3s (VO_DIR, made
# with VO_FORMAT=mp3_44100_192 node scripts/gen-vo.mjs ...), highpass 70 Hz, pauses between phrases cut to PAUSE s,
# atempo TEMPO, then a plain gain to -20 LUFS per line (no dynamic processing). Michael: the original 44.1 kHz MP3s
# (req/vo-<n>.mp3) with the same 0.6 s lead-in as the fake-mic WAVs, so they sit where the take held the mic; the
# 16 kHz req-<n>.wav files are only the fake-mic input.
VO_DIR = os.environ.get('V3_VO_DIR', 'vo-hq')
KEYS = ['b0', 'b1', 'b2', 'b3', 'b4', 'b5', 'b6a', 'b6b', 'b6c', 'b7', 'b9', 'b8']
PAUSE = os.environ.get('V3_PAUSE', '0.35')
SQZ = f'silenceremove=stop_periods=-1:stop_duration={PAUSE}:stop_threshold=-45dB:stop_silence={PAUSE},' if PAUSE else ''
WAV = ['-ar', '48000', '-ac', '1', '-c:a', 'pcm_f32le']
def lufs(f): return float(re.findall(r'I:\s+(-?[\d.]+) LUFS', subprocess.run(['ffmpeg', '-i', f, '-af', 'ebur128', '-f', 'null', '-'], capture_output=True, text=True).stderr)[-1])
def level(src, af, out, target=-20.0):
    ff('-i', src, '-af', af, *WAV, out + '.tmp.wav')
    ff('-i', out + '.tmp.wav', '-af', f'volume={target - lufs(out + ".tmp.wav"):.2f}dB', *WAV, out); os.remove(out + '.tmp.wav')
for k in KEYS: level(f'{VO_DIR}/{k}/vo-1.mp3', f'aresample=48000,highpass=f=70,{SQZ}atempo={TEMPO}', f'v3/{k}.wav')
inner = [q for q in quiet('v3/b6c.wav', d=0.15) if q[0] > 0.3 and q[1] < dur('v3/b6c.wav') - 0.3]
cut = (inner[0][0] + inner[0][1]) / 2
ff('-i', 'v3/b6c.wav', '-t', f'{cut:.3f}', *WAV, 'v3/b6c1.wav'); ff('-ss', f'{cut:.3f}', '-i', 'v3/b6c.wav', *WAV, 'v3/b6c2.wav')
for i in (1, 2): level(f'req/vo-{i}.mp3', 'aresample=48000,highpass=f=70,adelay=600,apad=pad_dur=1.5', f'v3/req{i}.wav')
SP = {k: speech(f'v3/{k}.wav') for k in KEYS + ['b6c1', 'b6c2', 'req1', 'req2']}

# 2. One beat = picture segments (src, start, end, hold after) + audio placements (file, at, narration?) + length T.
# The picture is encoded once per beat (video only); the audio stays WAV. T is rounded to whole frames so picture and
# sound stay in step across the concat.
def build(n, segs, audio, T):
    T = round(T * 30) / 30
    srcs = sorted({s[0] for s in segs}); ix = {s: i for i, s in enumerate(srcs)}
    f = ''; labels = ''
    for i, (src, a, b, hold) in enumerate(segs):
        f += f'[{ix[src]}:v]trim={a:.3f}:{b:.3f},setpts=PTS-STARTPTS,fps=30,scale=1280:720,setsar=1,format=yuv420p' + (f',tpad=stop_mode=clone:stop_duration={hold:.3f}' if hold > 0 else '') + f'[p{i}];'
        labels += f'[p{i}]'
    pic = sum(b - a + h for _, a, b, h in segs)
    f += f'{labels}concat=n={len(segs)}:v=1:a=0,tpad=stop_mode=clone:stop_duration={max(0, T - pic) + 0.1:.3f},trim=0:{T:.4f},setpts=PTS-STARTPTS[v]'
    ff(*sum((['-i', s] for s in srcs), []), '-filter_complex', f, '-map', '[v]', '-frames:v', str(round(T * 30)), '-c:v', 'libx264', '-crf', '18', '-pix_fmt', 'yuv420p', '-r', '30', '-an', f'v3/w{n}-v.mp4')
    for kind in ('full', 'screen'):
        use = [x for x in audio if kind == 'full' or not x[2]]
        inputs, af = [], ''
        for j, (file, at, _) in enumerate(use):
            inputs += ['-i', file]; ms = int(round(at * 1000))
            af += f'[{j}:a]adelay={ms}[a{j}];'
        if use: af += ''.join(f'[a{j}]' for j in range(len(use))) + f'amix=inputs={len(use)}:duration=longest:normalize=0,apad=whole_len={round(T * 48000)},atrim=end_sample={round(T * 48000)}[a]'
        else: af = f'anullsrc=r=48000:cl=mono,atrim=end_sample={round(T * 48000)}[a]'
        ff(*inputs, '-filter_complex', af, '-map', '[a]', *WAV, f'v3/w{n}-{kind}.wav')
    return T

def plain(n, src, k, segs=None, tail=None, pre=None):
    """A narrated beat: the line starts 0.25 s in; the picture is cut (or its last frame held) to end `tail` after it."""
    end = 0.25 + SP[k][1]; T = end + (TAIL if tail is None else tail)
    if segs is None: segs = [(src, 0, dur(src), 0)]
    if pre: segs = pre + segs
    T = build(n, segs, [(f'v3/{k}.wav', 0.25, True)], T); return None, T

beats = {}
# Beat 0: title card + payoff loop.
beats[0] = plain(0, 'beat-0.webm', 'b0')
beats[1] = plain(1, 'n1.mp4', 'b1', tail=TAIL_SHORT)
beats[2] = plain(2, 'n2.mp4', 'b2')
# Beat 3: the terminal replay (to the "done in" line), then the review report's first screen.
# The three-tier card (record-beats.mjs beat 13) lands its first line on "the raw color" (the pause after "three
# tiers:"), stays through the benefit line, and the beat ends on the terminal's "done in" line for "twenty-three seconds".
q3 = [q for q in quiet('v3/b3.wav', d=0.12)]
tiers = next(b for a, b in q3 if b - a > 0.4 and a > 5.0)          # end of the pause after "on three tiers:"
secs = next(b for a, b in q3 if a > tiers + 6.0)                    # end of the pause before "Twenty-three seconds"
c0 = 0.25 + tiers - 0.3                                             # card start: its first line shows 0.3 s in
T3 = 0.25 + SP['b3'][1] + TAIL_SHORT
beats[3] = plain(3, 'n3.mp4', 'b3', [('n3.mp4', 0.6, 0.6 + c0, 0), ('beat-13.webm', 0, 0.25 + secs - 0.2 - c0, 0), ('n3.mp4', 9.0, 9.4, max(0, T3 - (0.25 + secs - 0.2) - 0.4))], tail=TAIL_SHORT)
# Beat 4: keep the end (the terminal's 21/21); trim the opening dwell to fit the shorter line.
T4 = 0.25 + SP['b4'][1] + TAIL_SHORT; V4 = dur('n4.mp4')
beats[4] = plain(4, 'n4.mp4', 'b4', [('n4.mp4', max(0, V4 - T4), V4, 0)], tail=TAIL_SHORT)
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
c2 = min(max(endC1 + 0.3, card - 0.1), endC1 + 1.2)
endC2 = say('b6c2', c2)
T6 = endC2 + 1.1
hold_used = T6 - card
add(V2, e2['done3'] - 0.05, e2['end'])
T6 = build(6, segs, aud, T6); hold_used = T6 - card; beats[6] = (None, T6)
# Beat 7 opens on the rest of the BLOCKED card (a J-cut: the beat 7 line starts over it), then the 28-site table.
pre7 = [(V2, e2['done3'] - 0.05 + hold_used, e2['done3'] - 0.05 + hold_used + 1.3, 0)]
beats[7] = plain(7, 'n7.mp4', 'b7', pre=pre7, tail=TAIL_SHORT)
# Beat 9: contrast row held through the why-now line, axe-core card, focus numbers card, dark mode.
T9 = 0.25 + SP['b9'][1] + TAIL
# The dark-mode picture is no longer narrated: a short hold at the end (the toggle at 24.07 s in n9-v2, then dark),
# under the line's last words (a silent hold would break the 1.5 s pause rule).
DARK = float(os.environ.get('V3_DARK', '2.5'))
fixed = 7.13 + 10.0 + 2.5 + DARK
segs9 = [('n9-v2.mp4', 0, 7.13, max(0, T9 - fixed)), ('n9-v2.mp4', 7.13, 17.13, 0), ('n9-v2.mp4', 17.13, 19.63, 0)] + ([('n9-v2.mp4', 23.6, 23.6 + DARK, 0)] if DARK > 0 else [])
beats[9] = plain(9, 'n9-v2.mp4', 'b9', segs9)
beats[8] = plain(8, 'beat-8.webm', 'b8', tail=1.2)

# 3. Stitch: video by stream copy; audio as one float WAV, loudnorm two-pass (linear, measured values), then one AAC
# encode (256 kbps, 48 kHz stereo) muxed with the copied video. The screen track gets the same linear gain. Over 3:00
# the outputs get an -over suffix instead of replacing the cut (set V3_ALLOW_OVER=1 to override).
ORDER = [0, 1, 2, 3, 4, 5, 6, 7, 9, 8]
total = sum(beats[n][1] for n in ORDER)
SUF = '' if total <= 180 or os.environ.get('V3_ALLOW_OVER') else '-over'
open('v3/list-v.txt', 'w').write(''.join(f"file 'w{n}-v.mp4'\n" for n in ORDER))
ff('-f', 'concat', '-safe', '0', '-i', 'v3/list-v.txt', '-c', 'copy', 'v3/picture.mp4')
for kind in ('full', 'screen'):
    ins = sum((['-i', f'v3/w{n}-{kind}.wav'] for n in ORDER), [])
    ff(*ins, '-filter_complex', ''.join(f'[{i}:a]' for i in range(len(ORDER))) + f'concat=n={len(ORDER)}:v=0:a=1[a]', '-map', '[a]', *WAV, f'v3/bed-{kind}.wav')
pre = -16.0 - lufs('v3/bed-full.wav')                                  # bring it near -16, then limit sample peaks to -2.5 dBFS (about -2 dBTP)
ff('-i', 'v3/bed-full.wav', '-af', f'volume={pre:.3f}dB,alimiter=limit=0.7499:attack=1:release=50:level=false', *WAV, 'v3/bed-full-lim.wav')
ff('-i', 'v3/bed-screen.wav', '-af', f'volume={pre:.3f}dB,alimiter=limit=0.7499:attack=1:release=50:level=false', *WAV, 'v3/bed-screen-lim.wav')
m = json.loads(re.findall(r'\{[^{}]*"input_i"[^{}]*\}', subprocess.run(['ffmpeg', '-i', 'v3/bed-full-lim.wav', '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11:print_format=json', '-f', 'null', '-'], capture_output=True, text=True).stderr)[-1])
LN = f"loudnorm=I=-16:TP=-1.5:LRA=11:linear=true:measured_I={m['input_i']}:measured_TP={m['input_tp']}:measured_LRA={m['input_lra']}:measured_thresh={m['input_thresh']}:offset={m['target_offset']}:print_format=json"
r2 = subprocess.run(['ffmpeg', '-y', '-i', 'v3/bed-full-lim.wav', '-af', LN + ',aresample=48000', '-ac', '1', '-c:a', 'pcm_f32le', 'v3/master-full.wav'], capture_output=True, text=True).stderr
n2 = json.loads(re.findall(r'\{[^{}]*"normalization_type"[^{}]*\}', r2)[-1])
gain = float(n2['output_i']) - float(m['input_i'])
ff('-i', 'v3/bed-screen-lim.wav', '-af', f'volume={gain:.3f}dB', '-ac', '1', '-c:a', 'pcm_f32le', 'v3/master-screen.wav')
OUTS = (('full', f'demo-v3-vo{SUF}.mp4'), ('screen', f'screen-track{SUF}.mp4'))
for kind, out in OUTS:
    ff('-i', 'v3/picture.mp4', '-i', f'v3/master-{kind}.wav', '-map', '0:v', '-map', '1:a', '-c:v', 'copy', '-c:a', 'aac', '-b:a', '256k', '-ar', '48000', '-ac', '2', '-movflags', '+faststart', '-shortest', out)
table, t = [], 0.0
for n in ORDER:
    T = beats[n][1]; table.append({'beat': n, 'start': round(t, 2), 'len': round(T, 2)}); t += T
json.dump({'tempo': TEMPO, 'pause': PAUSE, 'vo': VO_DIR, 'loudnorm': {'measured': m, 'second': n2}, 'beats': table, 'beat6': {'requestSpeechAt': marks, 'speechStarts': cues, 'blockedCardAt': round(card, 2), 'itsBlockedAt': round(c2, 2)}}, open(f'v3/beats{SUF}.json', 'w'), indent=1)
for b in table: print(f"beat {b['beat']}: {b['start']:6.1f}s  len {b['len']:5.1f}s")
print('total', round(total, 2), '->', OUTS[0][1], 'loudnorm', n2['normalization_type'], 'out I', n2['output_i'], 'TP', n2['output_tp'])
