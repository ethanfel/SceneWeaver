# Synthetic playback fixtures

These test fixtures contain a solid-color silent video and a sine-wave tone. They contain no user media or project data.

Regenerate with FFmpeg:

```bash
ffmpeg -f lavfi -i color=c=0x263a4d:s=160x90:r=24:d=6 -an -c:v libvpx-vp9 -b:v 30k -y silent-clip.webm
ffmpeg -f lavfi -i sine=frequency=220:sample_rate=8000:duration=30 -c:a pcm_s16le -y audio.wav
```

Normal test runs use the committed files and do not require FFmpeg.
