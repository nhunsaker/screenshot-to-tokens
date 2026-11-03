#!/usr/bin/env python3
"""Ad audio prep: trim each VO clip's leading/trailing silence (keep 0.15 s), level-match to -20 LUFS (linear gain,
no tempo change), 48 kHz mono float WAV. Writes out/ad45/work/vo-*.wav and out/ad45/work/vo.json (durations and
speech segments from silencedetect, used to time overlays and captions)."""
import json, re, subprocess, os
ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
A = os.path.join(ROOT, 'out/ad45'); W = os.path.join(A, 'work'); os.makedirs(W, exist_ok=True)
NARR = os.environ.get('AD_NARR', 'narrator-v2')
CLIPS = [('n1', NARR + '/vo-1.mp3'), ('n2', NARR + '/vo-2.mp3'), ('n3', NARR + '/vo-3.mp3'), ('n4', NARR + '/vo-4.mp3'),
         ('n5', NARR + '/vo-5.mp3'), ('req', 'request/vo-1.mp3'), ('n6', NARR + '/vo-6.mp3'), ('n7', NARR + '/vo-7.mp3'),
         ('n8', NARR + '/vo-8.mp3')]
TRIM = 'silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse,silenceremove=start_periods=1:start_threshold=-50dB:start_silence=0.15,areverse'
def run(*a): return subprocess.run(a, capture_output=True, text=True, check=True)
def dur(p): return float(run('ffprobe', '-v', 'error', '-show_entries', 'format=duration', '-of', 'csv=p=0', p).stdout)
out = {}
for k, src in CLIPS:
    t = os.path.join(W, f'{k}-trim.wav')
    run('ffmpeg', '-v', 'error', '-y', '-i', os.path.join(A, src), '-af', f'aresample=48000,{TRIM}', '-ac', '1', '-c:a', 'pcm_f32le', t)
    e = run('ffmpeg', '-hide_banner', '-nostats', '-i', t, '-af', 'ebur128', '-f', 'null', '-').stderr
    lufs = float(re.findall(r'I:\s+(-?[\d.]+) LUFS', e)[-1])
    f = os.path.join(W, f'{k}.wav')
    run('ffmpeg', '-v', 'error', '-y', '-i', t, '-af', f'volume={-20 - lufs:.2f}dB', '-c:a', 'pcm_f32le', f)
    s = run('ffmpeg', '-hide_banner', '-nostats', '-i', f, '-af', 'silencedetect=n=-40dB:d=0.12', '-f', 'null', '-').stderr
    st = [float(x) for x in re.findall(r'silence_start: (-?[\d.]+)', s)]; en = [float(x) for x in re.findall(r'silence_end: ([\d.]+)', s)]
    d = dur(f); out[k] = {'dur': round(d, 3), 'lufs_in': lufs, 'silences': [[round(a, 2), round(b, 2)] for a, b in zip(st, en)]}
    print(k, out[k])
json.dump(out, open(os.path.join(W, 'vo.json'), 'w'), indent=1)
