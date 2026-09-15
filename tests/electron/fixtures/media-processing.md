# T133 Media Fixture

`media-processing.webm` is a deterministic, silent 184-second VP8 video with a moving
test pattern, 160 by 90 pixels, 2 frames per second. It crosses the three-minute
processing boundary without requiring a large binary fixture or network access.
The VTT contains cues on both sides of that boundary.

Generate with FFmpeg 7.0.2 (the test run itself does not require FFmpeg):

```sh
ffmpeg -f lavfi -i testsrc2=size=160x90:rate=2:duration=184 \
  -an -c:v libvpx -deadline realtime -cpu-used 8 -b:v 32k -g 20 \
  -map_metadata -1 -fflags +bitexact -flags:v +bitexact media-processing.webm
```

The Electron test calls the real HTML media player's `play`, `pause`, and
`currentTime` APIs. It never injects player events or coverage records.
