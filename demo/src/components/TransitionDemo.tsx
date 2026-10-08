import { useEffect, useRef, useState } from "react";
import { OpticalTransition } from "@sabakernel/gl-noise-transition";
import type { ImageLayer, LayerImage } from "@sabakernel/gl-noise-transition";

type SampleImage = {
  name: string;
  url: string;
  firstColor: string;
  secondColor: string;
  transparent?: boolean;
};

const INITIAL_SIZE = { width: 1280, height: 720 };
const IMAGE_SIZE = { width: 320, height: 180 };
const SAMPLES: Omit<SampleImage, "url">[] = [
  { name: "Optical Noise", firstColor: "#102c2a", secondColor: "#286b58" },
  { name: "Convergence", firstColor: "#322c26", secondColor: "#b45c3e" },
  { name: "Afterimage", firstColor: "#183348", secondColor: "#358b9a" },
  {
    name: "Glass Overlay (transparent)",
    firstColor: "#50d9c0",
    secondColor: "#ffb56b",
    transparent: true,
  },
];

function createSampleImage(sample: Omit<SampleImage, "url">): string {
  const canvas = document.createElement("canvas");
  canvas.width = IMAGE_SIZE.width;
  canvas.height = IMAGE_SIZE.height;
  const context = canvas.getContext("2d");
  if (!context) throw new Error("2D canvas context is unavailable.");

  if (sample.transparent) {
    context.globalAlpha = 0.68;
    context.fillStyle = sample.firstColor;
    context.beginPath();
    context.ellipse(105, 90, 84, 72, -0.25, 0, Math.PI * 2);
    context.fill();
    context.fillStyle = sample.secondColor;
    context.beginPath();
    context.ellipse(215, 90, 72, 64, 0.25, 0, Math.PI * 2);
    context.fill();
    context.globalAlpha = 0.75;
    context.strokeStyle = "#fff";
    context.lineWidth = 3;
    context.beginPath();
    context.arc(160, 90, 57, -0.85, 2.2);
    context.stroke();
    context.globalAlpha = 1;
  } else {
    const gradient = context.createLinearGradient(
      0,
      0,
      IMAGE_SIZE.width,
      IMAGE_SIZE.height,
    );
    gradient.addColorStop(0, sample.firstColor);
    gradient.addColorStop(1, sample.secondColor);
    context.fillStyle = gradient;
    context.fillRect(0, 0, IMAGE_SIZE.width, IMAGE_SIZE.height);

    context.strokeStyle = "rgba(255, 255, 255, 0.18)";
    context.lineWidth = 2;
    for (let x = -IMAGE_SIZE.height; x < IMAGE_SIZE.width; x += 36) {
      context.beginPath();
      context.moveTo(x, 0);
      context.lineTo(x + IMAGE_SIZE.height, IMAGE_SIZE.height);
      context.stroke();
    }
  }

  context.fillStyle = "#fff";
  context.font = "600 25px 'Space Grotesk', sans-serif";
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(sample.name, IMAGE_SIZE.width / 2, IMAGE_SIZE.height / 2);
  return canvas.toDataURL("image/png");
}

export default function TransitionDemo() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const rendererRef = useRef<OpticalTransition | null>(null);
  const samplesRef = useRef<SampleImage[]>([]);
  const [size, setSize] = useState(INITIAL_SIZE);
  const [x, setX] = useState(0);
  const [y, setY] = useState(0);
  const [duration, setDuration] = useState(1.5);
  const [clearAfterRender, setClearAfterRender] = useState(false);
  const [selectedSample, setSelectedSample] = useState(0);
  const [draftImages, setDraftImages] = useState<LayerImage[]>([]);
  const [mode, setMode] = useState<"webgl2" | "cpu">("webgl2");
  const [isPlaying, setIsPlaying] = useState(false);
  const [isFinished, setIsFinished] = useState(false);
  const [isFinishing, setIsFinishing] = useState(false);
  const [isAddingLayer, setIsAddingLayer] = useState(false);
  const [layers, setQueuedLayers] = useState<ImageLayer[]>([]);
  const [currentLayerIndex, setCurrentLayerIndex] = useState(0);
  const [nextLayerIndex, setNextLayerIndex] = useState<number | null>(null);
  const [error, setError] = useState("");
  const [queueNotice, setQueueNotice] = useState("");
  const isWaitingAtEnd = !isPlaying && !isFinished && layers.length > 0 &&
    nextLayerIndex === null;

  useEffect(() => {
    samplesRef.current = SAMPLES.map((sample) => ({
      ...sample,
      url: createSampleImage(sample),
    }));

    const canvas = canvasRef.current;
    if (!canvas) return;

    try {
      const renderer = new OpticalTransition({
        canvas,
        width: INITIAL_SIZE.width,
        height: INITIAL_SIZE.height,
      });
      rendererRef.current = renderer;
      setMode(renderer.mode);
    } catch (cause) {
      setError(
        cause instanceof Error
          ? cause.message
          : "Canvas initialization failed.",
      );
      return;
    }

    const statusTimer = setInterval(() => {
      const renderer = rendererRef.current;
      if (!renderer) return;
      const playback = renderer.getPlaybackState();
      const currentLayers = renderer.getLayers();
      setQueuedLayers(currentLayers);
      setCurrentLayerIndex(playback.currentLayerIndex);
      setNextLayerIndex(playback.nextLayerIndex);
      setIsPlaying(playback.isPlaying);
      setIsFinished(playback.isFinished);
    }, 100);

    return () => {
      clearInterval(statusTimer);
      rendererRef.current?.destroy();
      rendererRef.current = null;
    };
  }, []);

  const resize = (dimension: "width" | "height", value: number) => {
    const nextSize = {
      ...size,
      [dimension]: Math.max(1, Math.floor(value)),
    };
    rendererRef.current?.setSize(nextSize.width, nextSize.height);
    setSize(nextSize);
  };

  const addImageToLayer = () => {
    const sample = samplesRef.current[selectedSample];
    if (!sample || isFinishing || isAddingLayer) return;

    setDraftImages((images) => [
      ...images,
      {
        url: sample.url,
        startX: x,
        startY: y,
        endX: x + IMAGE_SIZE.width,
        endY: y + IMAGE_SIZE.height,
      },
    ]);
  };

  const addLayerToPlaybackQueue = async () => {
    const renderer = rendererRef.current;
    if (!renderer || draftImages.length === 0 || isFinishing) {
      return;
    }

    setError("");
    setQueueNotice("");
    setIsAddingLayer(true);
    try {
      await renderer.setLayer({
        images: draftImages,
        duration,
        clearAfterRender,
      });
      setDraftImages([]);
      const currentLayers = renderer.getLayers();
      const playback = renderer.getPlaybackState();
      setQueuedLayers(currentLayers);
      setCurrentLayerIndex(playback.currentLayerIndex);
      setNextLayerIndex(playback.nextLayerIndex);
      setIsPlaying(playback.isPlaying);
      setIsFinished(playback.isFinished);
      if (isPlaying) {
        setQueueNotice(
          "Layer added to queue. Will play after current transition.",
        );
      } else {
        setQueueNotice("Layer added to the playback queue.");
      }
    } catch (cause) {
      setError(
        cause instanceof Error ? cause.message : "Unable to add the layer.",
      );
    } finally {
      setIsAddingLayer(false);
    }
  };

  const play = () => {
    rendererRef.current?.play();
    setIsPlaying(true);
  };

  const pause = () => {
    rendererRef.current?.pause();
    setIsPlaying(false);
  };

  const finish = async () => {
    const renderer = rendererRef.current;
    if (!renderer || layers.length === 0) return;

    setError("");
    setIsFinishing(true);
    try {
      await renderer.finish();
      if (!renderer.getPlaybackState().isFinished) return;
      setIsPlaying(false);
      setIsFinished(true);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Unable to finish.");
    } finally {
      setIsFinishing(false);
    }
  };

  const clear = () => {
    rendererRef.current?.clear();
    setQueuedLayers([]);
    setCurrentLayerIndex(0);
    setNextLayerIndex(null);
    setIsPlaying(false);
    setIsFinished(false);
    setError("");
    setQueueNotice("");
  };

  const replay = () => {
    const renderer = rendererRef.current;
    renderer?.replay();
    const playback = renderer?.getPlaybackState();
    setIsFinished(playback?.isFinished ?? false);
    setIsPlaying(playback?.isPlaying ?? false);
    setCurrentLayerIndex(playback?.currentLayerIndex ?? 0);
    setNextLayerIndex(playback?.nextLayerIndex ?? null);
  };

  return (
    <section className="demo-layout" aria-label="Interactive transition demo">
      <div className="stage-column">
        <div className="stage-heading">
          <span className="section-kicker">CANVAS · {mode.toUpperCase()}</span>
          <span className="resolution-label">{size.width} × {size.height}</span>
        </div>
        <div
          className="stage-frame"
          style={{ aspectRatio: `${size.width} / ${size.height}` }}
        >
          <canvas ref={canvasRef} aria-label="Noise transition canvas" />
          {error && <div className="stage-error" role="alert">{error}</div>}
        </div>
      </div>

      <aside className="control-panel" aria-label="Canvas controls">
        <div className="control-section">
          <h2 className="section-kicker">CANVAS SIZE</h2>
          <label className="field">
            Width
            <input
              type="number"
              min="1"
              value={size.width}
              onInput={(event) =>
                resize("width", Number(event.currentTarget.value))}
            />
          </label>
          <label className="field">
            Height
            <input
              type="number"
              min="1"
              value={size.height}
              onInput={(event) =>
                resize("height", Number(event.currentTarget.value))}
            />
          </label>
        </div>

        <div className="control-section">
          <h2 className="section-kicker">COMPOSE A LAYER</h2>
          <label className="field">
            Image
            <select
              value={selectedSample}
              onChange={(event) =>
                setSelectedSample(Number(event.currentTarget.value))}
            >
              {SAMPLES.map((sample, index) => (
                <option key={index} value={index}>{sample.name}</option>
              ))}
            </select>
          </label>
          <div className="coordinate-fields">
            <label className="field">
              X
              <input
                type="number"
                value={x}
                onInput={(event) =>
                  setX(Number(event.currentTarget.value))}
              />
            </label>
            <label className="field">
              Y
              <input
                type="number"
                value={y}
                onInput={(event) =>
                  setY(Number(event.currentTarget.value))}
              />
            </label>
          </div>
          <button
            className="secondary-button"
            type="button"
            onClick={addImageToLayer}
            disabled={isFinishing || isAddingLayer || !!error}
          >
            Add image to layer
          </button>
          <p className="layer-count">
            DRAFT LAYER: {draftImages.length} image
            {draftImages.length === 1 ? "" : "s"}
          </p>
          {draftImages.length > 0 && (
            <>
              <ol className="layer-list" aria-label="Images in draft layer">
                {draftImages.map((image, index) => {
                  const name = samplesRef.current.find((sample) =>
                    sample.url === image.url
                  )?.name ?? "Image";
                  return (
                    <li className="layer-item" key={`draft-image-${index}`}>
                      <span className="layer-item-title">
                        {index + 1}. {name}
                      </span>
                      <span className="layer-item-meta">
                        x:{image.startX} y:{image.startY}
                      </span>
                      <button
                        className="secondary-button"
                        type="button"
                        onClick={() =>
                          setDraftImages((images) =>
                            images.filter((_, imageIndex) =>
                              imageIndex !== index
                            )
                          )}
                        disabled={isAddingLayer}
                      >
                        Remove image
                      </button>
                    </li>
                  );
                })}
              </ol>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setDraftImages([])}
                disabled={isAddingLayer}
              >
                Clear draft layer
              </button>
            </>
          )}
          <label className="field">
            Duration (sec)
            <input
              type="number"
              min="0.1"
              step="0.1"
              value={duration}
              onInput={(event) =>
                setDuration(Math.max(0.1, Number(event.currentTarget.value)))}
            />
          </label>
          <label className="checkbox-field">
            <input
              type="checkbox"
              checked={clearAfterRender}
              onChange={(event) =>
                setClearAfterRender(event.currentTarget.checked)}
            />
            Clear after transition
          </label>
          <button
            className="action-button"
            type="button"
            onClick={() => void addLayerToPlaybackQueue()}
            disabled={draftImages.length === 0 || isFinishing ||
              isAddingLayer || !!error}
          >
            {isAddingLayer
              ? "Compositing layer…"
              : isPlaying
              ? "Add layer to queue (playing)"
              : "Add layer to playback queue"}
          </button>
          <p className="layer-count">PLAYBACK QUEUE</p>
          {queueNotice && (
            <p className="layer-count" role="status">{queueNotice}</p>
          )}
          {isWaitingAtEnd && (
            <p className="layer-count">
              Waiting at the end of the queue. Add another layer to continue, or
              finish explicitly.
            </p>
          )}
          <p className="layer-count">
            {layers.length} layer{layers.length === 1 ? "" : "s"}
          </p>
          <ol className="layer-list" aria-label="Layer playback status">
            {layers.map((layer, index) => {
              const isCurrentLayer = index === currentLayerIndex;
              const isNextLayer = index === nextLayerIndex;
              let status = "Waiting";
              if (isFinished && isCurrentLayer) {
                status = "Finished · displayed";
              } else if (index < currentLayerIndex) {
                status = "Completed";
              } else if (isCurrentLayer) {
                status = isPlaying ? "Current layer" : "Current";
              } else if (isNextLayer) {
                status = isPlaying ? "Transitioning in" : "Next";
              }

              return (
                <li
                  className={`layer-item${
                    isNextLayer && isPlaying ? " is-transitioning" : ""
                  }${isCurrentLayer ? " is-current" : ""}`}
                  key={`layer-${index}`}
                >
                  <span className="layer-item-title">
                    Layer {index + 1} · {layer.images.length} image
                    {layer.images.length === 1 ? "" : "s"}
                  </span>
                  <span className="layer-item-meta">
                    {layer.images.map((image) => {
                      const name = samplesRef.current.find((sample) =>
                        sample.url === image.url
                      )?.name ?? "Image";
                      return `${name} (x:${image.startX ?? 0}, y:${
                        image.startY ?? 0
                      })`;
                    }).join(" · ")}
                  </span>
                  <span className="layer-item-meta">
                    {layer.duration}s · {layer.clearAfterRender
                      ? "Clears after transition"
                      : "Keeps rendered layer"}
                  </span>
                  <span className="layer-item-status">{status}</span>
                </li>
              );
            })}
          </ol>
        </div>

        <div className="control-section actions">
          <button
            className="action-button"
            type="button"
            onClick={play}
            disabled={isPlaying || isFinishing || isFinished ||
              isAddingLayer ||
              nextLayerIndex === null}
          >
            Play
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={pause}
            disabled={!isPlaying || isFinishing || isAddingLayer}
          >
            Pause
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={() => void finish()}
            disabled={isFinishing || isFinished || isAddingLayer ||
              layers.length === 0}
          >
            {isFinishing ? "Finishing…" : "Finish and hold final image"}
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={replay}
            disabled={isFinishing || isAddingLayer || layers.length === 0}
          >
            Replay from first layer
          </button>
          <button
            className="secondary-button"
            type="button"
            onClick={clear}
            disabled={isAddingLayer || (layers.length === 0 && !isFinished)}
          >
            Clear playback queue
          </button>
        </div>
      </aside>
    </section>
  );
}
