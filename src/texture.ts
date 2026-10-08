/**
 * WebGL texture cache and loader module.
 */

/**
 * Manager class responsible for managing and caching WebGL textures.
 */
export class TextureManager {
  /** Cache of textures keyed by URL */
  private cache: Map<string, WebGLTexture> = new Map();
  /** Cache of image loading promises */
  private imageCache: Map<string, Promise<HTMLImageElement>> = new Map();

  /**
   * Creates a composite texture by rendering multiple images onto a canvas.
   * @param gl WebGL2 rendering context
   * @param images Array of image configurations with URLs and placement coordinates
   * @param width Width of the composite texture in pixels
   * @param height Height of the composite texture in pixels
   * @returns Promise that resolves to a WebGL texture containing the composite image
   * @throws Error if canvas 2D context cannot be obtained
   */
  public async createCompositeTexture(
    gl: WebGL2RenderingContext,
    images: {
      url: string;
      startX?: number;
      startY?: number;
      endX?: number;
      endY?: number;
    }[],
    width: number,
    height: number,
  ): Promise<WebGLTexture> {
    const canvas = document.createElement("canvas");
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext("2d");
    if (!context) {
      throw new Error(
        "Failed to get Canvas 2D context for layer composition.",
      );
    }

    const loadedImages = await Promise.all(
      images.map((image) => this.loadImage(image.url)),
    );
    loadedImages.forEach((image, index) => {
      const placement = images[index];
      const x = placement.startX ?? 0;
      const y = placement.startY ?? 0;
      const endX = placement.endX ?? width;
      const endY = placement.endY ?? height;
      context.drawImage(
        image,
        x,
        y,
        Math.max(0, endX - x),
        Math.max(0, endY - y),
      );
    });

    const texture = this.createTextureFromImage(gl, canvas);
    gl.bindTexture(gl.TEXTURE_2D, null);
    return texture;
  }

  /**
   * Asynchronously loads and creates a WebGL texture from an image URL.
   * Returns the cached texture if it already exists.
   * @param gl WebGL2 rendering context
   * @param url Texture image URL (data URI and Blob URL are also supported)
   * @returns Promise that resolves to a cached or newly created WebGL texture
   */
  public async loadTexture(
    gl: WebGL2RenderingContext,
    url: string,
  ): Promise<WebGLTexture> {
    const cached = this.cache.get(url);
    if (cached) {
      return cached;
    }

    const image = await this.loadImage(url);
    const texture = this.createTextureFromImage(gl, image);

    this.cache.set(url, texture);
    return texture;
  }

  /**
   * Creates a 1x1 placeholder/dummy texture with the specified color.
   * @param gl WebGL2 rendering context
   * @param r Red component (0-255)
   * @param g Green component (0-255)
   * @param b Blue component (0-255)
   * @param a Alpha component (0-255)
   * @returns WebGL texture object
   * @throws Error if texture creation fails
   */
  public createSolidColorTexture(
    gl: WebGL2RenderingContext,
    r: number = 0,
    g: number = 0,
    b: number = 0,
    a: number = 0,
  ): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create solid color texture.");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);
    const pixel = new Uint8Array([r, g, b, a]);
    gl.texImage2D(
      gl.TEXTURE_2D,
      0,
      gl.RGBA,
      1,
      1,
      0,
      gl.RGBA,
      gl.UNSIGNED_BYTE,
      pixel,
    );

    // テクスチャパラメータの設定
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.NEAREST);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.NEAREST);

    return texture;
  }

  /**
   * Asynchronously loads an HTMLImageElement.
   * @param url Image URL
   * @returns Promise that resolves to a loaded image element
   */
  private loadImage(url: string): Promise<HTMLImageElement> {
    const cached = this.imageCache.get(url);
    if (cached) return cached;

    const loading = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.crossOrigin = "anonymous";
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error(`Failed to load image: ${url}`));
      img.src = url;
    });
    this.imageCache.set(url, loading);
    return loading;
  }

  /**
   * Constructs a WebGL texture object from an HTMLImageElement.
   * @param gl WebGL2 rendering context
   * @param image Loaded image element
   * @returns WebGL texture object
   * @throws Error if texture creation fails
   */
  private createTextureFromImage(
    gl: WebGL2RenderingContext,
    image: TexImageSource,
  ): WebGLTexture {
    const texture = gl.createTexture();
    if (!texture) {
      throw new Error("Failed to create WebGL texture object.");
    }

    gl.bindTexture(gl.TEXTURE_2D, texture);

    const flipY: boolean = gl.getParameter(gl.UNPACK_FLIP_Y_WEBGL);
    const premultiplyAlpha: boolean = gl.getParameter(
      gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL,
    );
    try {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, true);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, true);

      gl.texImage2D(
        gl.TEXTURE_2D,
        0,
        gl.RGBA,
        gl.RGBA,
        gl.UNSIGNED_BYTE,
        image,
      );
    } finally {
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, flipY);
      gl.pixelStorei(gl.UNPACK_PREMULTIPLY_ALPHA_WEBGL, premultiplyAlpha);
    }

    // 任意の画像サイズ (NPOT) に対応するためのテクスチャパラメータ設定
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);

    return texture;
  }

  /**
   * Retrieves a cached texture.
   * @param url Image URL
   * @returns Cached WebGL texture or undefined if not found
   */
  public getTexture(url: string): WebGLTexture | undefined {
    return this.cache.get(url);
  }

  /**
   * Deletes and clears the cached texture for the specified URL.
   * @param gl WebGL2 rendering context
   * @param url Image URL
   */
  public deleteTexture(gl: WebGL2RenderingContext, url: string): void {
    const texture = this.cache.get(url);
    if (texture) {
      gl.deleteTexture(texture);
      this.cache.delete(url);
    }
  }

  /**
   * Releases all cached textures from WebGL memory.
   * @param gl WebGL2 rendering context
   */
  public clear(gl: WebGL2RenderingContext): void {
    for (const texture of this.cache.values()) {
      gl.deleteTexture(texture);
    }
    this.cache.clear();
    this.imageCache.clear();
  }
}
