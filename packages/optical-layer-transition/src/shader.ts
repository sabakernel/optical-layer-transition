/**
 * WebGL 2.0 shader program definition and compilation module.
 */

/**
 * Vertex shader GLSL source code (WebGL 2.0 / GLSL ES 3.00).
 */
export const VERTEX_SHADER_SOURCE = `#version 300 es
precision highp float;

// Vertex attribute: unit quad (0.0~1.0)
in vec2 a_position;

// Variables passed to fragment shader
out vec2 v_uv;
out vec2 v_srcUV;
out vec2 v_tgtUV;

// Uniform variables
uniform vec2 u_resolution; // Canvas size (width, height)
uniform vec4 u_bounds;     // Rendering bounds (startX, startY, endX, endY)
uniform vec4 u_srcBounds;  // Source image drawing area (startX, startY, endX, endY)
uniform vec4 u_tgtBounds;  // Target image drawing area (startX, startY, endX, endY)

void main() {
    // Calculate pixel coordinates in rendering area
    vec2 pixelPos = mix(u_bounds.xy, u_bounds.zw, a_position);

    // Convert to clip space coordinates (-1.0 ~ 1.0) with Y-axis flip
    vec2 clipPos = (pixelPos / u_resolution) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;

    gl_Position = vec4(clipPos, 0.0, 1.0);

    // Basic UV coordinates
    v_uv = a_position;

    // Calculate individual UV coordinates for source and target layers
    vec2 srcSize = max(u_srcBounds.zw - u_srcBounds.xy, vec2(0.0001));
    vec2 tgtSize = max(u_tgtBounds.zw - u_tgtBounds.xy, vec2(0.0001));

    v_srcUV = vec2(
      (pixelPos.x - u_srcBounds.x) / srcSize.x,
      1.0 - (pixelPos.y - u_srcBounds.y) / srcSize.y
    );
    v_tgtUV = vec2(
      (pixelPos.x - u_tgtBounds.x) / tgtSize.x,
      1.0 - (pixelPos.y - u_tgtBounds.y) / tgtSize.y
    );
}
`;

/**
 * Fragment shader GLSL source code (WebGL 2.0 / GLSL ES 3.00).
 * Implements optical noise sampling using PCG 2D Hash generator.
 */
export const FRAGMENT_SHADER_SOURCE = `#version 300 es
precision highp float;

in vec2 v_uv;
in vec2 v_srcUV;
in vec2 v_tgtUV;
out vec4 fragColor;

uniform sampler2D u_texSource;
uniform sampler2D u_texTarget;
uniform float u_progress;
uniform float u_time;
uniform bool u_overlay;

// PCG 2D Hash Generator (pseudo-random number generator)
uvec2 pcg2d(uvec2 v) {
    v = v * 1664525u + 1013904223u;
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v = v ^ (v >> 16u);
    v.x += v.y * 1664525u;
    v.y += v.x * 1664525u;
    v = v ^ (v >> 16u);
    return v;
}

// Generate 2D floating-point random numbers in the range 0.0 ~ 1.0
vec2 pcg2d_float(vec2 p, float seed) {
    uvec2 u = uvec2(ivec2(p + vec2(seed * 123.456, seed * 789.012)));
    uvec2 res = pcg2d(u);
    return vec2(res) * (1.0 / 4294967296.0);
}

void main() {
    float p = clamp(u_progress, 0.0, 1.0);

    // Check if UV coordinates are within bounds (transparent if outside)
    bool inSrc = v_srcUV.x >= 0.0 && v_srcUV.x <= 1.0 && v_srcUV.y >= 0.0 && v_srcUV.y <= 1.0;
    bool inTgt = v_tgtUV.x >= 0.0 && v_tgtUV.x <= 1.0 && v_tgtUV.y >= 0.0 && v_tgtUV.y <= 1.0;

    vec4 srcCol = inSrc ? texture(u_texSource, v_srcUV) : vec4(0.0);
    vec4 tgtCol = inTgt ? texture(u_texTarget, v_tgtUV) : vec4(0.0);

    if (u_overlay) {
        if (p <= 0.0) { fragColor = vec4(0.0); return; }

        float variance = max(0.0, 1.0 - p);
        vec2 rnd = pcg2d_float(gl_FragCoord.xy, u_time) - 0.5;
        vec2 offset = rnd * (variance * 0.03);
        vec2 noisyTgtUV = v_tgtUV + offset;
        bool inNoisyTgt = noisyTgtUV.x >= 0.0 && noisyTgtUV.x <= 1.0 && noisyTgtUV.y >= 0.0 && noisyTgtUV.y <= 1.0;
        vec4 noisyTarget = inNoisyTgt ? texture(u_texTarget, clamp(noisyTgtUV, 0.0, 1.0)) : vec4(0.0);
        float grain = rnd.x * variance * 0.25;
        vec3 color = clamp(
            noisyTarget.rgb + vec3(grain * noisyTarget.a),
            vec3(0.0),
            vec3(noisyTarget.a)
        );
        float alpha = noisyTarget.a * p;

        fragColor = vec4(color * p, alpha);
        return;
    }

    if (p <= 0.0) { fragColor = srcCol; return; }
    if (p >= 1.0) { fragColor = tgtCol; return; }

    float variance = max(0.0, 1.0 - p);
    vec2 rnd = pcg2d_float(gl_FragCoord.xy, u_time) - 0.5;
    vec2 offset = rnd * (variance * 0.03);

    // UV coordinates after applying noise offset
    vec2 noisyTgtUV = v_tgtUV + offset;
    bool inNoisyTgt = noisyTgtUV.x >= 0.0 && noisyTgtUV.x <= 1.0 && noisyTgtUV.y >= 0.0 && noisyTgtUV.y <= 1.0;
    vec4 noisyTarget = inNoisyTgt ? texture(u_texTarget, clamp(noisyTgtUV, 0.0, 1.0)) : vec4(0.0);

    float grain = rnd.x * variance * 0.25;
    vec4 blended = mix(srcCol, noisyTarget, p);
    vec3 color = clamp(
        blended.rgb + vec3(grain * blended.a),
        vec3(0.0),
        vec3(blended.a)
    );

    fragColor = vec4(color, blended.a);
}
`;

/**
 * Interface that holds locations of shader program uniforms and attributes.
 */
export interface ShaderProgramInfo {
  program: WebGLProgram;
  attribs: {
    position: number;
  };
  uniforms: {
    texSource: WebGLUniformLocation | null;
    texTarget: WebGLUniformLocation | null;
    progress: WebGLUniformLocation | null;
    time: WebGLUniformLocation | null;
    resolution: WebGLUniformLocation | null;
    bounds: WebGLUniformLocation | null;
    srcBounds: WebGLUniformLocation | null;
    tgtBounds: WebGLUniformLocation | null;
    overlay: WebGLUniformLocation | null;
  };
}

/**
 * Compiles a single shader object.
 * @param gl WebGL2 rendering context
 * @param type Shader type (VERTEX_SHADER or FRAGMENT_SHADER)
 * @param source GLSL source code
 * @returns Compiled WebGL shader object
 * @throws Error if shader compilation fails
 */
export function createShader(
  gl: WebGL2RenderingContext,
  type: number,
  source: string,
): WebGLShader {
  const shader = gl.createShader(type);
  if (!shader) {
    throw new Error("Failed to create WebGL shader object.");
  }

  gl.shaderSource(shader, source);
  gl.compileShader(shader);

  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const info = gl.getShaderInfoLog(shader);
    gl.deleteShader(shader);
    throw new Error(`Shader compilation error: ${info}`);
  }

  return shader;
}

/**
 * Creates a shader program by linking vertex and fragment shaders.
 * @param gl WebGL2 rendering context
 * @param vsSource Vertex shader source code (defaults to built-in vertex shader)
 * @param fsSource Fragment shader source code (defaults to built-in fragment shader)
 * @returns Shader program information including program object and attribute/uniform locations
 * @throws Error if program creation or linking fails
 */
export function createProgramInfo(
  gl: WebGL2RenderingContext,
  vsSource: string = VERTEX_SHADER_SOURCE,
  fsSource: string = FRAGMENT_SHADER_SOURCE,
): ShaderProgramInfo {
  const vs = createShader(gl, gl.VERTEX_SHADER, vsSource);
  const fs = createShader(gl, gl.FRAGMENT_SHADER, fsSource);

  const program = gl.createProgram();
  if (!program) {
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error("Failed to create WebGL program object.");
  }

  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);

  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const info = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    gl.deleteShader(vs);
    gl.deleteShader(fs);
    throw new Error(`Shader program link error: ${info}`);
  }

  // シェーダーリソースの解放 (リンク後は破棄可能)
  gl.deleteShader(vs);
  gl.deleteShader(fs);

  return {
    program,
    attribs: {
      position: gl.getAttribLocation(program, "a_position"),
    },
    uniforms: {
      texSource: gl.getUniformLocation(program, "u_texSource"),
      texTarget: gl.getUniformLocation(program, "u_texTarget"),
      progress: gl.getUniformLocation(program, "u_progress"),
      time: gl.getUniformLocation(program, "u_time"),
      resolution: gl.getUniformLocation(program, "u_resolution"),
      bounds: gl.getUniformLocation(program, "u_bounds"),
      srcBounds: gl.getUniformLocation(program, "u_srcBounds"),
      tgtBounds: gl.getUniformLocation(program, "u_tgtBounds"),
      overlay: gl.getUniformLocation(program, "u_overlay"),
    },
  };
}
