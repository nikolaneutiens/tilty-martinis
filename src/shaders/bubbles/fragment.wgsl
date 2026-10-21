fn bubbles(fragCoord: vec2f, iTime: f32, iResolution: vec2f) -> vec4f {
  var uv = -1.0 + 2.0 * fragCoord / iResolution;
  uv.x = uv.x * iResolution.x / iResolution.y;
  uv = uv * 3.0;

  var color = vec3f(1.0);

  for (var i = 0; i < 64; i++) {
    let fi = f32(i);
    let pha = sin(fi * 546.13 + 1.0) * 0.5 + 0.5;
    let siz = pow(sin(fi * 651.74 + 5.0) * 0.5 + 0.5, 4.0);
    let pox = sin(fi * 321.55 + 4.1) * iResolution.x / iResolution.y * 3.0;

    let rad = 0.1 + 0.5 * siz + sin(iTime / 6.0 + pha * 500.0 + siz) / 20.0;
    let pos = vec2f(
      pox + sin(iTime / 10.0 + pha + siz),
      -3.0 - rad + (6.0 + 2.0 * rad) * fract(pha + 0.1 * (iTime / 5.0) * (0.2 + 0.8 * siz)),
    );
    let dis = length(uv - pos);
    let col = mix(
      vec3f(0.194 * sin(iTime / 6.0), 0.3, 0.0),
      vec3f(1.1 * sin(iTime / 9.0), 0.4, 0.8),
      0.5 + 0.5 * sin(fi * 1.2 + 1.9),
    );
    var f = length(uv - pos) / rad;
    f = sqrt(clamp(1.0 + (sin((iTime / 7.0) + pha * 500.0 + siz) * 0.5) - f * f, 0.0, 1.0));
    color = color - col.zyx * (1.0 - smoothstep(rad * 0.95, rad, dis)) * f;
  }

  let bubble = clamp(1.0 - dot(color, vec3f(0.299, 0.587, 0.114)), 0.0, 1.0);
  let martini = mix(vec3f(0.3), vec3f(1.0), bubble);
  return vec4f(martini, 1.0);
}
