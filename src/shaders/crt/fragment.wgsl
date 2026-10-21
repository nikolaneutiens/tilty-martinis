fn crtScreen(fragCoord: vec2f, iTime: f32, iResolution: vec2f, iChannel0: texture_2d<f32>, iChannel0Sampler: sampler) -> vec4f {
  var uv = fragCoord / iResolution;
  uv.y = 1.0 - uv.y;
  let crtCoords = crtBend(uv, 3.2);

  if (crtCoords.x < 0.0 || crtCoords.x > 1.0 || crtCoords.y < 0.0 || crtCoords.y > 1.0) {
    return vec4f(0.0, 0.0, 0.0, 1.0);
  }

  var col = crtSampleSplit(iChannel0, iChannel0Sampler, crtCoords, iTime);

  let screenSpace = crtCoords * iResolution;
  col = crtScanline(screenSpace, col, iTime);

  return vec4f(col, 1.0);
}

fn crtScanline(coord: vec2f, screen: vec3f, iTime: f32) -> vec3f {
  return screen - sin(coord.y + iTime * 29.0) * 0.02;
}

fn crtBend(coordIn: vec2f, bend: f32) -> vec2f {
  var coord = (coordIn - 0.5) * 2.0;

  coord = coord * 1.1;

  coord.x = coord.x * (1.0 + pow(abs(coord.y) / bend, 2.0));
  coord.y = coord.y * (1.0 + pow(abs(coord.x) / bend, 2.0));

  return coord / 2.0 + 0.5;
}

fn crtSampleSplit(tex: texture_2d<f32>, texSampler: sampler, coord: vec2f, iTime: f32) -> vec3f {
  let r = textureSampleLevel(tex, texSampler, vec2f(coord.x - 0.01 * sin(iTime), coord.y), 0.0).r;
  let g = textureSampleLevel(tex, texSampler, vec2f(coord.x, coord.y), 0.0).g;
  let b = textureSampleLevel(tex, texSampler, vec2f(coord.x + 0.01 * sin(iTime), coord.y), 0.0).b;
  return vec3f(r, g, b);
}
