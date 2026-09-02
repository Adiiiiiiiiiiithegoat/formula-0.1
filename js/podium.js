import * as THREE from './vendor/three.module.js';
import { buildCarMesh } from './car.js';

const lam = (c) => new THREE.MeshLambertMaterial({ color: c, flatShading: true });

// Seven-segment digits, drawn as thin boxes on the face of a podium step.
const SEGS = {
  a: [0, 1, 1, 0], b: [0.5, 0.5, 0, 1], c: [0.5, -0.5, 0, 1],
  d: [0, -1, 1, 0], e: [-0.5, -0.5, 0, 1], f: [-0.5, 0.5, 0, 1], g: [0, 0, 1, 0],
};
const DIGITS = { 1: 'bc', 2: 'abged', 3: 'abgcd' };

function digit(n, h, color) {
  const g = new THREE.Group();
  const w = h * 0.55, t = h * 0.13;
  for (const key of DIGITS[n] || '') {
    const [x, y, horiz] = SEGS[key];
    const seg = new THREE.Mesh(
      horiz ? new THREE.BoxGeometry(w, t, t * 0.6) : new THREE.BoxGeometry(t, h / 2, t * 0.6),
      lam(color));
    seg.position.set(x * w, y * (h / 2), 0);
    g.add(seg);
  }
  return g;
}

// Tiny non-interactive scene: the top three cars parked on a podium.
export class PodiumScene {
  constructor(top3, skyColor = 0x8fd0ff) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(skyColor);
    this.scene.fog = new THREE.Fog(skyColor, 60, 220);
    this.camera = new THREE.PerspectiveCamera(46, 1, 0.5, 400);
    this.t = 0;

    this.scene.add(new THREE.HemisphereLight(0xffffff, 0x6d8a5a, 0.9));
    const sun = new THREE.DirectionalLight(0xfff2dc, 0.85);
    sun.position.set(24, 50, 30);
    this.scene.add(sun);
    this.scene.add(new THREE.AmbientLight(0xffffff, 0.3));

    const floor = new THREE.Mesh(new THREE.CircleGeometry(120, 28), lam(0x4c5158));
    floor.rotation.x = -Math.PI / 2;
    this.scene.add(floor);

    const back = new THREE.Mesh(new THREE.BoxGeometry(28, 9.5, 1), lam(0x1c2027));
    back.position.set(0, 5, -9);
    this.scene.add(back);
    for (let i = 0; i < 6; i++) {
      const s = new THREE.Mesh(new THREE.BoxGeometry(4, 1.2, 0.3), lam([0xd44b3f, 0xf2c400, 0x2b6fd4][i % 3]));
      s.position.set(-10.5 + i * 4.2, 7.8, -8.4);
      this.scene.add(s);
    }

    // 1st in the centre and tallest
    const steps = [{ pos: 2, x: -7.2, h: 1.6 }, { pos: 1, x: 0, h: 2.6 }, { pos: 3, x: 7.2, h: 1.0 }];
    for (const st of steps) {
      const entry = top3[st.pos - 1];
      const block = new THREE.Mesh(new THREE.BoxGeometry(6.4, st.h, 7.0), lam(0xe6e9ee));
      block.position.set(st.x, st.h / 2, 0);
      this.scene.add(block);
      const lip = new THREE.Mesh(new THREE.BoxGeometry(6.8, 0.22, 7.4), lam(0xffa519));
      lip.position.set(st.x, st.h + 0.1, 0);
      this.scene.add(lip);

      const d = digit(st.pos, Math.min(1.5, st.h * 0.7), 0x1c2027);
      d.position.set(st.x, st.h * 0.5, 3.55);
      this.scene.add(d);

      if (!entry) continue;
      const car = buildCarMesh(entry.team);
      car.position.set(st.x, st.h + 0.35, 0);
      car.rotation.y = Math.PI;
      this.scene.add(car);
      const flag = new THREE.Mesh(new THREE.BoxGeometry(2.4, 3.6, 0.2), lam(entry.team.body));
      flag.position.set(st.x, st.h + 3.4, -3.2);
      this.scene.add(flag);
      const stripe = new THREE.Mesh(new THREE.BoxGeometry(2.4, 0.8, 0.3), lam(entry.team.accent));
      stripe.position.set(st.x, st.h + 2.3, -3.2);
      this.scene.add(stripe);
    }
  }

  update(dt) {
    this.t += dt;
    const a = -0.3 + Math.sin(this.t * 0.2) * 0.38;
    const r = 16.5;
    this.camera.position.set(Math.sin(a) * r, 6.1 + Math.sin(this.t * 0.28) * 0.7, Math.cos(a) * r + 2);
    this.camera.lookAt(0, 3.1, 0);
  }

  dispose() {
    this.scene.traverse(o => {
      if (o.geometry) o.geometry.dispose();
      if (o.material) (Array.isArray(o.material) ? o.material : [o.material]).forEach(m => m.dispose());
    });
  }
}
