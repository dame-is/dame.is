// How a cloud is drawn: lots of soft, lit sphere impostors ("puffs") with
// noisy, eroded edges, sun on one side and a warm rim on the other, fading
// into haze with distance. Brought over from an earlier sky of the same
// author's.

import * as THREE from 'three';

/** Tileable value noise, for the puff edges and the cloud sea under the horizon. */
export function makeNoise(size) {
  const oct = [
    [4, 0.42],
    [8, 0.28],
    [16, 0.16],
    [32, 0.09],
    [64, 0.05],
  ];
  const grids = oct.map(([p]) => {
    const g = new Float32Array(p * p);
    for (let i = 0; i < g.length; i++) g[i] = Math.random();
    return g;
  });
  const sum = oct.reduce((s, o) => s + o[1], 0);
  const tmp = new Float32Array(size * size);
  let lo = 1e9;
  let hi = -1e9;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      let v = 0;
      for (let k = 0; k < oct.length; k++) {
        const p = oct[k][0];
        const g = grids[k];
        const fx = (x / size) * p;
        const fy = (y / size) * p;
        const ix = Math.floor(fx);
        const iy = Math.floor(fy);
        let tx = fx - ix;
        let ty = fy - iy;
        tx = tx * tx * (3 - 2 * tx);
        ty = ty * ty * (3 - 2 * ty);
        const x0 = ix % p;
        const x1 = (ix + 1) % p;
        const y0 = iy % p;
        const y1 = (iy + 1) % p;
        const a = g[y0 * p + x0];
        const b = g[y0 * p + x1];
        const c = g[y1 * p + x0];
        const d = g[y1 * p + x1];
        v +=
          oct[k][1] * ((a + (b - a) * tx) * (1 - ty) + (c + (d - c) * tx) * ty);
      }
      v /= sum;
      tmp[y * size + x] = v;
      lo = Math.min(lo, v);
      hi = Math.max(hi, v);
    }
  }
  const data = new Uint8Array(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const v = Math.round(((tmp[i] - lo) / (hi - lo)) * 255);
    data[i * 4] = data[i * 4 + 1] = data[i * 4 + 2] = v;
    data[i * 4 + 3] = 255;
  }
  const tex = new THREE.DataTexture(data, size, size, THREE.RGBAFormat);
  tex.wrapS = tex.wrapT = THREE.RepeatWrapping;
  tex.magFilter = THREE.LinearFilter;
  tex.minFilter = THREE.LinearMipmapLinearFilter;
  tex.generateMipmaps = true;
  tex.needsUpdate = true;
  return tex;
}

/**
 * One material for a batch of puffs. Each puff is an instance: aPos (where),
 * aRad (how big), aData (overall light, storm shade, alpha, seed), aFx
 * (picked glow, lightning flash, edge erosion, far: 1 for the far ring,
 * which hazes by its own curve) and aShape (an axis in world space and the
 * stretch along it). `uTime` and `uSunView` are { value } objects the caller
 * keeps up to date; the colours are THREE.Color objects it can ease.
 *
 * A stretched puff is a spheroid, and seen from anywhere it is an ellipse:
 * the vertex shader projects the axis onto the screen, finds the ellipse's
 * two axes, and lays the quad along them. The fragment shader then works in
 * the quad's own (round) space, so the noise stretches with the puff, and a
 * long streak gets it combed into fibres; a squashed one is a pancake.
 */
export function puffMaterial(o) {
  return new THREE.ShaderMaterial({
    transparent: true,
    depthWrite: false,
    depthTest: true,
    blending: THREE.CustomBlending,
    blendSrc: THREE.OneFactor,
    blendDst: THREE.OneMinusSrcAlphaFactor,
    blendSrcAlpha: THREE.OneFactor,
    blendDstAlpha: THREE.OneMinusSrcAlphaFactor,
    uniforms: {
      uTime: o.uTime,
      uNoise: { value: o.noise },
      uSunView: o.uSunView,
      uLit: { value: o.lit },
      uShadow: { value: o.shadow },
      uRim: { value: o.rim },
      uStorm: { value: o.storm },
      uFog: { value: o.fog },
      uAccent: { value: o.accent },
      uFogNear: { value: o.fogNear },
      uFogFar: { value: o.fogFar },
      uFogMax: { value: o.fogMax },
      uBillow: { value: o.billow },
    },
    vertexShader: `
      attribute vec3 aPos; attribute float aRad; attribute vec4 aData; attribute vec4 aFx; attribute vec4 aShape;
      uniform float uTime, uFogNear, uFogFar, uFogMax, uBillow;
      varying vec2 vUv; varying vec4 vData; varying vec4 vFx; varying float vFog; varying vec2 vE1; varying float vFiber; varying float vFlat;
      void main(){
        vec4 mv = viewMatrix * vec4(aPos, 1.0);
        float r = aRad * (1.0 + 0.045 * uBillow * sin(uTime * 0.8 + aData.w * 40.0));
        // the spheroid's outline on screen, in units of r: I + k a a^T, a being its axis as seen from here
        vec2 a = (mat3(viewMatrix) * aShape.xyz).xy;
        float k = aShape.w * aShape.w - 1.0;
        float cxx = 1.0 + k * a.x * a.x, cyy = 1.0 + k * a.y * a.y, cxy = k * a.x * a.y;
        float m = 0.5 * (cxx + cyy), dl = sqrt(0.25 * (cxx - cyy) * (cxx - cyy) + cxy * cxy);
        float l1 = m + dl, l2 = max(m - dl, 0.0004);
        vec2 e1 = abs(cxy) > 1e-5 ? normalize(vec2(l1 - cyy, cxy)) : (cxx >= cyy ? vec2(1.0, 0.0) : vec2(0.0, 1.0));
        mv.xy += (position.x * sqrt(l1) * e1 + position.y * sqrt(l2) * vec2(-e1.y, e1.x)) * r * 1.25;
        gl_Position = projectionMatrix * mv;
        vUv = position.xy; vData = aData; vFx = aFx; vE1 = e1;
        vFiber = smoothstep(1.7, 3.6, sqrt(l1 / l2));
        vFlat = smoothstep(0.95, 0.45, aShape.w);
        float d = -mv.z;
        vFog = mix(smoothstep(uFogNear, uFogFar, d), mix(0.42, 0.9, smoothstep(300.0, 1500.0, d)), aFx.w) * uFogMax;
      }`,
    fragmentShader: `
      uniform sampler2D uNoise; uniform float uTime; uniform vec3 uSunView, uLit, uShadow, uRim, uStorm, uFog, uAccent;
      varying vec2 vUv; varying vec4 vData; varying vec4 vFx; varying float vFog; varying vec2 vE1; varying float vFiber; varying float vFlat;
      void main(){
        vec2 p = vUv * 1.25; float r2 = dot(p, p);
        if (r2 > 1.5625) discard;
        // x runs along the puff's long axis: a streak's noise changes slowly along it and fast across it
        vec2 nuv = vUv * vec2(0.32, 0.32 + vFiber * 0.9) + vData.w * vec2(13.17, 7.71) + uTime * vec2(0.006, 0.0025);
        float nn = texture2D(uNoise, nuv).r * 0.6 + texture2D(uNoise, nuv * 2.6 + 0.43).r * 0.4;
        float ero = vFx.z;
        // pancakes get softer edges, so a sheet of them melts into one
        float a = smoothstep(0.0, 0.42 + ero * 0.35 + vFlat * 0.3, (1.0 - r2) + (nn - 0.5) * ero * 1.5 - ero * 0.06);
        float alpha = a * vData.z;
        if (alpha < 0.004) discard;
        // p turned back to screen directions, for the light
        vec2 ps = p.x * vE1 + p.y * vec2(-vE1.y, vE1.x);
        float z = sqrt(max(1.0 - min(r2, 1.0), 0.0));
        vec3 N = normalize(vec3(ps * 0.5, z + 0.6));
        // mostly the cloud's own light, a little of the puff's roundness (less for pancakes, so a sheet reads as smooth)
        float L = clamp(mix(dot(N, uSunView) * 0.5 + 0.5, vData.x, 0.75 + vFlat * 0.2) + (nn - 0.5) * (0.2 - vFlat * 0.1), 0.0, 1.0);
        vec3 col = mix(uShadow, uLit, smoothstep(0.0, 0.78, L));
        col = mix(col, uStorm, vData.y);
        float rimF = pow(clamp(1.0 - z, 0.0, 1.0), 1.6) * (1.0 - vFlat * 0.75);
        float svl = length(uSunView.xy);
        float toward = svl > 0.001 ? clamp(dot(normalize(ps + 1e-4), uSunView.xy / svl), 0.0, 1.0) : 0.0;
        col += uRim * rimF * toward * (1.0 - vData.y * 0.7) * (0.3 + 0.5 * clamp(-uSunView.z, 0.0, 1.0));
        col = mix(col, uAccent, vFx.x * (0.1 + rimF * 0.35));
        col = mix(col, vec3(1.0, 0.99, 1.0), clamp(vFx.y, 0.0, 1.0) * 0.85);
        col = mix(col, uFog, vFog);
        gl_FragColor = vec4(col * alpha, alpha);
      }`,
  });
}
