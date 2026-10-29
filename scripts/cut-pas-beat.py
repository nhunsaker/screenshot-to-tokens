#!/usr/bin/env python3
# Demo beat 6 for the v2 cut: the first 6 s of the old beat 6 (proposal link + Show original, Sorb's see-it-live),
# then the Point and say take (scripts/record-pas-beat.mjs) with its waits shortened. Cut points come from the take's
# own event times (out/video/beat-6-pas.json). The 9 s focus check keeps about 2 s on screen, under the caption
# "takes about 9 s, shortened here", then jumps to its result (which shows the real check time). Output: n6-v2.mp4.
#   python3 scripts/cut-pas-beat.py
import json, subprocess, os
os.chdir('out/video')
e = json.load(open('beat-6-pas.json'))['events']
segs = [
    (e['ready'] + 1.5, e['done1'] + 1.83),          # intro caption, click, SAM outline, typing, contrast result
    (e['click2'] - 0.44, e['checkStart'] + 2.0),    # sidebar click, focus line, first 2 s of the focus check
    (e['checkEnd'] - 0.19, e['checkEnd'] + 1.66),   # focus result
    (e['tab0'] - 0.05, e['tab2'] + 0.74),           # Tab, Tab: the ring
]
f = '[0:v]trim=0:6,setpts=PTS-STARTPTS,fps=30[a];[1:v]fps=30,split=%d%s;' % (len(segs), ''.join(f'[b{i}]' for i in range(len(segs))))
f += ''.join(f'[b{i}]trim={s:.2f}:{t:.2f},setpts=PTS-STARTPTS[s{i}];' for i, (s, t) in enumerate(segs))
f += '[a]' + ''.join(f'[s{i}]' for i in range(len(segs))) + f'concat=n={len(segs) + 1}:v=1:a=0,format=yuv420p[v]'
subprocess.run(['ffmpeg', '-y', '-loglevel', 'error', '-i', 'n6.mp4', '-i', 'beat-6-pas.webm', '-filter_complex', f, '-map', '[v]', '-c:v', 'libx264', '-r', '30', 'n6-v2.mp4'], check=True)
print('segments', [(round(s, 2), round(t, 2)) for s, t in segs], 'shortened focus wait by', round(e['checkEnd'] - 0.19 - e['checkStart'] - 2.0, 1), 's')
