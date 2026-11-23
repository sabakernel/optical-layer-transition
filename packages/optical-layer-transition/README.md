# @sabakernel/optical-layer-transition

WebGL 2.0 ベースの画像遷移エンジン。複数の画像をレイヤーとして重ね、粒子状ノイズで滑らかに切り替えます。WebGL2 が利用できない環境では Canvas 2D の CPU フォールバックへ自動切り替わります。

詳細は[リポジトリの README](https://github.com/sabakernel/optical-layer-transition)を参照してください。

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
