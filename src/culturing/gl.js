// The WebGL2 plumbing the workbench stands on: programs with their uniforms
// looked up once, float textures, framebuffers with several colour
// attachments, and the one triangle every simulation pass draws.
//
// Nothing here knows about agar. It is small enough that a library would
// have cost more than it saved: the site ships no 3D dependency, and the
// workbench only ever draws full-target passes and a handful of meshes.

/** Compile one shader, throwing with the offending line numbered. */
function compile(gl, type, source) {
  const shader = gl.createShader(type);
  gl.shaderSource(shader, source);
  gl.compileShader(shader);
  if (!gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
    const log = gl.getShaderInfoLog(shader) || 'unknown error';
    gl.deleteShader(shader);
    const numbered = source
      .split('\n')
      .map((line, i) => `${String(i + 1).padStart(4)}  ${line}`)
      .join('\n');
    throw new Error(`Shader failed to compile:\n${log}\n${numbered}`);
  }
  return shader;
}

/**
 * Link a program and index its uniforms.
 *
 * `set` takes a plain object and writes each value by the uniform's own type,
 * so a pass says `{ uDt: 0.02, uGrow: [1, 1, 0, 0] }` and never names a
 * `uniform4fv`. A name the shader doesn't use (or that the compiler dropped)
 * is skipped: the libraries hand every pass the whole parameter set and each
 * shader takes what it declared. Samplers are bound with `textures`, which
 * assigns units in the order given.
 */
export function createProgram(gl, vertexSource, fragmentSource, label = '') {
  const program = gl.createProgram();
  const vs = compile(gl, gl.VERTEX_SHADER, vertexSource);
  const fs = compile(gl, gl.FRAGMENT_SHADER, fragmentSource);
  gl.attachShader(program, vs);
  gl.attachShader(program, fs);
  gl.linkProgram(program);
  gl.deleteShader(vs);
  gl.deleteShader(fs);
  if (!gl.getProgramParameter(program, gl.LINK_STATUS)) {
    const log = gl.getProgramInfoLog(program);
    gl.deleteProgram(program);
    throw new Error(`Program ${label} failed to link: ${log}`);
  }

  const uniforms = new Map();
  const count = gl.getProgramParameter(program, gl.ACTIVE_UNIFORMS);
  for (let i = 0; i < count; i += 1) {
    const info = gl.getActiveUniform(program, i);
    if (!info) continue;
    // An array reports as `name[0]`; it is set through its base name.
    const name = info.name.replace(/\[0\]$/, '');
    uniforms.set(name, {
      location: gl.getUniformLocation(program, info.name),
      type: info.type,
      size: info.size,
    });
  }

  function set(values) {
    for (const name in values) {
      const u = uniforms.get(name);
      if (!u) continue;
      const v = values[name];
      switch (u.type) {
        case gl.FLOAT:
          if (u.size > 1 || v.length) gl.uniform1fv(u.location, v);
          else gl.uniform1f(u.location, v);
          break;
        case gl.FLOAT_VEC2:
          gl.uniform2fv(u.location, v);
          break;
        case gl.FLOAT_VEC3:
          gl.uniform3fv(u.location, v);
          break;
        case gl.FLOAT_VEC4:
          gl.uniform4fv(u.location, v);
          break;
        case gl.FLOAT_MAT3:
          gl.uniformMatrix3fv(u.location, false, v);
          break;
        case gl.FLOAT_MAT4:
          gl.uniformMatrix4fv(u.location, false, v);
          break;
        case gl.INT:
        case gl.BOOL:
          gl.uniform1i(u.location, v);
          break;
        case gl.UNSIGNED_INT:
          gl.uniform1ui(u.location, v >>> 0);
          break;
        case gl.INT_VEC2:
          gl.uniform2iv(u.location, v);
          break;
        default:
          break;
      }
    }
  }

  /** Bind `{ uName: texture }` to consecutive units, starting at unit 0. */
  function textures(map) {
    let unit = 0;
    for (const name in map) {
      const u = uniforms.get(name);
      if (!u || !map[name]) continue;
      gl.activeTexture(gl.TEXTURE0 + unit);
      gl.bindTexture(gl.TEXTURE_2D, map[name]);
      gl.uniform1i(u.location, unit);
      unit += 1;
    }
  }

  return {
    program,
    use: () => gl.useProgram(program),
    set,
    textures,
    has: (name) => uniforms.has(name),
    dispose: () => gl.deleteProgram(program),
  };
}

/**
 * A 2D texture with its storage allocated up front. `filter` is the one
 * sampling choice a pass makes: simulation state is read texel by texel
 * (NEAREST), the display textures are interpolated (LINEAR, with mipmaps
 * when `mips` is set).
 */
export function createTexture(
  gl,
  width,
  height,
  {
    internalFormat,
    filter = gl.NEAREST,
    mips = false,
    wrap = gl.CLAMP_TO_EDGE,
  },
) {
  const texture = gl.createTexture();
  gl.bindTexture(gl.TEXTURE_2D, texture);
  const levels = mips ? Math.floor(Math.log2(Math.max(width, height))) + 1 : 1;
  gl.texStorage2D(gl.TEXTURE_2D, levels, internalFormat, width, height);
  gl.texParameteri(
    gl.TEXTURE_2D,
    gl.TEXTURE_MIN_FILTER,
    mips ? gl.LINEAR_MIPMAP_LINEAR : filter,
  );
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, filter);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, wrap);
  gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, wrap);
  return texture;
}

/**
 * A framebuffer drawing into several textures at once. The simulation's
 * state is wider than one RGBA texel, so each pass writes a group.
 */
export function createTarget(gl, textures) {
  const framebuffer = gl.createFramebuffer();
  gl.bindFramebuffer(gl.FRAMEBUFFER, framebuffer);
  const buffers = textures.map((texture, i) => {
    gl.framebufferTexture2D(
      gl.FRAMEBUFFER,
      gl.COLOR_ATTACHMENT0 + i,
      gl.TEXTURE_2D,
      texture,
      0,
    );
    return gl.COLOR_ATTACHMENT0 + i;
  });
  gl.drawBuffers(buffers);
  const status = gl.checkFramebufferStatus(gl.FRAMEBUFFER);
  gl.bindFramebuffer(gl.FRAMEBUFFER, null);
  if (status !== gl.FRAMEBUFFER_COMPLETE) {
    throw new Error(`Framebuffer incomplete: 0x${status.toString(16)}`);
  }
  return { framebuffer, textures };
}

export function disposeTarget(gl, target) {
  if (!target) return;
  gl.deleteFramebuffer(target.framebuffer);
  for (const texture of target.textures) gl.deleteTexture(texture);
}

/**
 * One oversized triangle covering the target. Three vertices and no index
 * buffer; the vertex shader builds the positions from gl_VertexID, so the
 * array object carries nothing.
 */
export function createFullscreen(gl) {
  const vao = gl.createVertexArray();
  return {
    draw() {
      gl.bindVertexArray(vao);
      gl.drawArrays(gl.TRIANGLES, 0, 3);
    },
    dispose: () => gl.deleteVertexArray(vao),
  };
}

export const FULLSCREEN_VERTEX = `#version 300 es
void main() {
  vec2 p = vec2(float((gl_VertexID << 1) & 2), float(gl_VertexID & 2));
  gl_Position = vec4(p * 2.0 - 1.0, 0.0, 1.0);
}`;

/**
 * What the device can do, asked once. The simulation needs to render into
 * float textures; without either extension there is no workbench, and the
 * page says so rather than drawing nothing.
 *
 * 32-bit targets are preferred: with 16 bits a slow field loses its smallest
 * increments, and a gradient that should be smooth settles into terraces.
 * `linearFloat` says whether the hardware will interpolate a 32-bit float
 * texture; where it won't (most phones), the shaders do the four fetches
 * themselves.
 */
export function detectCapabilities(gl) {
  const float32 = Boolean(gl.getExtension('EXT_color_buffer_float'));
  const float16 =
    float32 || Boolean(gl.getExtension('EXT_color_buffer_half_float'));
  const linearFloat = Boolean(gl.getExtension('OES_texture_float_linear'));
  return {
    ok: float16 && gl.getParameter(gl.MAX_DRAW_BUFFERS) >= 4,
    float32,
    linearFloat,
    stateFormat: float32 ? gl.RGBA32F : gl.RGBA16F,
    maxTextureSize: gl.getParameter(gl.MAX_TEXTURE_SIZE),
  };
}
