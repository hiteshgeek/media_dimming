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

### Selective mode (default) - per pixel

A grey layer with `mix-blend-mode: darken` over the video. Compositing makes
this `min(pixel, ceiling)` on every pixel **independently**. Only pixels
brighter than the ceiling move; everything already darker passes through
untouched. A bright window in one corner of the frame gets capped while the
rest of the shot is left exactly as it is. There is no global brightness
change at all, so dark scenes are mathematically unaffected.

The ceiling itself is dynamic, for two reasons:

- **Area.** A frame that is 90% white floods the eye far more than one with a
  single bright lamp, even though both peak at the same value. So the ceiling
  drops as the bright *fraction* of the frame grows. The fraction is measured
  against the fixed nominal ceiling, never the effective one - measuring
  against the effective ceiling would feed back on itself and run away.
- **Flash.** A sudden jump in source luminance drops the ceiling hard for
  400 ms, then releases. Still per pixel: the dark parts never change.

### Whole frame mode - global

`filter: brightness()` on the video element, driven by `--ml-gain` from frame
analysis with fast attack and slow release. Brings everything down evenly.
Injected content-script CSS always applies, so this needs no DOM surgery.

### Measurement

Every ~20 ms the frame is drawn into a 48x27 offscreen canvas and its Rec.709
luma histogram computed. Canvas reads the *source* video, so analysis always
sees the real signal rather than the already-limited result. Flash detection
in particular must run on the source: measuring the post-ceiling signal
squeezes it into a narrow range and makes the threshold fire on every
ordinary cut, which pins the limiter down permanently.

Both the layer and the filter are scoped so that **subtitles and player
controls stay at full brightness**.

## Measured

A real cut-to-white YouTube frame (film posters on a cream background)
measures 81.7% mean luma with 85% of the frame above the ceiling. In
Selective mode on the Night preset the ceiling drops to 17%, so the
background is capped there while pixels already below it - the posters -
stay at their original values throughout.

## Controls

Three presets to start from: **Gentle**, **Night** (default), **Strict**.

| Setting | What it does |
|---|---|
| **Brightness ceiling** | Hard cap. Nothing on screen may exceed this. Dark areas untouched. |
| **Clip hardness** | Softer keeps more detail in bright areas, lets more light through. |
| **Average scene target** | Level the adaptive stage aims to hold, after the ceiling. |
| **Maximum extra dimming** | How far the adaptive stage may go. |
| **Always-on dim** | A constant reduction applied to everything. |
| **Recovery speed** | How slowly brightness returns. Slower = less pumping. |
| **Flash guard** | Instant brickwall clamp on sudden luminance jumps. |

The popup meter shows the video's real brightness against what you are
actually being shown.

Shortcuts: `Alt+Shift+D` toggle, `Alt+Shift+Down/Up` dim more/less.

## Known limits

- **One frame of latency.** The frame is sampled, then the new opacity composites
  on the next paint — roughly 16 ms at 60 Hz. A flash is clamped from its first
  or second displayed frame, not before it. Eliminating this entirely requires
  buffered playback (see below).
- **DRM content** (rented films, some music videos) returns unreadable pixels,
  so the adaptive stage goes passive. The ceiling layer still works.
- Only YouTube in the browser — not the mobile or TV app.

## Possible v2: true lookahead

Real audio limiters avoid all overshoot by delaying the signal and looking ahead.
The same is possible here: render the video into a canvas displayed ~100 ms
behind, delay the audio by the same amount with a WebAudio `DelayNode` to keep
lip-sync, and compute gain from frames before they are shown. That gives genuine
zero-overshoot limiting, at the cost of higher CPU use and a seek/scrub delay.

After changing the extension files, hit reload on `chrome://extensions`, then
reload the YouTube tab.
