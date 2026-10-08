/**
 * Optical noise image transition renderer core module (OpticalTransition).
 */

import type { ImageLayer, TransitionOptions } from "./types.ts";
import { createProgramInfo, type ShaderProgramInfo } from "./shader.ts";
import { TextureManager } from "./texture.ts";

/**
 * Internal interface for transition backends (WebGL2 and CPU fallback).
 */
interface TransitionBackend {
  setLayer(layer: ImageLayer): Promise<void>;
  finish(): Promise<void>;
  replay(): void;
  clear(): void;
  getLayers(): ImageLayer[];
  getPlaybackState(): {
    currentLayerIndex: number;
    nextLayerIndex: number | null;
    isPlaying: boolean;
    isFinished: boolean;
  };
  setSize(width: number, height: number): void;
  play(): void;
  pause(): void;
  destroy(): void;
}

/**
 * Progressive noise sampling image transition renderer class based on WebGL 2.0.
 */
class WebGLOpticalTransition implements TransitionBackend {
  private canvas: HTMLCanvasElement;
  private gl: WebGL2RenderingContext;
  private layers: ImageLayer[] = [];
  private layerTextures: Map<ImageLayer, WebGLTexture> = new Map();
  private clearedLayerIndices: Set<number> = new Set();

  // 内部状態管理
  private isPlaying: boolean = false;
  private isFinished: boolean = false;
  private currentLayerIndex: number = 0;
  private completionPromise: Promise<void> | null = null;
  private resolveCompletion: (() => void) | null = null;

  // WebGL 関連リソース
  private width: number;
  private height: number;
  private textureManager: TextureManager;
  private textureGeneration: number = 0;
  private programInfo: ShaderProgramInfo;
  private quadBuffer: WebGLBuffer | null = null;
  private vao: WebGLVertexArrayObject | null = null;
  private dummyTexture: WebGLTexture;

  // アニメーション制御
  private animationFrameId: number | null = null;
  private transitionStartTime: number = 0;
  private pausedProgress: number = 0; // pause時の進行状況を保存
  private isDestroyed: boolean = false;

  /**
   * Constructs a WebGL-based optical transition renderer.
   * @param options Transition configuration options
   * @param gl WebGL2 rendering context
   */
  constructor(options: TransitionOptions, gl: WebGL2RenderingContext) {
    this.canvas = options.canvas;
    this.width = options.width;
    this.height = options.height;
    this.gl = gl;

    this.canvas.width = this.width;
    this.canvas.height = this.height;

    this.textureManager = new TextureManager();
    this.dummyTexture = this.textureManager.createSolidColorTexture(
      this.gl,
      0,
      0,
      0,
      0,
    );

    this.programInfo = createProgramInfo(this.gl);
    this.initQuadBuffer();
    this.gl.viewport(0, 0, this.width, this.height);
  }

  /**
   * Initializes the quad buffer for rendering.
   * @private
   */
  private initQuadBuffer(): void {
    const gl = this.gl;
    const positions = new Float32Array([
      0.0,
      0.0,
      1.0,
      0.0,
      0.0,
      1.0,
      1.0,
      1.0,
    ]);

    this.vao = gl.createVertexArray();
    gl.bindVertexArray(this.vao);

    this.quadBuffer = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, this.quadBuffer);
    gl.bufferData(gl.ARRAY_BUFFER, positions, gl.STATIC_DRAW);

    const posLoc = this.programInfo.attribs.position;
    if (posLoc !== -1) {
      gl.enableVertexAttribArray(posLoc);
      gl.vertexAttribPointer(posLoc, 2, gl.FLOAT, false, 0, 0);
    }

    gl.bindVertexArray(null);
    gl.bindBuffer(gl.ARRAY_BUFFER, null);
  }

  public async setLayer(layer: ImageLayer): Promise<void> {
    if (this.isDestroyed) return;

    this.isFinished = false;
    this.layers.push(layer);

    try {
      await this.createLayerTexture(layer);
    } catch (error) {
      const index = this.layers.indexOf(layer);
      if (index >= 0) this.layers.splice(index, 1);
      throw error;
    }
    if (!this.layers.includes(layer) || this.isDestroyed) return;

    // 再生中でない場合のみフレームを描画
    if (!this.isPlaying) {
      this.renderFrame(performance.now());
    }
  }

  /**
   * Clears all layers and resets the renderer to its initial state.
   */
  public clear(): void {
    this.pause();
    this.isFinished = false;
    this.currentLayerIndex = 0;
    this.transitionStartTime = 0;
    this.textureGeneration++;
    this.layers = [];
    for (const texture of this.layerTextures.values()) {
      this.gl.deleteTexture(texture);
    }
    this.layerTextures.clear();
    this.clearedLayerIndices.clear();
    this.textureManager.clear(this.gl);
    this.gl.clearColor(0.0, 0.0, 0.0, 0.0);
    this.gl.clear(this.gl.COLOR_BUFFER_BIT);
    this.completeWaiter();
  }

  public getLayers(): ImageLayer[] {
    return [...this.layers];
  }

  public getPlaybackState(): {
    currentLayerIndex: number;
    nextLayerIndex: number | null;
    isPlaying: boolean;
    isFinished: boolean;
  } {
    return {
      currentLayerIndex: this.currentLayerIndex,
      nextLayerIndex: !this.isFinished &&
          this.currentLayerIndex + 1 < this.layers.length
        ? this.currentLayerIndex + 1
        : null,
      isPlaying: this.isPlaying,
      isFinished: this.isFinished,
    };
  }

  /**
   * Creates a WebGL texture for a layer by compositing all of its images.
   * @param layer Layer to create texture for
   * @private
   */
  /**
   * Creates a WebGL texture for a layer by compositing all of its images.
   * @param layer Layer to create texture for
   * @private
   */
  private async createLayerTexture(layer: ImageLayer): Promise<void> {
    while (!this.isDestroyed && this.layers.includes(layer)) {
      const generation = this.textureGeneration;
      const texture = await this.textureManager.createCompositeTexture(
        this.gl,
        layer.images,
        this.width,
        this.height,
      );
      if (generation !== this.textureGeneration) {
        this.gl.deleteTexture(texture);
        continue;
      }
      if (this.isDestroyed || !this.layers.includes(layer)) {
        this.gl.deleteTexture(texture);
        return;
      }
      const previous = this.layerTextures.get(layer);
      if (previous) this.gl.deleteTexture(previous);
      this.layerTextures.set(layer, texture);
      return;
    }
  }

  /**
   * Resizes the canvas and regenerates all layer textures.
   * @param width New width in pixels
   * @param height New height in pixels
   */
  public setSize(width: number, height: number): void {
    if (this.isDestroyed) return;

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    this.gl.viewport(0, 0, width, height);
    this.textureGeneration++;
    for (const texture of this.layerTextures.values()) {
      this.gl.deleteTexture(texture);
    }
    this.layerTextures.clear();
    void Promise.all(this.layers.map((layer) => this.createLayerTexture(layer)))
      .then(() => this.renderFrame(performance.now()))
      .catch((error: unknown) => {
        console.error("Failed to recomposite layer images.", error);
      });

    if (!this.isPlaying) {
      this.renderFrame(performance.now());
    }
  }

  public play(): void {
    if (
      this.isDestroyed || this.isPlaying || this.isFinished ||
      this.layers.length < 2
    ) return;

    this.isPlaying = true;
    // pause時の進行状況から再開できるように調整
    this.transitionStartTime = performance.now() - this.pausedProgress * 1000;
    this.startLoop();
  }

  public replay(): void {
    if (
      this.isDestroyed || this.layers.length === 0
    ) {
      return;
    }

    this.pause();
    this.completeWaiter();
    this.clearedLayerIndices.clear();
    this.currentLayerIndex = 0;
    this.transitionStartTime = performance.now();
    this.isFinished = false;
    this.isPlaying = this.layers.length > 1;
    this.renderFrame(this.transitionStartTime);
    if (this.isPlaying) this.startLoop();
  }

  public finish(): Promise<void> {
    if (this.isDestroyed || this.isFinished || this.layers.length === 0) {
      return Promise.resolve();
    }
    if (this.completionPromise) return this.completionPromise;

    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    const completion = this.completionPromise;

    if (
      this.layers.length === 1 ||
      this.currentLayerIndex === this.layers.length - 1
    ) {
      if (!this.layerTextures.has(this.layers[this.currentLayerIndex])) {
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.transitionStartTime = performance.now();
          this.startLoop();
        }
        return completion;
      }
      this.pause();
      this.isFinished = true;
      this.renderFrame(performance.now());
      this.completeWaiter();
      return completion;
    }

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.transitionStartTime = performance.now();
      this.startLoop();
    }
    return completion;
  }

  private completeWaiter(): void {
    this.resolveCompletion?.();
    this.resolveCompletion = null;
    this.completionPromise = null;
  }

  public pause(): void {
    if (!this.isPlaying) return;

    // 現在の進行状況を保存
    const targetLayerIndex = this.currentLayerIndex + 1;
    const targetLayer = this.layers[targetLayerIndex];
    if (targetLayer) {
      const elapsedSec = (performance.now() - this.transitionStartTime) /
        1000.0;
      const durationSec = Math.max(0.001, targetLayer.duration);
      this.pausedProgress = Math.min(durationSec, Math.max(0, elapsedSec));
    }

    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Starts the animation loop.
   * @private
   */
  private startLoop(): void {
    const loop = (time: number) => {
      if (!this.isPlaying || this.isDestroyed) return;

      this.renderFrame(time);
      this.animationFrameId = this.isPlaying
        ? requestAnimationFrame(loop)
        : null;
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Renders a single frame of the transition.
   * @param nowMs Current timestamp in milliseconds
   * @private
   */
  private renderFrame(nowMs: number): void {
    const gl = this.gl;
    if (!gl || this.layers.length === 0) return;

    gl.clearColor(0.0, 0.0, 0.0, 0.0);
    gl.clear(gl.COLOR_BUFFER_BIT);
    gl.enable(gl.BLEND);
    gl.blendFunc(gl.SRC_ALPHA, gl.ONE_MINUS_SRC_ALPHA);

    const currentLayer = this.layers[this.currentLayerIndex];
    if (!currentLayer || !this.layerTextures.has(currentLayer)) {
      return;
    }

    if (this.isFinished || !this.isPlaying) {
      this.drawRetainedLayers(this.currentLayerIndex, nowMs);
      return;
    }

    const targetLayerIndex = this.currentLayerIndex + 1;
    const targetLayer = this.layers[targetLayerIndex];
    if (!targetLayer) {
      this.drawRetainedLayers(this.currentLayerIndex, nowMs);
      this.isPlaying = false;
      this.isFinished = true;
      this.completeWaiter();
      return;
    }
    const targetTexture = this.layerTextures.get(targetLayer);
    if (!targetTexture) {
      this.drawRetainedLayers(this.currentLayerIndex, nowMs);
      this.transitionStartTime = nowMs;
      return;
    }

    const elapsedSec = (nowMs - this.transitionStartTime) / 1000.0;
    const durationSec = Math.max(0.001, targetLayer.duration);
    this.drawRetainedLayers(this.currentLayerIndex, nowMs);
    const progress = Math.min(1.0, Math.max(0.0, elapsedSec / durationSec));
    this.drawCompositeLayer(targetTexture, progress, nowMs);

    if (elapsedSec >= durationSec && this.isPlaying) {
      if (currentLayer.clearAfterRender) {
        this.clearedLayerIndices.add(this.currentLayerIndex);
      }
      this.currentLayerIndex = targetLayerIndex;
      this.transitionStartTime = nowMs;
      if (this.currentLayerIndex === this.layers.length - 1) {
        this.isPlaying = false;
        this.isFinished = this.completionPromise !== null;
      }
      this.renderFrame(nowMs);
      if (this.isFinished) {
        this.completeWaiter();
      }
    }
  }

  /**
   * Draws all retained layers up to the specified index.
   * @param lastIndex Last layer index to draw
   * @param nowMs Current timestamp in milliseconds
   * @private
   */
  private drawRetainedLayers(lastIndex: number, nowMs: number): void {
    for (let index = 0; index <= lastIndex; index++) {
      if (this.clearedLayerIndices.has(index)) continue;

      const texture = this.layerTextures.get(this.layers[index]);
      if (texture) this.drawCompositeLayer(texture, 1, nowMs);
    }
  }

  /**
   * Draws a composite layer with the specified progress.
   * @param texture WebGL texture to draw
   * @param progress Transition progress (0.0 to 1.0)
   * @param nowMs Current timestamp in milliseconds
   * @private
   */
  private drawCompositeLayer(
    texture: WebGLTexture,
    progress: number,
    nowMs: number,
  ): void {
    const bounds: [number, number, number, number] = [
      0,
      0,
      this.width,
      this.height,
    ];
    this.drawQuad({
      srcTex: this.dummyTexture,
      tgtTex: texture,
      progress,
      timeSec: nowMs / 1000,
      srcBounds: bounds,
      tgtBounds: bounds,
      renderBounds: bounds,
      overlay: true,
    });
  }

  /**
   * Draws a quad with the specified shader parameters.
   * @param params Rendering parameters including textures, progress, and bounds
   * @private
   */
  private drawQuad(params: {
    srcTex: WebGLTexture;
    tgtTex: WebGLTexture;
    progress: number;
    timeSec: number;
    srcBounds: [number, number, number, number];
    tgtBounds: [number, number, number, number];
    renderBounds: [number, number, number, number];
    overlay?: boolean;
  }): void {
    const gl = this.gl;
    const { program, uniforms } = this.programInfo;

    gl.useProgram(program);
    gl.blendFunc(
      params.overlay ? gl.ONE : gl.SRC_ALPHA,
      gl.ONE_MINUS_SRC_ALPHA,
    );

    gl.activeTexture(gl.TEXTURE0);
    gl.bindTexture(gl.TEXTURE_2D, params.srcTex);
    gl.uniform1i(uniforms.texSource, 0);

    gl.activeTexture(gl.TEXTURE1);
    gl.bindTexture(gl.TEXTURE_2D, params.tgtTex);
    gl.uniform1i(uniforms.texTarget, 1);

    gl.uniform1f(uniforms.progress, params.progress);
    gl.uniform1f(uniforms.time, params.timeSec);
    gl.uniform2f(uniforms.resolution, this.width, this.height);
    gl.uniform4f(uniforms.bounds, ...params.renderBounds);
    gl.uniform4f(uniforms.srcBounds, ...params.srcBounds);
    gl.uniform4f(uniforms.tgtBounds, ...params.tgtBounds);
    gl.uniform1i(uniforms.overlay, params.overlay ? 1 : 0);

    gl.bindVertexArray(this.vao);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    gl.bindVertexArray(null);
  }

  /**
   * Destroys the renderer and releases all WebGL resources.
   * The renderer cannot be used after calling this method.
   */
  public destroy(): void {
    if (this.isDestroyed) return;

    this.pause();
    this.completeWaiter();
    this.isDestroyed = true;
    this.textureGeneration++;

    const gl = this.gl;

    if (this.quadBuffer) {
      gl.deleteBuffer(this.quadBuffer);
      this.quadBuffer = null;
    }
    if (this.vao) {
      gl.deleteVertexArray(this.vao);
      this.vao = null;
    }

    gl.deleteTexture(this.dummyTexture);
    this.textureManager.clear(gl);

    if (this.programInfo.program) {
      gl.deleteProgram(this.programInfo.program);
    }

    this.layers = [];
    for (const texture of this.layerTextures.values()) {
      gl.deleteTexture(texture);
    }
    this.layerTextures.clear();
    this.clearedLayerIndices.clear();
  }
}

/**
 * Canvas 2D CPU fallback renderer for environments where WebGL 2.0 is unavailable.
 * Maintains the same API and provides a noise-like rendering effect.
 */
class CpuOpticalTransition implements TransitionBackend {
  public readonly mode: "cpu" = "cpu";
  private canvas: HTMLCanvasElement;
  private ctx: CanvasRenderingContext2D;
  private width: number;
  private height: number;
  private layers: ImageLayer[] = [];
  private compositeLayers: Map<ImageLayer, HTMLCanvasElement> = new Map();
  private clearedLayerIndices: Set<number> = new Set();
  private imageCache: Map<string, HTMLImageElement> = new Map();
  private isPlaying: boolean = false;
  private isFinished: boolean = false;
  private currentLayerIndex: number = 0;
  private completionPromise: Promise<void> | null = null;
  private resolveCompletion: (() => void) | null = null;
  private animationFrameId: number | null = null;
  private transitionStartTime: number = 0;
  private pausedProgress: number = 0;
  private isDestroyed: boolean = false;

  /**
   * Constructs a CPU-based optical transition renderer.
   * @param options Transition configuration options
   * @throws Error if Canvas 2D context cannot be obtained
   */
  constructor(options: TransitionOptions) {
    this.canvas = options.canvas;
    this.width = options.width;
    this.height = options.height;
    this.canvas.width = this.width;
    this.canvas.height = this.height;

    const ctx = this.canvas.getContext("2d");
    if (!ctx) {
      throw new Error(
        "Failed to get Canvas 2D context. Fallback rendering is unavailable.",
      );
    }

    this.ctx = ctx;
  }

  /**
   * Adds a new layer to the transition sequence.
   * @param layer Layer configuration containing images and transition settings
   * @throws Error if image loading fails
   */
  public async setLayer(layer: ImageLayer): Promise<void> {
    if (this.isDestroyed) return;

    this.isFinished = false;
    this.layers.push(layer);

    try {
      await Promise.all(layer.images.map((image) => this.loadImage(image.url)));
      if (!this.layers.includes(layer) || this.isDestroyed) return;
      this.compositeLayers.set(layer, this.composeLayer(layer));
    } catch (error) {
      const index = this.layers.indexOf(layer);
      if (index >= 0) this.layers.splice(index, 1);
      throw error;
    }

    // 再生中でない場合のみフレームを描画
    if (!this.isPlaying) {
      this.renderFrame(performance.now());
    }
  }

  /**
   * Clears all layers and resets the renderer to its initial state.
   */
  public clear(): void {
    this.pause();
    this.isFinished = false;
    this.currentLayerIndex = 0;
    this.transitionStartTime = 0;
    this.layers = [];
    this.compositeLayers.clear();
    this.clearedLayerIndices.clear();
    this.imageCache.clear();
    this.ctx.clearRect(0, 0, this.width, this.height);
    this.completeWaiter();
  }

  /**
   * Returns a copy of all currently registered layers.
   * @returns Array of image layers
   */
  public getLayers(): ImageLayer[] {
    return [...this.layers];
  }

  /**
   * Gets the current playback state of the transition.
   * @returns Object containing current layer index, next layer index, playing status, and finished status
   */
  public getPlaybackState(): {
    currentLayerIndex: number;
    nextLayerIndex: number | null;
    isPlaying: boolean;
    isFinished: boolean;
  } {
    return {
      currentLayerIndex: this.currentLayerIndex,
      nextLayerIndex: !this.isFinished &&
          this.currentLayerIndex + 1 < this.layers.length
        ? this.currentLayerIndex + 1
        : null,
      isPlaying: this.isPlaying,
      isFinished: this.isFinished,
    };
  }

  /**
   * Composites multiple images into a single canvas.
   * @param layer Layer containing images to composite
   * @returns Canvas element with composited images
   * @throws Error if canvas 2D context cannot be obtained
   * @private
   */
  private composeLayer(layer: ImageLayer): HTMLCanvasElement {
    const canvas = document.createElement("canvas");
    canvas.width = this.width;
    canvas.height = this.height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(
        "Failed to get Canvas 2D context for layer composition.",
      );
    }
    for (const image of layer.images) {
      const source = this.imageCache.get(image.url);
      if (!source) continue;
      const x = image.startX ?? 0;
      const y = image.startY ?? 0;
      const endX = image.endX ?? this.width;
      const endY = image.endY ?? this.height;
      context.drawImage(
        source,
        x,
        y,
        Math.max(0, endX - x),
        Math.max(0, endY - y),
      );
    }
    return canvas;
  }

  /**
   * Resizes the canvas and regenerates all layer compositions.
   * @param width New width in pixels
   * @param height New height in pixels
   */
  public setSize(width: number, height: number): void {
    if (this.isDestroyed) return;

    this.width = width;
    this.height = height;
    this.canvas.width = width;
    this.canvas.height = height;

    for (const layer of this.layers) {
      this.compositeLayers.set(layer, this.composeLayer(layer));
    }

    if (!this.isPlaying) {
      this.renderFrame(performance.now());
    }
  }

  /**
   * Starts playing the transition animation.
   * Does nothing if already playing, finished, or if there are fewer than 2 layers.
   */
  public play(): void {
    if (
      this.isDestroyed || this.isPlaying || this.isFinished ||
      this.layers.length < 2
    ) return;

    this.isPlaying = true;
    // pause時の進行状況から再開できるように調整
    this.transitionStartTime = performance.now() - this.pausedProgress * 1000;
    this.startLoop();
  }

  /**
   * Restarts the transition from the beginning.
   * Resets to the first layer and starts playing if multiple layers exist.
   */
  public replay(): void {
    if (
      this.isDestroyed || this.layers.length === 0
    ) {
      return;
    }

    this.pause();
    this.completeWaiter();
    this.clearedLayerIndices.clear();
    this.currentLayerIndex = 0;
    this.transitionStartTime = performance.now();
    this.isFinished = false;
    this.isPlaying = this.layers.length > 1;
    this.renderFrame(this.transitionStartTime);
    if (this.isPlaying) this.startLoop();
  }

  public finish(): Promise<void> {
    if (this.isDestroyed || this.isFinished || this.layers.length === 0) {
      return Promise.resolve();
    }
    if (this.completionPromise) return this.completionPromise;

    this.completionPromise = new Promise((resolve) => {
      this.resolveCompletion = resolve;
    });
    const completion = this.completionPromise;

    if (
      this.layers.length === 1 ||
      this.currentLayerIndex === this.layers.length - 1
    ) {
      if (!this.compositeLayers.has(this.layers[this.currentLayerIndex])) {
        if (!this.isPlaying) {
          this.isPlaying = true;
          this.transitionStartTime = performance.now();
          this.startLoop();
        }
        return completion;
      }
      this.pause();
      this.isFinished = true;
      this.renderFrame(performance.now());
      this.completeWaiter();
      return completion;
    }

    if (!this.isPlaying) {
      this.isPlaying = true;
      this.transitionStartTime = performance.now();
      this.startLoop();
    }
    return completion;
  }

  /**
   * Completes any pending finish() promise.
   * @private
   */
  private completeWaiter(): void {
    this.resolveCompletion?.();
    this.resolveCompletion = null;
    this.completionPromise = null;
  }

  /**
   * Pauses the transition animation.
   * The current progress is preserved and can be resumed with play().
   */
  public pause(): void {
    if (!this.isPlaying) return;

    // 現在の進行状況を保存
    const targetLayerIndex = this.currentLayerIndex + 1;
    const targetLayer = this.layers[targetLayerIndex];
    if (targetLayer) {
      const elapsedSec = (performance.now() - this.transitionStartTime) /
        1000.0;
      const durationSec = Math.max(0.001, targetLayer.duration);
      this.pausedProgress = Math.min(durationSec, Math.max(0, elapsedSec));
    }

    this.isPlaying = false;
    if (this.animationFrameId !== null) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
  }

  /**
   * Starts the animation loop.
   * @private
   */
  private startLoop(): void {
    const loop = (time: number) => {
      if (!this.isPlaying || this.isDestroyed) return;

      this.renderFrame(time);
      this.animationFrameId = this.isPlaying
        ? requestAnimationFrame(loop)
        : null;
    };

    this.animationFrameId = requestAnimationFrame(loop);
  }

  /**
   * Asynchronously loads an image element.
   * @param url Image URL
   * @returns Promise that resolves to a loaded image element
   * @private
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(url);
    if (cached) {
      return Promise.resolve(cached);
    }

    return new Promise((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => {
        this.imageCache.set(url, img);
        resolve(img);
      };
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
  }

  /**
   * Draws all retained layers up to the specified index.
   * @param lastIndex Last layer index to draw
   * @private
   */
  private drawRetainedLayers(lastIndex: number): void {
    for (let index = 0; index <= lastIndex; index++) {
      if (this.clearedLayerIndices.has(index)) continue;

      const composite = this.compositeLayers.get(this.layers[index]);
      if (composite) this.ctx.drawImage(composite, 0, 0);
    }
  }

  /**
   * Draws a noise overlay effect on the specified bounds.
   * @param bounds Drawing bounds [startX, startY, endX, endY]
   * @param progress Transition progress (0.0 to 1.0)
   * @param nowMs Current timestamp in milliseconds
   * @private
   */
  private drawNoiseOverlay(
    bounds: [number, number, number, number],
    progress: number,
    nowMs: number,
  ): void {
    const [startX, startY, endX, endY] = bounds;
    const width = Math.max(0, endX - startX);
    const height = Math.max(0, endY - startY);

    if (width <= 0 || height <= 0) return;

    const variance = 1.0 - progress;
    const cell = Math.max(
      12,
      Math.min(32, Math.round(Math.min(width, height) / 16)),
    );

    this.ctx.save();
    this.ctx.beginPath();
    this.ctx.rect(startX, startY, width, height);
    this.ctx.clip();

    const seed = nowMs * 0.01;
    for (let y = startY; y < endY; y += cell) {
      for (let x = startX; x < endX; x += cell) {
        const wave = Math.sin((x + seed) * 0.31 + (y + seed) * 0.17);
        const hash = (wave + 1.0) * 0.5;
        const threshold = 0.3 + variance * 0.6;
        if (hash < threshold) {
          const alpha = (threshold - hash) * (0.12 + variance * 0.7);
          this.ctx.fillStyle = `rgba(255, 255, 255, ${alpha})`;
          this.ctx.fillRect(
            x,
            y,
            cell * (0.5 + hash),
            cell * (0.6 + hash * 0.8),
          );
        }
      }
    }

    this.ctx.restore();
  }

  /**
   * Renders a single frame of the transition.
   * @param nowMs Current timestamp in milliseconds
   * @private
   */
  private renderFrame(nowMs: number): void {
    const ctx = this.ctx;
    if (this.layers.length === 0) return;

    ctx.clearRect(0, 0, this.width, this.height);

    const currentLayer = this.layers[this.currentLayerIndex];
    if (!currentLayer || !this.compositeLayers.has(currentLayer)) {
      return;
    }

    if (this.isFinished || !this.isPlaying) {
      this.drawRetainedLayers(this.currentLayerIndex);
      return;
    }

    const targetLayerIndex = this.currentLayerIndex + 1;
    const targetLayer = this.layers[targetLayerIndex];
    if (!targetLayer) {
      this.drawRetainedLayers(this.currentLayerIndex);
      this.isPlaying = false;
      this.isFinished = true;
      this.completeWaiter();
      return;
    }
    const targetComposite = this.compositeLayers.get(targetLayer);
    if (!targetComposite) {
      this.drawRetainedLayers(this.currentLayerIndex);
      this.transitionStartTime = nowMs;
      return;
    }

    const elapsedSec = (nowMs - this.transitionStartTime) / 1000.0;
    const durationSec = Math.max(0.001, targetLayer.duration);
    this.drawRetainedLayers(this.currentLayerIndex);

    const progress = Math.min(1.0, Math.max(0.0, elapsedSec / durationSec));
    ctx.globalAlpha = progress;
    ctx.drawImage(targetComposite, 0, 0);
    ctx.globalAlpha = 0.25 + (1.0 - progress) * 0.7;
    for (const image of targetLayer.images) {
      const startX = image.startX ?? 0;
      const startY = image.startY ?? 0;
      this.drawNoiseOverlay(
        [
          startX,
          startY,
          image.endX ?? this.width,
          image.endY ?? this.height,
        ],
        progress,
        nowMs,
      );
    }
    ctx.globalAlpha = 1;

    if (elapsedSec >= durationSec && this.isPlaying) {
      if (currentLayer.clearAfterRender) {
        this.clearedLayerIndices.add(this.currentLayerIndex);
      }
      this.currentLayerIndex = targetLayerIndex;
      this.transitionStartTime = nowMs;
      if (this.currentLayerIndex === this.layers.length - 1) {
        this.isPlaying = false;
        this.isFinished = this.completionPromise !== null;
      }
      this.renderFrame(nowMs);
      if (this.isFinished) {
        this.completeWaiter();
      }
    }
  }

  /**
   * Destroys the renderer and releases all resources.
   * The renderer cannot be used after calling this method.
   */
  public destroy(): void {
    if (this.isDestroyed) return;

    this.pause();
    this.completeWaiter();
    this.isDestroyed = true;
    this.imageCache.clear();
    this.compositeLayers.clear();
    this.layers = [];
    this.clearedLayerIndices.clear();
  }
}

/**
 * Main optical transition renderer with automatic fallback.
 * Uses WebGL 2.0 when available, otherwise falls back to Canvas 2D CPU rendering.
 *
 * @example
 * ```ts
 * const canvas = document.querySelector('canvas');
 * const transition = new OpticalTransition({
 *   canvas,
 *   width: 800,
 *   height: 600
 * });
 *
 * await transition.setLayer({
 *   images: [{ url: 'image1.png' }],
 *   duration: 1.0
 * });
 *
 * await transition.setLayer({
 *   images: [{ url: 'image2.png' }],
 *   duration: 1.0
 * });
 *
 * transition.play();
 * ```
 */
export class OpticalTransition implements TransitionBackend {
  /** Rendering mode: "webgl2" or "cpu" */
  public readonly mode: "webgl2" | "cpu";
  private backend: TransitionBackend;

  /**
   * Constructs an optical transition renderer.
   * Automatically selects WebGL 2.0 or CPU rendering based on browser support.
   * @param options Transition configuration options
   */
  constructor(options: TransitionOptions) {
    const gl = options.canvas.getContext("webgl2", {
      alpha: true,
      premultipliedAlpha: true,
      antialias: true,
      preserveDrawingBuffer: true,
    });

    if (gl) {
      this.backend = new WebGLOpticalTransition(options, gl);
      this.mode = "webgl2";
      return;
    }

    this.backend = new CpuOpticalTransition(options);
    this.mode = "cpu";
  }

  /**
   * Adds a layer to the transition queue.
   *
   * The provided layer object is retained internally. Mutating the layer or
   * its nested image configuration after this call may affect the renderer.
   * @param layer Layer configuration containing images and transition settings
   */
  public async setLayer(layer: ImageLayer): Promise<void> {
    await this.backend.setLayer(layer);
  }

  /**
   * Completes all pending transitions and advances to the final layer.
   * Returns a promise that resolves when the final layer is fully rendered.
   * @returns Promise that resolves when all transitions are complete
   */
  public async finish(): Promise<void> {
    await this.backend.finish();
  }

  public replay(): void {
    this.backend.replay();
  }

  public clear(): void {
    this.backend.clear();
  }

  /**
   * Returns a shallow copy of the current layer list.
   *
   * Modifying the returned array does not affect the internal layer list.
   * The layer objects and their nested properties are shared references.
   */
  public getLayers(): ImageLayer[] {
    return this.backend.getLayers();
  }

  public getPlaybackState(): {
    currentLayerIndex: number;
    nextLayerIndex: number | null;
    isPlaying: boolean;
    isFinished: boolean;
  } {
    return this.backend.getPlaybackState();
  }

  /**
   * Resizes the canvas and regenerates all layer textures or compositions.
   * @param width New width in pixels
   * @param height New height in pixels
   */
  public setSize(width: number, height: number): void {
    this.backend.setSize(width, height);
  }

  /**
   * Starts playing the transition animation.
   */
  public play(): void {
    this.backend.play();
  }

  /**
   * Pauses the transition animation.
   */
  public pause(): void {
    this.backend.pause();
  }

  /**
   * Destroys the renderer and releases all resources.
   */
  public destroy(): void {
    this.backend.destroy();
  }
}
