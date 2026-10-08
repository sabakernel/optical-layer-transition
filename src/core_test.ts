import { OpticalTransition } from "./core.ts";
import type { ImageLayer } from "./types.ts";

type CompositeCanvas = HTMLCanvasElement & {
  id: string;
  composedImages: string[];
};

interface DrawnCanvas {
  id: string;
  alpha: number;
}

class LoadedImage {
  onload: (() => void) | null = null;
  onerror: (() => void) | null = null;
  crossOrigin: string | null = null;
  private sourceUrl = "";

  get src(): string {
    return this.sourceUrl;
  }

  set src(value: string) {
    this.sourceUrl = value;
    queueMicrotask(() => this.onload?.());
  }
}

Deno.test("a layer composites multiple positioned images and transitions as one image", async () => {
  const originalImage = globalThis.Image;
  const originalDocument = globalThis.document;
  const originalRequestAnimationFrame = globalThis.requestAnimationFrame;
  const originalCancelAnimationFrame = globalThis.cancelAnimationFrame;
  const frames = new Map<number, FrameRequestCallback>();
  const drawnCanvases: DrawnCanvas[] = [];
  const compositeCanvases: CompositeCanvas[] = [];
  let nextFrameId = 1;
  const alphaStack: number[] = [];

  globalThis.Image = LoadedImage as unknown as typeof Image;
  globalThis.document = {
    createElement: (tag: string) => {
      if (tag !== "canvas") throw new Error(`Unexpected element: ${tag}`);
      const canvas = {
        id: `composite-${compositeCanvases.length}`,
        width: 0,
        height: 0,
        composedImages: [],
        getContext: () => ({
          drawImage: (image: LoadedImage, x: number, y: number) => {
            canvas.composedImages.push(`${image.src}@${x},${y}`);
          },
        }),
      } as unknown as CompositeCanvas;
      compositeCanvases.push(canvas);
      return canvas;
    },
  } as unknown as Document;
  globalThis.requestAnimationFrame = (callback) => {
    const id = nextFrameId++;
    frames.set(id, callback);
    return id;
  };
  globalThis.cancelAnimationFrame = (id) => {
    frames.delete(id);
  };

  const context = {
    globalAlpha: 1,
    clearRect: () => {
      drawnCanvases.length = 0;
    },
    drawImage: (canvas: CompositeCanvas) => {
      drawnCanvases.push({ id: canvas.id, alpha: context.globalAlpha });
    },
    save: () => alphaStack.push(context.globalAlpha),
    restore: () => {
      context.globalAlpha = alphaStack.pop() ?? 1;
    },
    beginPath: () => {},
    rect: () => {},
    clip: () => {},
    fillRect: () => {},
    set fillStyle(_value: string) {},
  };
  const canvas = {
    width: 0,
    height: 0,
    getContext: (kind: string) => kind === "webgl2" ? null : context,
  } as unknown as HTMLCanvasElement;
  const transition = new OpticalTransition({
    canvas,
    width: 100,
    height: 100,
  });

  const runFrame = (time: number) => {
    const nextFrame = frames.entries().next().value as
      | [number, FrameRequestCallback]
      | undefined;
    if (!nextFrame) throw new Error("Expected a pending animation frame.");
    frames.delete(nextFrame[0]);
    nextFrame[1](time);
  };

  try {
    const firstLayer: ImageLayer = {
      images: [
        { url: "background.png", startX: 0, startY: 0, endX: 50, endY: 50 },
        { url: "overlay.png", startX: 50, startY: 25, endX: 100, endY: 75 },
      ],
      duration: 1,
      clearAfterRender: true,
    };
    const secondLayer: ImageLayer = {
      images: [
        { url: "target-a.png", startX: 0, startY: 0, endX: 50, endY: 50 },
        { url: "target-b.png", startX: 50, startY: 50, endX: 100, endY: 100 },
      ],
      duration: 2,
    };
    await transition.setLayer(firstLayer);
    await transition.setLayer(secondLayer);

    if (
      compositeCanvases[0].composedImages.length !== 2 ||
      compositeCanvases[0].composedImages[1] !== "overlay.png@50,25" ||
      compositeCanvases[1].composedImages.length !== 2
    ) {
      throw new Error("Images should be composed into one canvas per layer.");
    }

    transition.play();
    const startTime = performance.now();
    runFrame(startTime + 1000);
    const halfwayTarget = drawnCanvases.find((image) =>
      image.id === compositeCanvases[1].id
    );
    if (
      !halfwayTarget || halfwayTarget.alpha < 0.45 ||
      halfwayTarget.alpha > 0.55
    ) {
      throw new Error("The whole composite layer should transition at 50%.");
    }

    runFrame(startTime + 2200);
    const waiting = transition.getPlaybackState();
    if (
      waiting.isFinished || waiting.isPlaying ||
      waiting.currentLayerIndex !== 1 || waiting.nextLayerIndex !== null
    ) {
      throw new Error("Playback should wait on the final composite layer.");
    }
    if (
      drawnCanvases.some((image) => image.id === compositeCanvases[0].id) ||
      !drawnCanvases.some((image) => image.id === compositeCanvases[1].id)
    ) {
      throw new Error(
        "clearAfterRender should clear the previous layer as one unit.",
      );
    }

    const finalLayer: ImageLayer = {
      images: [{ url: "final.png" }],
      duration: 1,
    };
    await transition.setLayer(finalLayer);
    if (transition.getPlaybackState().nextLayerIndex !== 2) {
      throw new Error("A waiting queue should accept another layer.");
    }

    transition.play();
    const nextStartTime = performance.now();
    runFrame(nextStartTime + 1100);
    if (transition.getPlaybackState().currentLayerIndex !== 2) {
      throw new Error("Playback should advance to the appended layer.");
    }

    await transition.finish();
    if (!transition.getPlaybackState().isFinished) {
      throw new Error("finish() should mark the final layer finished.");
    }
  } finally {
    transition.destroy();
    globalThis.Image = originalImage;
    globalThis.document = originalDocument;
    globalThis.requestAnimationFrame = originalRequestAnimationFrame;
    globalThis.cancelAnimationFrame = originalCancelAnimationFrame;
  }
});
