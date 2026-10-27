#!/usr/bin/env python3
# Lay the voiceover onto each recorded beat and stitch the cut (docs/demo-script.md). Beat n uses out/video/n<n>.mp4,
# vo/vo-<n>.mp3 (vo0/vo-1.mp3 for the intro) and, if present, a second line vo2/b<n>/vo-1.mp3 spoken 0.6 s after
# the first. When speech outlasts the picture the last frame holds. Output: out/video/demo-v1-vo.mp4 at -16 LUFS.
#   python3 scripts/mix-demo.py
import subprocess, os
os.chdir('out/video')
def dur(f): return float(subprocess.check_output(['ffprobe','-v','error','-show_entries','format=duration','-of','csv=p=0',f]).strip())
lst=[]; t=0
for n in range(0,9):
    V=dur(f'n{n}.mp4'); main='vo0/vo-1.mp3' if n==0 else f'vo/vo-{n}.mp3'; A=dur(main); ex=f'vo2/b{n}/vo-1.mp3'
    inputs=['-i',f'n{n}.mp4','-i',main]; end=0.4+A
    if os.path.exists(ex):
        start2=end+0.6; E=dur(ex); end=start2+E; inputs+=['-i',ex]; d2=int(start2*1000)
        af=f'[1:a]adelay=400|400[a1];[2:a]adelay={d2}|{d2}[a2];[a1][a2]amix=inputs=2:duration=longest:normalize=0,apad[a]'
    else: af='[1:a]adelay=400|400,apad[a]'
    T=max(V,end+0.8); pad=max(0,T-V)+0.05
    subprocess.run(['ffmpeg','-y','-loglevel','error',*inputs,'-filter_complex',f'[0:v]tpad=stop_mode=clone:stop_duration={pad:.2f}[v];{af}','-map','[v]','-map','[a]','-t',f'{T:.2f}','-c:v','libx264','-pix_fmt','yuv420p','-r','30','-c:a','aac','-ar','44100','-ac','2',f'w{n}.mp4'],check=True)
    print(f'beat {n}: at {t:5.1f}s  len {T:4.1f}s  (video {V:.1f}, speech ends {end:.1f})'); t+=T; lst.append(f"file 'w{n}.mp4'")
open('list-w.txt','w').write('\n'.join(lst)+'\n')
subprocess.run(['ffmpeg','-y','-loglevel','error','-f','concat','-safe','0','-i','list-w.txt','-c','copy','tmp.mp4'],check=True)
subprocess.run(['ffmpeg','-y','-loglevel','error','-i','tmp.mp4','-c:v','copy','-af','loudnorm=I=-16:TP=-1.5:LRA=11','-c:a','aac','-ar','44100','demo-v1-vo.mp4'],check=True)
os.remove('tmp.mp4'); print('total', round(dur('demo-v1-vo.mp4'),1))
