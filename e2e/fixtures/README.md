# Synthetic playback fixtures

These test fixtures contain a solid-color silent video, an animated test pattern, and a sine-wave tone. They contain no user media or project data.

Regenerate with FFmpeg:

```bash
ffmpeg -f lavfi -i color=c=0x263a4d:s=160x90:r=24:d=6 -an -c:v libvpx-vp9 -b:v 30k -y silent-clip.webm
ffmpeg -f lavfi -i sine=frequency=220:sample_rate=8000:duration=30 -c:a pcm_s16le -y audio.wav
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=4:duration=1 -loop 0 -c:v libwebp_anim -y sampling.webp
ffmpeg -f lavfi -i color=c=0x263a4d:s=160x90:r=24:d=2 -an -c:v libx264 -pix_fmt yuv420p -movflags +faststart -y sampling.mp4
```

Normal test runs use the committed files and do not require FFmpeg.
