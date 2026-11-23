/**
 * Type definitions module for the optical noise transition engine.
 */

/**
 * Configuration options for initializing the transition renderer.
 */
export interface TransitionOptions {
  /** Target canvas element for rendering */
  canvas: HTMLCanvasElement;
  /** Rendering width in pixels */
  width: number;
  /** Rendering height in pixels */
  height: number;
}

/**
 * Configuration for a single image within a layer.
 */
export interface LayerImage {
  /** Image URL or data URI to load */
  url: string;
  /** Drawing area: start X coordinate in pixels (defaults to 0) */
  startX?: number;
  /** Drawing area: start Y coordinate in pixels (defaults to 0) */
  startY?: number;
  /** Drawing area: end X coordinate in pixels (defaults to canvas width) */
  endX?: number;
  /** Drawing area: end Y coordinate in pixels (defaults to canvas height) */
  endY?: number;
}

/**
 * A layer containing multiple images that transition together.
 * Each image can have different placement, while duration and clearAfterRender are shared across the layer.
 */
export interface ImageLayer {
  /** Array of images to be rendered in this layer */
  images: LayerImage[];
  /** Transition duration in seconds from the previous layer to this layer. The duration of the first layer is not used. */
  duration: number;
  /** Whether to clear this entire layer after transitioning to the next layer (defaults to false) */
  clearAfterRender?: boolean;
}
