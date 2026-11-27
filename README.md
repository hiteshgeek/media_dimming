# Media Layer

An adaptive brightness limiter for YouTube — the visual equivalent of an audio
limiter. It measures how bright each frame actually is and holds a dimming layer
over the video so sudden white frames and flashes never reach full intensity.

Built for photophobia / migraine triggers when watching at night.

## Install

1. Open `chrome://extensions`
2. Turn on **Developer mode** (top right)
3. Click **Load unpacked** and select this folder
4. Open any YouTube video; click the toolbar icon to tune it

Works in Chrome, Edge, Brave, Opera and any other Chromium browser.

## How it works

### What gets dimmed: white, and only white

Brightness is the wrong test. A saturated orange banner is bright and must
not move; a white background must. What separates them is that white has no
chroma, so the measure is

    measure = min(R,G,B) - strictness x (max(R,G,B) - min(R,G,B))

clamped at zero. `min(R,G,B)` is the white content of a pixel - 1.0 for white,
about 0.5 for skin, 0.0 for a saturated colour. Subtracting chroma pushes
anything carrying real colour to zero, where no ceiling can touch it.

Everything above the ceiling is then scaled by a single gain derived from that
measure, so all three channels move together and hue survives. Clipping each
channel on its own instead turns skin into flat grey, which is what an earlier
version did.

Bucketing a real thumbnail by how much colour each pixel carries, at the
shipped defaults:

| chroma in the pixel | left at |
|---|---|
| 0-2%, true white | 49% |
| 2-5%, near neutral | 77% |
| 5-10%, off-white | 100% |
| 10-20%, skin and cream | 100% |
| anything more saturated | 100% |

### Where it is applied

Both the player and every thumbnail on the page run the same curve, built from
SVG filter primitives:

    rr,gg,bb           channel splats
    feBlend darken x2  w := min(R,G,B)
    feBlend lighten x2 v := max(R,G,B)
    feComposite        m := (1+strict)*w - strict*v      clamped to 0..1
    feComponentTransfer  g := min(1, ceiling / m)
    feComposite        out := SourceGraphic * g

`min` and `max` across channels are not linear, so no single feColorMatrix can
express them; `darken` and `lighten` are per-channel min and max, so folding
three channel splats through them gets there.

Thumbnails are static, so one filter in the page covers all of them with no
sampling and no DOM injection - nothing to re-attach when YouTube rebuilds the
feed. The player is excluded from that rule since it runs its own pipeline.

### The video ceiling moves

For video the ceiling adapts every frame. A 48x27 canvas readback gives a
Rec.709 luma histogram of the source, and the ceiling drops when a large
share of the frame is bright, since a mostly-white frame floods the eye more
than a single bright lamp at the same peak. It also holds the brightest pixel
to a multiple of the scene's own median, because on a dark shot the eye is
adapted to the gloom and white titles still glare.

A flash guard watches the source signal for sudden jumps and drops the ceiling
hard for 400 ms. It has to watch the source: measuring the already-limited
result squeezes it into a narrow range and makes the threshold fire on every
ordinary cut, which pins the limiter down permanently.

### Schedule

By default the whole thing only runs between 10 pm and 6 am; outside that it
turns itself off. The window can be set to any custom times, or to all day.
Nothing fires when the clock crosses the edge, so the content script polls it
every two seconds and switches over without needing a page reload.

## Controls

Three presets to start from: **Gentle**, **Night** (default), **Strict**.

| Setting | What it does |
|---|---|
| **Schedule** | 10 pm - 6 am, custom hours, or all day. Off outside the window. |
| **Selective / Whole frame** | Per-pixel ceiling, or an even global dim. |
| **Brightness ceiling** | How dark white is allowed to get. |
| **White strictness** | How much a trace of colour exempts a pixel. Lower it to bring off-white down too. |
| **Clip hardness** | Softer keeps bright-area detail, but passes more light. |
| **Dark scene limit** | Holds the brightest pixel to a multiple of the scene's own level. |
| **Large bright areas** | Tightens the ceiling as more of the frame goes bright. |
| **Thumbnails** | Same curve on the feed, with its own ceiling or matched to the video. |
| **Flash guard** | Instant clamp on sudden luminance jumps. |

Up to five named presets can be saved. Every action that replaces settings
wholesale is undoable.

Shortcuts: `Alt+Shift+D` toggle, `Alt+Shift+Down/Up` ceiling down/up.

## Known limits

- **One frame of latency.** The frame is sampled, then the new opacity composites
  on the next paint — roughly 16 ms at 60 Hz. A flash is clamped from its first
  or second displayed frame, not before it. Eliminating this entirely requires
  buffered playback (see below).
- **DRM content** (rented films, some music videos) returns unreadable pixels,
  so the adaptive stage goes passive. The fixed ceiling still applies.
- Reloading the extension orphans content scripts in open tabs, so the service
  worker reloads matching tabs on update. Without that, every change looks like
  it did nothing.
- Only YouTube in the browser — not the mobile or TV app.

## Possible v2: true lookahead

Real audio limiters avoid all overshoot by delaying the signal and looking ahead.
The same is possible here: render the video into a canvas displayed ~100 ms
behind, delay the audio by the same amount with a WebAudio `DelayNode` to keep
lip-sync, and compute gain from frames before they are shown. That gives genuine
zero-overshoot limiting, at the cost of higher CPU use and a seek/scrub delay.

After changing the extension files, hit reload on `chrome://extensions`, then
reload the YouTube tab.
