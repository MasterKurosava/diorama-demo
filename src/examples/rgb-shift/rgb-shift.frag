uniform sampler2D uTexture;
uniform float uTime;
uniform float uVelocity;
uniform float uStrength; // @default 0.02
uniform float uGrain;    // @default 0.06
varying vec2 vUv;

float hash(vec2 p) {
  p = fract(p * vec2(123.34, 456.21));
  p += dot(p, p + 45.32);
  return fract(p.x * p.y);
}

float noise(vec2 p) {
  vec2 i = floor(p);
  vec2 f = fract(p);
  vec2 u = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash(i), hash(i + vec2(1.0, 0.0)), u.x),
             mix(hash(i + vec2(0.0, 1.0)), hash(i + vec2(1.0, 1.0)), u.x), u.y);
}

void main() {
  float n = noise(vec2(vUv.y * 40.0, uTime * 4.0)) - 0.5;
  vec2 shift = vec2(uStrength * uVelocity + n * 0.004 * abs(uVelocity), 0.0);
  vec4 base = texture2D(uTexture, vUv);
  float r = texture2D(uTexture, vUv + shift).r;
  float b = texture2D(uTexture, vUv - shift).b;
  float grain = (hash(vUv * 500.0 + uTime) - 0.5) * uGrain;
  gl_FragColor = vec4(vec3(r, base.g, b) + grain, base.a);
}
