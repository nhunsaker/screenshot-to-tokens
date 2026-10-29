#!/usr/bin/env python3
# Lay the voiceover onto each recorded beat and stitch the cut (docs/demo-script.md). Beat n uses out/video/n<n>.mp4,
# vo/vo-<n>.mp3 (vo0/vo-1.mp3 for the intro) and, if present, a second line vo2/b<n>/vo-1.mp3 spoken 0.6 s after
# the first. When speech outlasts the picture the last frame holds. Output: out/video/demo-v1-vo.mp4 at -16 LUFS.
# --v2: beat 6 is Point and say (n6-v2.mp4, scripts/record-pas-beat.mjs + scripts/cut-pas-beat.py) and beat 9 has the
# focus numbers card (n9-v2.mp4); their lines are vo-v2/b6 and vo-v2/b9. Output: out/video/demo-v2-vo.mp4; v1 untouched.
# --v3: the final cut with spoken requests and the re-paced beats (scripts/mix_v3.py): demo-v3-vo.mp4 + screen-track.mp4.
#   python3 scripts/mix-demo.py [--v2 | --v3]
import subprocess, os, sys
if '--v3' in sys.argv:
    import runpy; runpy.run_path(os.path.join(os.path.dirname(os.path.abspath(__file__)), 'mix_v3.py'), run_name='__main__'); sys.exit(0)
V2='--v2' in sys.argv
os.chdir('out/video')
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).strip())
lst=[]; t=0
for n in [0,1,2,3,4,5,6,7,9,8]:
    new=V2 and n in (6,9); src=f'n{n}-v2.mp4' if new else f'n{n}.mp4'; wout=f'w{n}-v2.mp4' if new else f'w{n}.mp4'
    V=dur(src); main=f'vo-v2/b{n}/vo-1.mp3' if new else ('vo0/vo-1.mp3' if n==0 else ('vo9/vo-1.mp3' if n==9 else f'vo/vo-{n}.mp3')); A=dur(main); ex=f'vo2/b{n}/vo-1.mp3'
    if new: ex=f'vo-v2/b{n}/extra.mp3'  # none: the v2 line replaces both
    inputs=['-i',src,'-i',main]; end=0.25+A
    if os.path.exists(ex):
        start2=end+0.6; E=dur(ex); end=start2+E; inputs+=['-i',ex]; d2=int(start2*1000)
        af=f'[1:a]adelay=250|250[a1];[2:a]adelay={d2}|{d2}[a2];[a1][a2]amix=inputs=2:duration=longest:normalize=0,apad[a]'
    else: af='[1:a]adelay=250|250,apad[a]'
    T=max(V,end+0.3)
    if V2: T=max(end+0.3,min(V,end+0.6))  # v2: cut a picture tail that would leave a pause over 1.5 s at the cut
    pad=max(0,T-V)+0.05
    subprocess.run(['ffmpeg','-y','-loglevel','error',*inputs,'-filter_complex',f'[0:v]tpad=stop_mode=clone:stop_duration={pad:.2f}[v];{af}','-map','[v]','-map','[a]','-t',f'{T:.2f}','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-c:a','aac','-ar','44100','-ac','2',wout],check=True)
    print(f'beat {n}: at {t:5.1f}s  len {T:4.1f}s  (video {V:.1f}, speech ends {end:.1f})'); t+=T; lst.append(f"file '{wout}'")
LIST='list-w-v2.txt' if V2 else 'list-w.txt'; OUTF='demo-v2-vo.mp4' if V2 else 'demo-v1-vo.mp4'
open(LIST,'w').write('\n'.join(lst)+'\n')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i',LIST,'-c','copy','tmp.mp4'],check=True)
subprocess.run(['ffmpeg','-y','-loglevel','error','-i','tmp.mp4','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-ar','44100',OUTF],check=True)
os.remove('tmp.mp4'); print('total', round(dur(OUTF),1))
