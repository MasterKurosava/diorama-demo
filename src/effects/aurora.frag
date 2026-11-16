// Night sky behind the ice: stars, a paper moon, aurora curtains leaning towards the
// pointer and lanterns rising behind two ridges. Only sines and hashes, so it compiles fast.
uniform float uTime;
uniform vec2 uPointer; // @input pointer
uniform float uHover;
uniform vec2 uSize;
varying vec2 vUv;

float hash(vec2 p) {
  return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453);
}

float noise(float x) {
  float i = floor(x);
  float f = fract(x);
  return mix(hash(vec2(i, 0.0)), hash(vec2(i + 1.0, 0.0)), f * f * (3.0 - 2.0 * f));
}

// Green at the hem, teal above, violet where it fades. Brighter where a fold is seen edge-on.
vec3 curtain(vec2 p, float base, float seed, float t, float lean) {
  float wave = p.x * 2.4 + t * 0.05 + seed;
  float fold = p.x + 0.16 * sin(wave) + lean * (p.y - base);
  float edgeOn = 0.62 / (1.0 + 0.38 * cos(wave));
  float hem = base + 0.06 * sin(fold * 2.2 + t * 0.04 + seed * 3.0)
                   + 0.02 * sin(fold * 6.0 - t * 0.07);
  float d = p.y - hem;
  float rays = noise(fold * 42.0 + t * 0.16 + seed * 9.0) * 0.6
             + noise(fold * 14.0 - t * 0.09) * 0.4;
  float glow = noise(fold * 1.7 + t * 0.025 + seed * 5.0);
  float body = smoothstep(-0.003, 0.01, d) * exp(-max(d, 0.0) * 3.8)
             * (0.3 + rays * rays * 1.7);
  vec3 tint = mix(vec3(0.16, 0.92, 0.56), vec3(0.12, 0.62, 0.78),
                  smoothstep(0.0, 0.16, d));
  tint = mix(tint, vec3(0.52, 0.2, 0.72), smoothstep(0.12, 0.42, d));
  vec3 hemline = vec3(0.92, 0.26, 0.62) * exp(-abs(d + 0.006) * 240.0)
               * (0.25 + rays);
  return (tint * body * 1.4 + hemline * 0.55) * edgeOn * (0.3 + 0.7 * glow * glow);
}

// One lantern per lane, drifting up, swaying and shrinking into the distance.
vec4 lanterns(vec2 px, float t, float lane, float scale, float speed, float seed) {
  float col = floor(px.x / lane);
  float h = hash(vec2(col, seed));
  float life = fract(t * speed * (0.7 + 0.6 * h) + hash(vec2(col, seed + 1.0)));
  float x = (col + 0.3 + 0.4 * hash(vec2(col, seed + 2.0))) * lane;
  x += sin(t * 0.35 + h * 20.0) * 7.0;
  float s = scale * mix(1.0, 0.4, life);
  vec2 q = (px - vec2(x, mix(-60.0, uSize.y + 40.0, life))) / s;
  float w = mix(6.5, 9.0, clamp(q.y / 22.0 + 0.5, 0.0, 1.0));
  float paper = smoothstep(1.2 / s, -1.2 / s, max(abs(q.x) - w, abs(q.y) - 11.0));
  float mouth = exp(-length(q - vec2(0.0, -9.0)) * 0.35);
  vec3 lit = mix(vec3(0.86, 0.36, 0.2), vec3(1.0, 0.8, 0.55), mouth);
  lit *= 0.86 + 0.14 * cos(q.x * 1.3);
  float halo = exp(-length(q) * 0.075) * 0.32;
  float shown = step(0.45, h) * smoothstep(0.0, 0.08, life)
              * smoothstep(1.0, 0.75, life);
  return vec4(lit * paper + vec3(1.0, 0.62, 0.36) * halo, paper) * shown;
}

// Cut edge lit a little by the aurora.
vec3 ridge(vec3 sky, vec2 p, float base, float amp, float seed, vec3 paper, vec3 lit) {
  float r = base + amp * (sin(p.x * 2.1 + seed) * 0.5
                        + sin(p.x * 4.9 + seed * 1.7) * 0.25
                        + sin(p.x * 11.0 + seed * 2.3) * 0.08);
  float aa = 1.2 / uSize.y;
  float edge = exp(-max(r - p.y, 0.0) * 100.0) * 0.38;
  return mix(sky, mix(paper, lit, edge), smoothstep(r + aa, r - aa, p.y));
}

void main() {
  float t = uTime;
  float aspect = uSize.x / uSize.y;
  vec2 p = vec2(vUv.x * aspect, vUv.y);
  vec2 px = vUv * uSize;

  // Wine at the horizon, then indigo, ink overhead.
  vec3 sky = mix(vec3(0.24, 0.08, 0.13), vec3(0.06, 0.06, 0.17),
                 smoothstep(0.02, 0.42, p.y));
  sky = mix(sky, vec3(0.02, 0.025, 0.075), smoothstep(0.4, 1.0, p.y));

  // One star per cell, only a few bright.
  vec2 cell = floor(px / 38.0);
  vec2 at = (cell + 0.15 + 0.7 * vec2(hash(cell), hash(cell + 7.3))) * 38.0;
  float b = hash(cell + 3.1);
  float twinkle = 0.7 + 0.3 * sin(t * (0.8 + b * 2.0) + b * 40.0);
  float star = smoothstep(1.6, 0.2, length(px - at)) * smoothstep(0.7, 1.0, b);
  sky += vec3(0.85, 0.88, 1.0) * star * twinkle * smoothstep(0.2, 0.6, p.y);

  // Three curtains, the far one faint.
  float lean = (uPointer.x - 0.5) * 0.5 * uHover;
  vec3 aurora = curtain(p, 0.5, 1.0, t, lean) * 0.75
              + curtain(p, 0.6, 4.0, t, lean * 0.7)
              + curtain(p * vec2(0.8, 1.0), 0.72, 8.0, t, lean * 0.5) * 0.55;
  sky += aurora * smoothstep(0.18, 0.42, p.y);

  // Moon high on the right, a bit lower on tall screens.
  float high = mix(0.79, 0.86, smoothstep(0.6, 1.1, aspect));
  vec2 moon = vec2(aspect - min(0.16, aspect * 0.15), high);
  vec2 to = p - moon;
  float m = length(to);
  float disc = smoothstep(0.026 + 1.2 / uSize.y, 0.026 - 1.2 / uSize.y, m);
  float shade = 0.92 + 0.08 * dot(to / max(m, 1e-4), vec2(0.6, 0.8));
  sky += vec3(0.9, 0.86, 0.78) * disc * shade;
  sky += vec3(0.45, 0.5, 0.72) * (exp(-m * 14.0) * 0.22 + exp(-m * 4.0) * 0.06);

  // Lanterns rise behind each of the two ridges.
  vec4 back = lanterns(px, t, 130.0, 0.85, 0.012, 2.0);
  sky = sky * (1.0 - back.a) + back.rgb;
  sky = ridge(sky, p, 0.2, 0.05, 1.3,
              vec3(0.1, 0.07, 0.17), vec3(0.2, 0.36, 0.38));
  vec4 front = lanterns(px, t, 210.0, 1.35, 0.016, 9.0);
  sky = sky * (1.0 - front.a) + front.rgb;
  sky = ridge(sky, p + vec2(3.0, 0.0), 0.1, 0.045, 5.1,
              vec3(0.05, 0.035, 0.09), vec3(0.16, 0.24, 0.3));

  // Fade the top into the wall above.
  float top = smoothstep(1.0, 1.0 - 160.0 / max(uSize.y, 1.0), vUv.y);
  gl_FragColor = vec4(sky, top);
}
