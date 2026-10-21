fn cartoonFilm(
  fragCoord: vec2f,
  iTime: f32,
  iResolution: vec2f,
  iChannel0: texture_2d<f32>,
  iChannel0Sampler: sampler,
  iChannel1: texture_depth_2d,
  cameraNear: f32,
  cameraFar: f32,
  damage: f32,
) -> vec4f {
  let FILM_FPS = 30.0;
  let EXPOSURE = 2.0;

  let frame = floor(iTime * FILM_FPS);
  let scale = iResolution.y / 600.0;

  let weave = vec2f(cartoonHash(frame * 1.7) - 0.5, cartoonHash(frame * 3.1) - 0.5) * 1.5 * scale;
  var pixel = fragCoord + weave;
  pixel.y = iResolution.y - pixel.y;
  pixel = clamp(pixel, vec2f(1.0), iResolution - 2.0);

  let scene = textureSampleLevel(iChannel0, iChannel0Sampler, pixel / iResolution, 0.0);
  let lum = clamp(pow(dot(scene.rgb, vec3f(0.299, 0.587, 0.114)), 1.0 / 2.2) * EXPOSURE, 0.0, 1.0);
  var col = vec3f(cartoonTone(lum)) * vec3f(1.0, 0.98, 0.92);

  let edge = cartoonEdge(iChannel1, pixel, iResolution, scale, cameraNear, cameraFar);
  col = mix(col, vec3f(0.03), edge);

  col = cartoonOldFilm(col, fragCoord, iResolution, frame, scale, clamp(damage, 0.0, 6.0));
  return vec4f(clamp(col, vec3f(0.0), vec3f(1.0)), 1.0);
}

fn cartoonTone(lum: f32) -> f32 {
  let level = lum * 3.0;
  let stepped = (floor(level) + smoothstep(0.42, 0.58, fract(level))) / 3.0;
  return mix(0.07, 0.95, stepped);
}

fn cartoonEdge(depthTexture: texture_depth_2d, pixel: vec2f, iResolution: vec2f, scale: f32, near: f32, far: f32) -> f32 {
  let EDGE_WIDTH = 2.0;
  let EDGE_DEPTH_JUMP = 0.06;

  let depth = cartoonLinearDepth(textureLoad(depthTexture, vec2i(pixel), 0), near, far);
  let radius = EDGE_WIDTH * scale;
  for (var i = 0; i < 8; i++) {
    let angle = f32(i) * 0.785398;
    let neighbourPixel = clamp(pixel + vec2f(cos(angle), sin(angle)) * radius, vec2f(0.0), iResolution - 1.0);
    let neighbour = cartoonLinearDepth(textureLoad(depthTexture, vec2i(neighbourPixel), 0), near, far);
    if (neighbour - depth > depth * EDGE_DEPTH_JUMP) {
      return 1.0;
    }
  }
  return 0.0;
}

fn cartoonOldFilm(colIn: vec3f, fragCoord: vec2f, iResolution: vec2f, frame: f32, scale: f32, wear: f32) -> vec3f {
  var col = colIn;

  let flicker = 0.1 * (1.0 + wear * 0.6);
  col = col * (1.0 - flicker * 0.7 + cartoonHash(frame) * flicker);

  let grain = 0.09 * (1.0 + wear * 0.8);
  let grainCell = floor(fragCoord / max(scale, 1.0));
  col = col + (cartoonHash(dot(grainCell, vec2f(12.9898, 78.233)) + frame) - 0.5) * grain;

  let scratchChance = clamp(0.18 + wear * 0.22, 0.0, 0.95);
  for (var i = 0; i < 4; i++) {
    let seed = frame * 0.37 + f32(i) * 17.31;
    if (f32(i) <= wear && cartoonHash(seed) < scratchChance) {
      let x = cartoonHash(seed * 5.3) * iResolution.x;
      let width = (0.6 + cartoonHash(seed * 2.2) * (1.0 + wear * 0.5)) * scale;
      col = mix(col, vec3f(0.9), (1.0 - smoothstep(0.0, width, abs(fragCoord.x - x))) * 0.6);
    }
  }

  let cell = floor(fragCoord / (40.0 * scale));
  let speck = cartoonHash(dot(cell, vec2f(7.13, 157.1)) + frame * 13.7);
  if (speck > 0.985 - wear * 0.008) {
    let centre = (cell + vec2f(cartoonHash(speck * 11.0), cartoonHash(speck * 23.0))) * 40.0 * scale;
    col = mix(col, vec3f(0.05), 1.0 - smoothstep(1.0 * scale, 2.5 * scale, length(fragCoord - centre)));
  }

  let centred = fragCoord / iResolution - 0.5;
  return col * (1.0 - smoothstep(0.35, 0.75, length(centred * vec2f(1.1, 1.0))) * 0.7);
}

fn cartoonHash(x: f32) -> f32 {
  return fract(sin(x * 91.3458) * 47453.5453);
}

fn cartoonLinearDepth(d: f32, near: f32, far: f32) -> f32 {
  return (near * far) / (far - d * (far - near));
}
