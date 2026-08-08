'use strict';

import { LitElement, html, css } from 'lit';

// A WebGL bokeh blur of a still image, used behind a board frame's action menu
// (Figma node 82-149: the frame blurs when an option is opened). The Figma used
// a shader, so this is a real disc/bokeh blur -- golden-angle spiral sampling
// with highlight weighting, which gives the round out-of-focus look a plain
// gaussian (CSS blur) cannot -- not a filter approximation.
//
// It renders once per src/radius (a still frame needs no animation loop) into a
// canvas sized to the element. Video boards have no still texture to sample, so
// the caller falls back to a CSS blur for those; this component is images only.
const VERT = `
attribute vec2 p;
varying vec2 uv;
void main(){ uv = vec2((p.x+1.0)/2.0, 1.0-(p.y+1.0)/2.0); gl_Position = vec4(p,0.0,1.0); }`;

const FRAG = `
precision highp float;
uniform sampler2D tex;
uniform vec2 res;
uniform float radius;
varying vec2 uv;
const int SAMPLES = 48;
const float GOLDEN = 2.39996323;
void main(){
  vec3 col = vec3(0.0);
  float total = 0.0;
  for (int i = 0; i < SAMPLES; i++){
    float t = float(i);
    float r = sqrt(t / float(SAMPLES));          // even coverage of the disc
    float a = t * GOLDEN;
    vec2 off = vec2(cos(a), sin(a)) * r * radius / res;
    vec3 s = texture2D(tex, uv + off).rgb;
    float lum = dot(s, vec3(0.299, 0.587, 0.114));
    float w = 1.0 + lum * lum * 2.0;             // bloom bright spots, the bokeh look
    col += s * w;
    total += w;
  }
  gl_FragColor = vec4(col / total, 1.0);
}`;

export class PdBokeh extends LitElement {
  static properties = { src: {}, radius: { type: Number } };

  static styles = css`
    :host{display:block;position:absolute;inset:0}
    canvas{width:100%;height:100%;display:block}
  `;

  constructor() {
    super();
    this.radius = 14;
    this._gl = null;
  }

  firstUpdated() { this.#init(); }

  updated(changed) {
    if (changed.has('src')) this.#loadTexture();
    else if (changed.has('radius')) this.#draw();
  }

  disconnectedCallback() {
    if (this._gl) { const l = this._gl.getExtension('WEBGL_lose_context'); if (l) l.loseContext(); }
    super.disconnectedCallback();
  }

  #init() {
    const canvas = this.renderRoot.querySelector('canvas');
    const gl = canvas.getContext('webgl', { premultipliedAlpha: false });
    if (!gl) return; // no WebGL: the caller's CSS-blur fallback covers this
    this._gl = gl;
    this._canvas = canvas;
    const prog = this.#program(gl, VERT, FRAG);
    if (!prog) return;
    gl.useProgram(prog);
    const buf = gl.createBuffer();
    gl.bindBuffer(gl.ARRAY_BUFFER, buf);
    gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([-1, -1, 1, -1, -1, 1, 1, 1]), gl.STATIC_DRAW);
    const loc = gl.getAttribLocation(prog, 'p');
    gl.enableVertexAttribArray(loc);
    gl.vertexAttribPointer(loc, 2, gl.FLOAT, false, 0, 0);
    this._u = { res: gl.getUniformLocation(prog, 'res'), radius: gl.getUniformLocation(prog, 'radius') };
    this.#loadTexture();
  }

  #program(gl, vsrc, fsrc) {
    const compile = (type, src) => {
      const sh = gl.createShader(type);
      gl.shaderSource(sh, src); gl.compileShader(sh);
      return gl.getShaderParameter(sh, gl.COMPILE_STATUS) ? sh : null;
    };
    const vs = compile(gl.VERTEX_SHADER, vsrc), fs = compile(gl.FRAGMENT_SHADER, fsrc);
    if (!vs || !fs) return null;
    const prog = gl.createProgram();
    gl.attachShader(prog, vs); gl.attachShader(prog, fs); gl.linkProgram(prog);
    return gl.getProgramParameter(prog, gl.LINK_STATUS) ? prog : null;
  }

  #loadTexture() {
    const gl = this._gl;
    if (!gl || !this.src) return;
    const img = new Image();
    img.crossOrigin = 'anonymous';
    img.onload = () => {
      const tex = gl.createTexture();
      gl.bindTexture(gl.TEXTURE_2D, tex);
      gl.pixelStorei(gl.UNPACK_FLIP_Y_WEBGL, false);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR);
      gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
      gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGB, gl.RGB, gl.UNSIGNED_BYTE, img);
      this.#draw();
    };
    img.src = this.src;
  }

  #draw() {
    const gl = this._gl, canvas = this._canvas;
    if (!gl || !canvas) return;
    const w = canvas.clientWidth || 320, h = canvas.clientHeight || 180;
    canvas.width = w; canvas.height = h;
    gl.viewport(0, 0, w, h);
    gl.uniform2f(this._u.res, w, h);
    gl.uniform1f(this._u.radius, this.radius);
    gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
  }

  render() { return html`<canvas></canvas>`; }
}

customElements.define('pd-bokeh', PdBokeh);
