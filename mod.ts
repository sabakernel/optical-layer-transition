/**
 * Optical Noise Transition Engine
 *
 * A progressive noise sampling image transition library based on WebGL 2.0.
 * Provides smooth, optical noise-based transitions between image layers with automatic
 * fallback to Canvas 2D rendering when WebGL 2.0 is unavailable.
 *
 * @module
 *
 * @example
 * ```ts
 * import { OpticalTransition } from "@sabakernel/optical-transition";
 *
 * const canvas = document.querySelector<HTMLCanvasElement>('#canvas')!;
 * const transition = new OpticalTransition({
 *   canvas,
 *   width: 800,
 *   height: 600
 * });
 *
 * // Add first layer
 * await transition.setLayer({
 *   images: [{ url: 'layer1.png' }],
 *   duration: 1.0
 * });
 *
 * // Add second layer
 * await transition.setLayer({
 *   images: [{ url: 'layer2.png' }],
 *   duration: 1.5
 * });
 *
 * // Start the transition
 * transition.play();
 *
 * // Wait for completion
 * await transition.finish();
 * ```
 */

export { OpticalTransition } from "./src/core.ts";
export * from "./src/types.ts";
