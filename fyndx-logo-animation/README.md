# FyndX logo animation

This folder contains a reproducible, programmatically generated FyndX logo
animation based on `fyndx-logo-source.png`.

The static PNG and both GIFs have transparent backgrounds. The H.264 MP4
preview is composited over the source black colour because standard H.264 MP4
does not support an alpha channel.

The generated artwork uses `#001264` as its exact blue base and `#DAB111` as
its exact gold base. Restrained tonal variants of those bases preserve the
original embossed shadows and metallic highlights.

## Outputs

- `fyndx-logo-transparent.png` — background-removed source logo at 1404×864.
- `fyndx-logo-animated.gif` — transparent 1404×864 animation, infinitely looping.
- `fyndx-logo-animated-small.gif` — transparent 800px-wide animation.
- `preview.mp4` — high-quality H.264 preview of the same animation at 25 FPS.

The sequence traces the vertical of `F` from bottom to top, then draws both
horizontal bars together. Both stems of `y` begin at the top and descend
together, followed by the logo's complete lower y curve. The `d` starts at its
upper stem, moves down, and then traces its bowl clockwise. The animation then
draws the first gold X diagonal and traces the second gold curve continuously
from the top-right through its bottom-left underline endpoint before drawing
the blue swoosh. A surface-only metallic shine follows, then the completed logo
holds and performs a short reverse path reset.

The supplied raster contains only the two visible arms of the first X diagonal;
its middle is hidden by the foreground gold curve. The animation preserves
those exact source pixels instead of inventing a temporary connector, so that
stroke does not bend, change width, or snap into a different shape when the
foreground curve reaches it.

## Install and regenerate

Run these commands from this folder:

```bash
python3 -m venv .venv
source .venv/bin/activate
python -m pip install --upgrade pip
python -m pip install "Pillow>=10.4,<13" "numpy>=1.26,<3" \
  "opencv-python-headless>=4.10,<6" "imageio-ffmpeg>=0.5,<1"
python fyndx-logo-animation.py
```

The `imageio-ffmpeg` package supplies the FFmpeg binary used for the MP4, so a
separate system FFmpeg installation is not required.

Optional arguments:

```bash
python fyndx-logo-animation.py \
  --source ./fyndx-logo-source.png \
  --output-dir . \
  --fps 25 \
  --small-width 800
```

The GIF encoder uses a fixed no-dither palette, removes isolated one-pixel
debris, and resizes small-GIF alpha with a monotonic filter to prevent crawling
edges. The script validates component topology, phase monotonicity, the old
stray-pixel regions, completed-frame fidelity, every decoded GIF alpha frame,
transparent loop reset, GIF metadata and duration, and MP4 dimensions/timing
before reporting success.
