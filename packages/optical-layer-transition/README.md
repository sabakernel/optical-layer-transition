# @sabakernel/optical-layer-transition

A WebGL 2.0-powered image transition engine. It composites multiple images as layers and blends them with an optical particle-noise effect. When WebGL 2.0 is unavailable, it automatically falls back to Canvas 2D (CPU) rendering.

See the [repository README](https://github.com/sabakernel/optical-layer-transition) for full documentation.

## Usage

```ts
import { OpticalTransition } from "@sabakernel/optical-layer-transition";

const canvas = document.querySelector("canvas")!;
const transition = new OpticalTransition({ canvas, width: 1280, height: 720 });

await transition.setLayer({
  images: [
    {
      url: "/images/background.jpg",
      startX: 0,
      startY: 0,
      endX: 1280,
      endY: 720,
    },
    { url: "/images/logo.png", startX: 32, startY: 32, endX: 256, endY: 160 },
  ],
  duration: 1.8,
});

await transition.setLayer({
  images: [{ url: "/images/next-scene.jpg" }],
  duration: 1.8,
});

transition.play();
```
