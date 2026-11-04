import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { RGBELoader } from "three/addons/loaders/RGBELoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";
import { EffectComposer } from "three/addons/postprocessing/EffectComposer.js";
import { RenderPass } from "three/addons/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/addons/postprocessing/UnrealBloomPass.js";
import { ShaderPass } from "three/addons/postprocessing/ShaderPass.js";
import { OutputPass } from "three/addons/postprocessing/OutputPass.js";
import { createAudio } from "./audio.js";
import { makeRetargeter, makeIdleClip } from "./retarget.js";

const sfx = new URLSearchParams(location.search).has("rec") ? null : createAudio();

// ================================================================ setup
const REC = new URLSearchParams(location.search).has("rec");
if (REC) document.body.classList.add("rec");

let seed = 20261104;
function rand() {
	seed |= 0; seed = (seed + 0x6d2b79f5) | 0;
	let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
	t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
	return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
}
const rr = (a, b) => a + rand() * (b - a);
const pick = (arr) => arr[Math.floor(rand() * arr.length)];
const clamp = (v, a, b) => Math.max(a, Math.min(b, v));
const wrapAngle = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };
const lerp = (a, b, k) => a + (b - a) * k;

const N = 8, BLOCK = 42, ROAD = 16, P = BLOCK + ROAD, CITY = N * P, LANE = 3.6;
const nodePos = (i) => i * P;
const BEACH_X = -ROAD / 2; // sand starts here, ocean further west

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: REC, powerPreference: "high-performance" });
renderer.setPixelRatio(REC ? 1 : Math.min(devicePixelRatio, 1.5));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.0;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xf2936e, 160, 620);
const camera = new THREE.PerspectiveCamera(60, innerWidth / innerHeight, 0.3, 2500);

// post: bloom for neon + a filmic grade
const composer = new EffectComposer(renderer);
composer.addPass(new RenderPass(scene, camera));
const bloom = new UnrealBloomPass(new THREE.Vector2(innerWidth, innerHeight), 0.55, 0.5, 0.97);
composer.addPass(bloom);
const grade = new ShaderPass({
	uniforms: { tDiffuse: { value: null }, aspect: { value: innerWidth / innerHeight } },
	vertexShader: `varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
	fragmentShader: `uniform sampler2D tDiffuse; uniform float aspect; varying vec2 vUv;
	void main(){
		vec4 c = texture2D(tDiffuse, vUv);
		float l = dot(c.rgb, vec3(0.299,0.587,0.114));
		c.rgb = mix(c.rgb, c.rgb * vec3(0.92,1.0,1.08), smoothstep(0.35, 0.0, l) * 0.6);   // teal shadows
		c.rgb = mix(c.rgb, c.rgb * vec3(1.08,0.98,0.9), smoothstep(0.3, 1.2, l) * 0.6);   // warm highlights
		c.rgb = mix(vec3(l), c.rgb, 1.12);                                                  // saturation
		vec2 d = (vUv - 0.5) * vec2(aspect, 1.0);
		c.rgb *= 1.0 - smoothstep(0.45, 1.15, length(d)) * 0.55;                             // vignette
		gl_FragColor = c;
	}`,
});
composer.addPass(grade);
composer.addPass(new OutputPass());
function resize() {
	renderer.setSize(innerWidth, innerHeight, false); composer.setSize(innerWidth, innerHeight);
	camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); grade.uniforms.aspect.value = camera.aspect;
}
addEventListener("resize", resize);

// ================================================================ sky + light
const SUN_DIR = new THREE.Vector3(-1, 0.075, 0.12).normalize();
{
	const mat = new THREE.ShaderMaterial({
		side: THREE.BackSide, depthWrite: false, fog: false, toneMapped: false,
		uniforms: { sun: { value: SUN_DIR } },
		vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
		fragmentShader: `uniform vec3 sun; varying vec3 vDir;
		float hash(vec2 p){ return fract(sin(dot(p, vec2(127.1,311.7))) * 43758.5453); }
		float noise(vec2 p){ vec2 i=floor(p), f=fract(p); f=f*f*(3.0-2.0*f);
			return mix(mix(hash(i),hash(i+vec2(1,0)),f.x), mix(hash(i+vec2(0,1)),hash(i+vec2(1,1)),f.x), f.y); }
		float fbm(vec2 p){ float v=0.0, a=0.5; for(int i=0;i<5;i++){ v+=a*noise(p); p*=2.03; a*=0.5; } return v; }
		void main(){
			vec3 d = normalize(vDir); float h = d.y;
			vec3 top = vec3(0.22,0.10,0.34); vec3 mid = vec3(0.95,0.42,0.42); vec3 hor = vec3(1.0,0.62,0.30);
			vec3 c = mix(hor, mid, smoothstep(0.0, 0.16, h)); c = mix(c, top, smoothstep(0.14, 0.62, h));
			if (h < 0.0) c = mix(hor, vec3(0.62,0.35,0.38), smoothstep(0.0,-0.25,h));
			float s = max(dot(d, normalize(sun)), 0.0);
			c += vec3(1.0,0.55,0.25) * pow(s, 6.0) * 0.55 + vec3(1.0,0.8,0.5) * pow(s, 60.0) * 0.8;
			// streaky clouds lit from below
			vec2 uv = d.xz / max(h + 0.12, 0.05);
			float cl = fbm(uv * vec2(0.9, 2.6) + 3.0);
			cl = smoothstep(0.52, 0.85, cl) * smoothstep(0.0, 0.08, h) * (1.0 - smoothstep(0.35, 0.7, h));
			vec3 cloudCol = mix(vec3(1.0,0.55,0.45), vec3(1.0,0.85,0.6), pow(s, 3.0));
			c = mix(c, cloudCol, cl * 0.75);
			c = mix(c, vec3(1.0,0.95,0.8)*2.4, smoothstep(0.9988, 0.9994, s));
			gl_FragColor = vec4(c, 1.0);
		}`,
	});
	scene.add(new THREE.Mesh(new THREE.SphereGeometry(2000, 48, 24), mat));
}
scene.add(new THREE.HemisphereLight(0xffc3a6, 0x403060, 0.7));
const sun = new THREE.DirectionalLight(0xffa36b, 3.2);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = 75;
Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 1, far: 500 });
sun.shadow.bias = -0.0005; sun.shadow.normalBias = 0.5;
scene.add(sun, sun.target);

// ================================================================ textures
function canvasTex(w, h, draw, { srgb = true, repeat = true } = {}) {
	const c = document.createElement("canvas"); c.width = w; c.height = h;
	draw(c.getContext("2d"), w, h);
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 8; if (repeat) t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
}
const asphaltRough = canvasTex(512, 512, (g, w, h) => {
	g.fillStyle = "#6a6a6a"; g.fillRect(0, 0, w, h);
	for (let i = 0; i < 9000; i++) { const v = 70 + Math.random() * 90; g.fillStyle = `rgb(${v},${v},${v})`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
	for (let i = 0; i < 26; i++) { // puddles = glossy
		const x = Math.random() * w, y = Math.random() * h, r = 20 + Math.random() * 60;
		const gr = g.createRadialGradient(x, y, 0, x, y, r); gr.addColorStop(0, "rgba(10,10,10,0.95)"); gr.addColorStop(1, "rgba(10,10,10,0)");
		g.fillStyle = gr; g.beginPath(); g.ellipse(x, y, r * 1.6, r, Math.random() * 3, 0, 7); g.fill();
	}
}, { srgb: false });
asphaltRough.repeat.set(60, 60);
const asphaltColor = canvasTex(512, 512, (g, w, h) => {
	g.fillStyle = "#3a3540"; g.fillRect(0, 0, w, h);
	for (let i = 0; i < 12000; i++) { const v = Math.random() * 30; g.fillStyle = `rgba(${40 + v},${36 + v},${46 + v},0.6)`; g.fillRect(Math.random() * w, Math.random() * h, 2, 2); }
});
asphaltColor.repeat.set(60, 60);
const tileTex = canvasTex(256, 256, (g, w, h) => {
	g.fillStyle = "#cdb8b3"; g.fillRect(0, 0, w, h);
	g.strokeStyle = "rgba(90,60,70,.25)"; g.lineWidth = 3;
	for (let i = 0; i <= 4; i++) { g.beginPath(); g.moveTo(i * 64, 0); g.lineTo(i * 64, h); g.stroke(); g.beginPath(); g.moveTo(0, i * 64); g.lineTo(w, i * 64); g.stroke(); }
});
tileTex.repeat.set(12, 12);

// window facades
function facade({ base, frame, glass, lit, cols = 4, rows = 4, ribbon = false }) {
	const map = canvasTex(256, 256, (g, w, h) => {
		g.fillStyle = base; g.fillRect(0, 0, w, h);
		if (ribbon) { for (let r = 0; r < rows; r++) { g.fillStyle = glass; g.fillRect(0, r * (h / rows) + 14, w, h / rows - 30); g.fillStyle = frame; for (let c = 1; c < cols; c++) g.fillRect(c * (w / cols) - 2, r * (h / rows) + 14, 4, h / rows - 30); } }
		else for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) { const cw = w / cols, ch = h / rows; g.fillStyle = frame; g.fillRect(c * cw + 6, r * ch + 8, cw - 12, ch - 16); g.fillStyle = glass; g.fillRect(c * cw + 9, r * ch + 11, cw - 18, ch - 22); }
	});
	const emissiveMap = canvasTex(256, 256, (g, w, h) => {
		g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
		for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) {
			if (Math.random() > 0.38) continue; const cw = w / cols, ch = h / rows;
			g.fillStyle = lit[(r + c) % lit.length]; g.fillRect(c * cw + 9, r * ch + (ribbon ? 14 : 11), cw - 18, ch - (ribbon ? 30 : 22));
		}
	});
	return { map, emissiveMap };
}
const GLASS_FACADES = [
	facade({ base: "#33465c", frame: "#9fb3c4", glass: "#4f6f8f", lit: ["#ffe1a8", "#fff6dc"], cols: 6, rows: 6 }),
	facade({ base: "#2b5662", frame: "#a8d4d8", glass: "#3f7f8c", lit: ["#bff8ff", "#ffe1a8"], cols: 6, rows: 6 }),
	facade({ base: "#5b4a52", frame: "#d8c1b8", glass: "#70606c", lit: ["#ffd7a0"], cols: 5, rows: 6 }),
];
const PASTELS = ["#f4d6dc", "#d8f0ea", "#f6e3c8", "#e2dcf6", "#ffffff", "#fbd3c4", "#cfe8f4"];
const pastelFacades = PASTELS.map((p) => facade({ base: p, frame: "#ffffff", glass: "#5d7d93", lit: ["#ffe2a6", "#ffd0e8"], cols: 4, rows: 4, ribbon: true }));

function texMat(f, rx, ry, opts) {
	const map = f.map.clone(); map.repeat.set(rx, ry); map.needsUpdate = true;
	const em = f.emissiveMap.clone(); em.repeat.set(rx, ry); em.needsUpdate = true;
	return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.55, ...opts });
}
const roofMat = new THREE.MeshStandardMaterial({ color: 0x4a4250, roughness: 0.9 });
const whiteMat = new THREE.MeshStandardMaterial({ color: 0xf6f0ea, roughness: 0.6 });
const neonMats = {
	pink: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xff3fa4).multiplyScalar(3), toneMapped: false }),
	cyan: new THREE.MeshBasicMaterial({ color: new THREE.Color(0x33f0ff).multiplyScalar(3), toneMapped: false }),
	violet: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xa45bff).multiplyScalar(3), toneMapped: false }),
	warm: new THREE.MeshBasicMaterial({ color: new THREE.Color(0xffc879).multiplyScalar(2.2), toneMapped: false }),
};
const shopMat = new THREE.MeshStandardMaterial({ color: 0x1c1418, emissive: 0xffb36b, emissiveIntensity: 1.6, roughness: 0.3 });

// ================================================================ world
const colliders = [];
const blocks = [];
const world = new THREE.Group(); scene.add(world);
const staticBoxes = {}; // material -> list of matrices for instanced boxes
function boxInst(mat, x, y, z, sx, sy, sz, ry = 0) { (staticBoxes[mat.uuid] ||= { mat, list: [] }).list.push([x, y, z, sx, sy, sz, ry]); }
function flushBoxes() {
	const geo = new THREE.BoxGeometry(1, 1, 1);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
	for (const { mat, list } of Object.values(staticBoxes)) {
		const im = new THREE.InstancedMesh(geo, mat, list.length);
		list.forEach(([x, y, z, sx, sy, sz, ry], i) => { q.setFromAxisAngle(up, ry); m.compose(new THREE.Vector3(x, y, z), q, new THREE.Vector3(sx, sy, sz)); im.setMatrixAt(i, m); });
		im.castShadow = !mat.isMeshBasicMaterial; im.receiveShadow = true; world.add(im);
	}
}

const ground = new THREE.Mesh(new THREE.PlaneGeometry(4000, 4000), new THREE.MeshStandardMaterial({ map: asphaltColor, roughnessMap: asphaltRough, roughness: 1, metalness: 0.0, envMapIntensity: 1.6 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(CITY / 2, 0, CITY / 2); ground.receiveShadow = true; world.add(ground);
const sand = new THREE.Mesh(new THREE.PlaneGeometry(60, 4000), new THREE.MeshStandardMaterial({ color: 0xf2c79a, roughness: 1 }));
sand.rotation.x = -Math.PI / 2; sand.position.set(BEACH_X - 30, 0.04, CITY / 2); sand.receiveShadow = true; world.add(sand);
const oceanMat = new THREE.MeshStandardMaterial({ color: 0x1f5f86, roughness: 0.07, metalness: 0.25, envMapIntensity: 1.4 });
oceanMat.onBeforeCompile = (sh) => {
	sh.uniforms.uTime = { value: 0 }; oceanMat.userData.shader = sh;
	sh.vertexShader = "varying vec3 vWp;\n" + sh.vertexShader.replace("#include <worldpos_vertex>", "#include <worldpos_vertex>\n vWp = (modelMatrix * vec4(transformed,1.0)).xyz;");
	sh.fragmentShader = "uniform float uTime; varying vec3 vWp;\n" + sh.fragmentShader.replace("#include <normal_fragment_maps>",
		"#include <normal_fragment_maps>\n float w1 = sin(vWp.x*0.35 + uTime*1.2) * cos(vWp.z*0.21 - uTime*0.8); float w2 = sin(vWp.z*0.9 + vWp.x*0.4 + uTime*2.1);\n normal = normalize(normal + vec3(w1*0.06 + w2*0.03, 0.0, w2*0.05));");
};
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(2000, 4000), oceanMat);
ocean.rotation.x = -Math.PI / 2; ocean.position.set(BEACH_X - 60 - 1000, 0.08, CITY / 2); world.add(ocean);
const foam = new THREE.Mesh(new THREE.PlaneGeometry(3, 4000), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.55 }));
foam.rotation.x = -Math.PI / 2; foam.position.set(BEACH_X - 60, 0.1, CITY / 2); world.add(foam);

// road paint
{
	const dash = new THREE.PlaneGeometry(0.25, 3.4); dash.rotateX(-Math.PI / 2);
	const zebra = new THREE.PlaneGeometry(0.85, 5.5); zebra.rotateX(-Math.PI / 2);
	const yellow = new THREE.MeshStandardMaterial({ color: 0xf2c94c, roughness: 0.4 });
	const white = new THREE.MeshStandardMaterial({ color: 0xe8e2ea, roughness: 0.45 });
	const dashes = [], zebras = [];
	for (let k = 0; k <= N; k++) for (let s = 0; s < N; s++) {
		const a = s * P + ROAD / 2 + 7, b = (s + 1) * P - ROAD / 2 - 7;
		for (let t = a; t < b; t += 7) { dashes.push([nodePos(k) - 0.2, t, 0], [nodePos(k) + 0.2, t, 0], [t, nodePos(k) - 0.2, Math.PI / 2], [t, nodePos(k) + 0.2, Math.PI / 2]); }
	}
	for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
		const x = nodePos(i), z = nodePos(j);
		for (let q = -6; q <= 6; q += 1.6) zebras.push([x + q, z - ROAD / 2 - 2.9, 0], [x + q, z + ROAD / 2 + 2.9, 0], [x - ROAD / 2 - 2.9, z + q, Math.PI / 2], [x + ROAD / 2 + 2.9, z + q, Math.PI / 2]);
	}
	const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
	for (const [geo, mat, list] of [[dash, yellow, dashes], [zebra, white, zebras]]) {
		const im = new THREE.InstancedMesh(geo, mat, list.length); im.receiveShadow = true;
		list.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(new THREE.Vector3(x, 0.02, z), q4, one); im.setMatrixAt(i, m4); });
		world.add(im);
	}
}

// palms
const palmSpots = [];
const frondTex = canvasTex(128, 512, (g, w, h) => {
	g.clearRect(0, 0, w, h);
	g.strokeStyle = "#5d7a2e"; g.lineWidth = 5; g.beginPath(); g.moveTo(w / 2, h); g.lineTo(w / 2, 0); g.stroke();
	for (let y = 20; y < h - 10; y += 9) {
		const len = (w / 2 - 4) * Math.sin((y / h) * Math.PI) * 0.95 + 6;
		const col = ["#3f7d2e", "#4f9a38", "#2f6a2a", "#5aa640"][Math.floor(Math.random() * 4)];
		g.strokeStyle = col; g.lineWidth = 4;
		for (const s of [-1, 1]) { g.beginPath(); g.moveTo(w / 2, y); g.quadraticCurveTo(w / 2 + s * len * 0.6, y - 14, w / 2 + s * len, y + 10); g.stroke(); }
	}
}, { repeat: false });
function palmGeometry() {
	const trunks = []; const H = 11, segs = 14; let x = 0;
	const curve = []; for (let s = 0; s <= segs; s++) { const t = s / segs; curve.push(new THREE.Vector3(Math.sin(t * 1.4) * 1.6, t * H, 0)); }
	const path = new THREE.CatmullRomCurve3(curve);
	const trunk = new THREE.TubeGeometry(path, 24, 0.24, 7, false);
	const pos = trunk.attributes.position; // taper
	for (let i = 0; i < pos.count; i++) { const y = pos.getY(i); const c = path.getPointAt(clamp(y / H, 0, 1)); const k = 1.25 - (y / H) * 0.45; pos.setX(i, c.x + (pos.getX(i) - c.x) * k); pos.setZ(i, pos.getZ(i) * k); }
	trunk.computeVertexNormals();
	const top = path.getPointAt(1);
	const fronds = [];
	for (let k = 0; k < 13; k++) {
		const g = new THREE.PlaneGeometry(1.9, 5.2, 1, 8); g.translate(0, 2.6, 0);
		const p = g.attributes.position;
		const droop = rr(0.55, 1.0);
		for (let i = 0; i < p.count; i++) { const y = p.getY(i); const ang = (y / 5.2) * (1.2 + droop); p.setY(i, Math.sin(ang) * 5.2 / (1.2 + droop) * 1.0); p.setZ(i, -(1 - Math.cos(ang)) * 2.4); p.setX(i, p.getX(i) * (1 - Math.abs(y / 5.2 - 0.5) * 0.5)); }
		g.rotateX(-Math.PI / 2 + rr(0.25, 0.7)); g.rotateY((k / 13) * Math.PI * 2 + rr(-0.15, 0.15));
		g.translate(top.x, top.y, top.z); g.computeVertexNormals(); fronds.push(g);
	}
	return { trunk, fronds: mergeGeometries(fronds) };
}
function buildPalms() {
	const { trunk, fronds } = palmGeometry();
	const bark = canvasTex(64, 256, (g, w, h) => { g.fillStyle = "#7b5a43"; g.fillRect(0, 0, w, h); for (let y = 0; y < h; y += 10) { g.fillStyle = "rgba(40,25,20,.45)"; g.fillRect(0, y, w, 3); } });
	bark.repeat.set(2, 8);
	const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ map: bark, roughness: 0.95 }), palmSpots.length);
	const lm = new THREE.InstancedMesh(fronds, new THREE.MeshStandardMaterial({ map: frondTex, alphaTest: 0.35, side: THREE.DoubleSide, roughness: 0.75, color: 0xd8f0b0 }), palmSpots.length);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
	palmSpots.forEach(([x, z, s, r], i) => { e.set(0, r, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(x, 0.3, z), q, new THREE.Vector3(s, s, s)); tm.setMatrixAt(i, m); lm.setMatrixAt(i, m); });
	tm.castShadow = lm.castShadow = true; tm.receiveShadow = true;
	world.add(tm, lm);
}

// street lamps
const lampSpots = [];
function buildLamps() {
	const pole = new THREE.CylinderGeometry(0.09, 0.13, 7, 8); pole.translate(0, 3.5, 0);
	const arm = new THREE.CylinderGeometry(0.05, 0.05, 1.8, 6); arm.rotateZ(Math.PI / 2); arm.translate(0.85, 6.95, 0);
	const bulb = new THREE.BoxGeometry(0.75, 0.16, 0.36); bulb.translate(1.65, 6.85, 0);
	const pm = new THREE.InstancedMesh(mergeGeometries([pole, arm]), new THREE.MeshStandardMaterial({ color: 0x2a2633, roughness: 0.4, metalness: 0.6 }), lampSpots.length);
	const bm = new THREE.InstancedMesh(bulb, neonMats.warm, lampSpots.length);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
	lampSpots.forEach(([x, z, r], i) => { q.setFromAxisAngle(up, r); m.compose(new THREE.Vector3(x, 0.3, z), q, one); pm.setMatrixAt(i, m); bm.setMatrixAt(i, m); });
	pm.castShadow = true; world.add(pm, bm);
}

// neon text signs
const NEON = [["MOTEL", "#ff3fa4"], ["OPEN 24/7", "#33f0ff"], ["PALMS", "#7dff8a"], ["NEON BAY", "#ff3fa4"], ["DINER", "#ffd23f"], ["CLUB 88", "#b46bff"], ["TACOS", "#ff8a3d"], ["HOTEL", "#33f0ff"], ["ARCADE", "#ff3fa4"], ["SURF SHOP", "#33f0ff"], ["SUNSET", "#ff8a3d"], ["CASINO", "#ffd23f"]];
function neonSign(text, color, scale = 1) {
	const tex = canvasTex(1024, 256, (g, w, h) => {
		g.clearRect(0, 0, w, h); g.font = "italic 900 150px 'Brush Script MT', 'Arial Black', Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
		g.shadowColor = color; g.shadowBlur = 40; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 6);
		g.shadowBlur = 0; g.fillStyle = "#fff"; g.globalAlpha = 0.9; g.fillText(text, w / 2, h / 2 + 6);
	}, { repeat: false });
	const w = (3 + text.length * 1.3) * scale;
	return new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, depthWrite: false, color: new THREE.Color(1.6, 1.6, 1.6) }));
}

// buildings ------------------------------------------------------
function signOn(mesh, w, d, h, y) {
	const [txt, col] = pick(NEON); const s = neonSign(txt, col, rr(0.8, 1.3));
	const face = Math.floor(rand() * 4), cx = mesh.position.x, cz = mesh.position.z;
	if (face === 0) s.position.set(cx, y, cz + d / 2 + 0.08);
	if (face === 1) { s.position.set(cx, y, cz - d / 2 - 0.08); s.rotation.y = Math.PI; }
	if (face === 2) { s.position.set(cx + w / 2 + 0.08, y, cz); s.rotation.y = Math.PI / 2; }
	if (face === 3) { s.position.set(cx - w / 2 - 0.08, y, cz); s.rotation.y = -Math.PI / 2; }
	world.add(s);
}
function shopBand(x, z, w, d) { boxInst(shopMat, x, 2.1, z, w + 0.3, 3.2, d + 0.3); }
function glassTower(x0, z0, w, d, h) {
	const mat = texMat(pick(GLASS_FACADES), Math.max(1, Math.round(w / 9)), Math.max(1, Math.round(h / 9)), { metalness: 0.75, roughness: 0.12, envMapIntensity: 1.6 });
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
	mesh.position.set(x0 + w / 2, h / 2 + 0.3, z0 + d / 2); mesh.castShadow = mesh.receiveShadow = true; world.add(mesh);
	shopBand(mesh.position.x, mesh.position.z, w, d);
	// setback crown
	if (h > 40) {
		const cw = w * 0.7, cd = d * 0.7, ch = rr(6, 14);
		const crown = new THREE.Mesh(new THREE.BoxGeometry(cw, ch, cd), [mat, mat, roofMat, roofMat, mat, mat]);
		crown.position.set(mesh.position.x, h + 0.3 + ch / 2, mesh.position.z); crown.castShadow = true; world.add(crown);
		boxInst(rand() < 0.5 ? neonMats.cyan : neonMats.pink, mesh.position.x, h + 0.35, mesh.position.z + d / 2, w, 0.25, 0.25);
		if (rand() < 0.6) boxInst(roofMat, mesh.position.x, h + ch + 4, mesh.position.z, 0.3, 8, 0.3);
	}
	if (rand() < 0.4) signOn(mesh, w, d, h, rr(8, Math.min(18, h - 3)));
	colliders.push({ x0: x0 - 0.3, x1: x0 + w + 0.3, z0: z0 - 0.3, z1: z0 + d + 0.3 });
}
function decoHotel(x0, z0, w, d, floors) {
	const fh = 3.4, h = floors * fh + 1.5, ci = Math.floor(rand() * PASTELS.length);
	const mat = texMat(pastelFacades[ci], Math.max(1, Math.round(w / 6)), floors, { roughness: 0.55, envMapIntensity: 0.8 });
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
	const cx = x0 + w / 2, cz = z0 + d / 2;
	mesh.position.set(cx, h / 2 + 0.3, cz); mesh.castShadow = mesh.receiveShadow = true; world.add(mesh);
	shopBand(cx, cz, w, d);
	for (let f = 1; f <= floors; f++) boxInst(whiteMat, cx, f * fh + 0.3, cz, w + 1.2, 0.28, d + 1.2); // eyebrow ledges
	boxInst(whiteMat, cx, h + 1.4, cz, w * 0.45, 2.6, d * 0.45); // deco cap
	const neon = pick([neonMats.pink, neonMats.cyan, neonMats.violet]);
	for (const [sx, sz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) boxInst(neon, cx + sx * (w / 2 + 0.12), h / 2 + 2, cz + sz * (d / 2 + 0.12), 0.22, h - 3, 0.22);
	boxInst(neon, cx, h + 0.35, cz + d / 2 + 0.15, w, 0.22, 0.22); boxInst(neon, cx, h + 0.35, cz - d / 2 - 0.15, w, 0.22, 0.22);
	boxInst(neon, cx + w / 2 + 0.15, h + 0.35, cz, 0.22, 0.22, d); boxInst(neon, cx - w / 2 - 0.15, h + 0.35, cz, 0.22, 0.22, d);
	boxInst(pick([neonMats.cyan, neonMats.pink]), cx, 0.3 + fh * 1.2, cz + d / 2 + 0.7, w * 0.9, 0.18, 0.18);
	if (rand() < 0.75) { const s = neonSign(pick(["HOTEL", "MOTEL", "PALMS", "SUNSET", "NEON BAY", "OCEAN", "FLAMINGO"]), pick(["#ff3fa4", "#33f0ff", "#ffd23f"]), 1.3); s.position.set(cx, h + 3.6, cz + d * 0.23); world.add(s); }
	colliders.push({ x0: x0 - 0.4, x1: x0 + w + 0.4, z0: z0 - 0.4, z1: z0 + d + 0.4 });
}

// ================================================================ assets
const draco = new DRACOLoader(); draco.setDecoderPath("vendor/three/examples/jsm/libs/draco/gltf/");
const loader = new GLTFLoader(); loader.setDRACOLoader(draco);
const ASSETS = {};
async function loadAssets(progress) {
	const pmrem = new THREE.PMREMGenerator(renderer);
	const jobs = [
		loader.loadAsync("assets/models/ferrari.glb").then((g) => (ASSETS.car = g)),
		loader.loadAsync("assets/models/Soldier.glb").then((g) => (ASSETS.anims = g)),
		loader.loadAsync("assets/models/hero.glb").then((g) => (ASSETS.hero = g)),
		new THREE.TextureLoader().loadAsync("assets/models/ferrari_ao.png").then((t) => (ASSETS.ao = t)),
		new RGBELoader().loadAsync("assets/env/venice_sunset_1k.hdr").then((hdr) => { hdr.mapping = THREE.EquirectangularReflectionMapping; scene.environment = pmrem.fromEquirectangular(hdr).texture; scene.environmentIntensity = 0.75; hdr.dispose(); }),
	];
	let done = 0; jobs.forEach((j) => j.then(() => progress(++done / jobs.length)));
	await Promise.all(jobs);
}

function buildCity() {
	const c = (N - 1) / 2;
	const walkMat = new THREE.MeshStandardMaterial({ map: tileTex, roughness: 0.55, envMapIntensity: 0.8 });
	const curbMat = new THREE.MeshStandardMaterial({ color: 0xe9e1e4, roughness: 0.6 });
	const lawnMat = new THREE.MeshStandardMaterial({ color: 0x5f9a4a, roughness: 1 });
	for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
		const x0 = nodePos(i) + ROAD / 2, z0 = nodePos(j) + ROAD / 2, x1 = x0 + BLOCK, z1 = z0 + BLOCK;
		const d = Math.max(Math.abs(i - c), Math.abs(j - c));
		let kind = i === 0 ? "beachfront" : d <= 1.5 ? "downtown" : d <= 2.5 ? "mid" : "low";
		if (kind !== "downtown" && kind !== "beachfront" && rand() < 0.12) kind = "park";
		blocks.push({ i, j, x0, x1, z0, z1, kind });
		const cx = x0 + BLOCK / 2, cz = z0 + BLOCK / 2;
		const walk = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.3, BLOCK), walkMat); walk.position.set(cx, 0.15, cz); walk.receiveShadow = true; world.add(walk);
		boxInst(curbMat, cx, 0.16, z0 + 0.15, BLOCK, 0.32, 0.3); boxInst(curbMat, cx, 0.16, z1 - 0.15, BLOCK, 0.32, 0.3);
		boxInst(curbMat, x0 + 0.15, 0.16, cz, 0.3, 0.32, BLOCK); boxInst(curbMat, x1 - 0.15, 0.16, cz, 0.3, 0.32, BLOCK);
		const m = 4.2, iw = BLOCK - m * 2, ix0 = x0 + m, iz0 = z0 + m;
		if (kind === "downtown") {
			const split = rand() < 0.7;
			const cells = split ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]], cw = split ? iw / 2 : iw;
			for (const [a, b] of cells) {
				if (split && rand() < 0.12) continue;
				const g = 1.2, w = cw - g * 2 - rr(0, 2.5), dd = cw - g * 2 - rr(0, 2.5);
				glassTower(ix0 + a * cw + g, iz0 + b * cw + g, w, dd, rr(40, 120) * (1 - d * 0.16));
			}
		} else if (kind === "mid" || kind === "beachfront") {
			const cells = [[0, 0], [1, 0], [0, 1], [1, 1]], cw = iw / 2;
			for (const [a, b] of cells) {
				const g = 1.3; const w = cw - g * 2, dd = cw - g * 2;
				if (kind === "mid" && rand() < 0.35) glassTower(ix0 + a * cw + g, iz0 + b * cw + g, w, dd, rr(22, 45));
				else decoHotel(ix0 + a * cw + g, iz0 + b * cw + g, w, dd, kind === "beachfront" ? Math.floor(rr(5, 10)) : Math.floor(rr(3, 7)));
			}
		} else if (kind === "low") {
			const cells = [[0, 0], [1, 0], [0, 1], [1, 1]], cw = iw / 2;
			for (const [a, b] of cells) { if (rand() < 0.2) continue; const g = 1.6; decoHotel(ix0 + a * cw + g, iz0 + b * cw + g, cw - g * 2, cw - g * 2, Math.floor(rr(2, 4))); }
			for (let k = 0; k < 3; k++) palmSpots.push([rr(ix0, ix0 + iw), rr(iz0, iz0 + iw), rr(0.8, 1.1), rr(0, 6)]);
		} else {
			const lawn = new THREE.Mesh(new THREE.PlaneGeometry(iw + 4, iw + 4), lawnMat); lawn.rotation.x = -Math.PI / 2; lawn.position.set(cx, 0.31, cz); lawn.receiveShadow = true; world.add(lawn);
			for (let k = 0; k < 12; k++) palmSpots.push([rr(ix0, ix0 + iw), rr(iz0, iz0 + iw), rr(0.8, 1.25), rr(0, 6)]);
			boxInst(whiteMat, cx, 0.8, cz, 8, 1, 8); boxInst(neonMats.cyan, cx, 1.35, cz, 8.2, 0.15, 8.2);
			colliders.push({ x0: cx - 4.2, x1: cx + 4.2, z0: cz - 4.2, z1: cz + 4.2 });
		}
		// boulevard palms + lamps along every sidewalk
		for (let t = 5; t < BLOCK - 3; t += 12) {
			palmSpots.push([x0 + t, z0 + 1.6, rr(0.9, 1.2), rr(0, 6)], [x0 + t, z1 - 1.6, rr(0.9, 1.2), rr(0, 6)], [x0 + 1.6, z0 + t, rr(0.9, 1.2), rr(0, 6)], [x1 - 1.6, z0 + t, rr(0.9, 1.2), rr(0, 6)]);
		}
		for (let t = 11; t < BLOCK - 3; t += 24) lampSpots.push([x0 + t, z0 + 0.8, Math.PI / 2], [x0 + t, z1 - 0.8, -Math.PI / 2], [x0 + 0.8, z0 + t, 0], [x1 - 0.8, z0 + t, Math.PI]);
	}
	// beach: palms, lifeguard towers
	for (let z = -40; z < CITY + 60; z += rr(10, 17)) palmSpots.push([rr(BEACH_X - 22, BEACH_X - 4), z, rr(1.1, 1.5), rr(0, 6)]);
	const lgMat = new THREE.MeshStandardMaterial({ color: 0x8fd6e8, roughness: 0.6 }), legMat = new THREE.MeshStandardMaterial({ color: 0xf2efe8 });
	for (let z = 40; z < CITY; z += 110) {
		const x = BEACH_X - 38;
		boxInst(lgMat, x, 3.6, z, 3.2, 2.2, 3.2); boxInst(neonMats.pink, x, 4.8, z, 3.6, 0.2, 3.6);
		for (const [a, b] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) boxInst(legMat, x + a * 1.3, 1.25, z + b * 1.3, 0.22, 2.5, 0.22);
		boxInst(legMat, x + 2.4, 1.3, z, 2.4, 0.15, 1.2, 0);
	}
	buildPalms(); buildLamps(); flushBoxes();
}

// ================================================================ cars
const cars = [];
const PAINT = [0xb3121f, 0xf4f1ec, 0x111114, 0x8fc8ea, 0xf2c230, 0x0f8a8a, 0xa8adb5, 0xe85d9a, 0x3a2f7a];
let carProto = null;
function prepareCar() {
	const src = ASSETS.car.scene;
	src.updateMatrixWorld(true);
	const details = new THREE.MeshStandardMaterial({ color: 0xd0d0d0, metalness: 1, roughness: 0.35 });
	const glass = new THREE.MeshPhysicalMaterial({ color: 0x0b0b10, metalness: 0.2, roughness: 0.05, transparent: true, opacity: 0.72, envMapIntensity: 1.5 });
	const tail = new THREE.MeshStandardMaterial({ color: 0x400000, emissive: 0xff1020, emissiveIntensity: 2.4 });
	const head = new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfff1d0, emissiveIntensity: 1.8 });
	const body = new THREE.MeshPhysicalMaterial({ color: 0xb3121f, metalness: 0.9, roughness: 0.32, clearcoat: 1, clearcoatRoughness: 0.03, envMapIntensity: 1.3 });
	const matFor = (o) => {
		const n = (o.name + " " + (o.material?.name || "")).toLowerCase();
		if (n.includes("body_color") || o.name === "body") return body;
		if (n.includes("glass") && n.includes("tail")) return tail;
		if (n.includes("lights_red")) return tail;
		if (n.includes("projector") || o.name === "lights") return head;
		if (n.includes("glass")) return glass;
		if (n.includes("rim") || n.includes("trim") || n.includes("chrome")) return details;
		return o.material;
	};
	// group meshes: static body parts merged by material, wheels separate
	const wheelNames = ["wheel_fl", "wheel_fr", "wheel_rl", "wheel_rr"];
	const inWheel = (o) => { let p = o; while (p) { if (wheelNames.includes(p.name)) return p.name; p = p.parent; } return null; };
	const buckets = {}; const wheelBuckets = {};
	src.traverse((o) => {
		if (!o.isMesh) return;
		const mat = matFor(o); const w = inWheel(o);
		let g = o.geometry.clone(); g.applyMatrix4(o.matrixWorld);
		g = g.index ? g.toNonIndexed() : g;
		for (const k of Object.keys(g.attributes)) if (!["position", "normal", "uv"].includes(k)) g.deleteAttribute(k);
		if (!g.attributes.uv) g.setAttribute("uv", new THREE.BufferAttribute(new Float32Array(g.attributes.position.count * 2), 2));
		if (!g.attributes.normal) g.computeVertexNormals();
		const target = w ? (wheelBuckets[w] ||= {}) : buckets;
		(target[mat.uuid] ||= { mat, geos: [] }).geos.push(g);
	});
	const root = new THREE.Group();
	const box = new THREE.Box3().setFromObject(src); const size = box.getSize(new THREE.Vector3()), center = box.getCenter(new THREE.Vector3());
	const offset = new THREE.Vector3(-center.x, -box.min.y, -center.z);
	const bodyGroup = new THREE.Group(); root.add(bodyGroup);
	for (const { mat, geos } of Object.values(buckets)) { const g = mergeGeometries(geos); g.translate(offset.x, offset.y, offset.z); const m = new THREE.Mesh(g, mat); m.castShadow = true; m.userData.isBody = mat === body; bodyGroup.add(m); }
	const wheels = {};
	for (const name of wheelNames) {
		const wg = new THREE.Group(); const wsrc = src.getObjectByName(name); const wp = new THREE.Vector3(); wsrc.getWorldPosition(wp); wp.add(offset);
		const spin = new THREE.Group(); spin.rotation.order = "YXZ"; wg.add(spin);
		for (const { mat, geos } of Object.values(wheelBuckets[name] || {})) { const g = mergeGeometries(geos); g.translate(offset.x - wp.x, offset.y - wp.y, offset.z - wp.z); const m = new THREE.Mesh(g, mat); m.castShadow = true; spin.add(m); }
		wg.position.copy(wp); root.add(wg); wheels[name] = spin;
	}
	// face +z
	const front = wheels.wheel_fl.parent.position.z + wheels.wheel_fr.parent.position.z, back = wheels.wheel_rl.parent.position.z + wheels.wheel_rr.parent.position.z;
	const holder = new THREE.Group(); holder.add(root);
	if (front < back) root.rotation.y = Math.PI;
	const s = 4.7 / Math.max(size.x, size.z); root.scale.setScalar(s);
	// contact shadow
	const ao = new THREE.Mesh(new THREE.PlaneGeometry(0.655 * 4 * s / 1, 1.3 * 4 * s), new THREE.MeshBasicMaterial({ map: ASSETS.ao, blending: THREE.MultiplyBlending, toneMapped: false, transparent: true, premultipliedAlpha: true }));
	ao.rotation.x = -Math.PI / 2; ao.position.y = 0.02; ao.renderOrder = 2; holder.add(ao);
	carProto = { holder, bodyMat: body };
}
class Car {
	constructor(opts = {}) {
		this.police = !!opts.police;
		this.root = carProto.holder.clone(true); scene.add(this.root);
		const paint = carProto.bodyMat.clone(); paint.color.setHex(opts.color ?? (this.police ? 0xf2f2f2 : pick(PAINT)));
		this.root.traverse((o) => { if (o.isMesh && o.material === carProto.bodyMat) o.material = paint; });
		this.paint = paint;
		this.wheels = []; this.front = [];
		this.root.traverse((o) => { if (o.isGroup && o.rotation.order === "YXZ") { this.wheels.push(o); } });
		// the two front wheels are the ones with larger local z after facing fix
		this.root.updateMatrixWorld(true);
		const wz = this.wheels.map((w) => { const p = new THREE.Vector3(); w.getWorldPosition(p); return p.z - this.root.position.z; });
		const maxz = Math.max(...wz); this.front = this.wheels.filter((w, i) => wz[i] > maxz - 0.5);
		this.x = 0; this.z = 0; this.h = 0; this.vx = 0; this.vz = 0; this.steer = 0; this.fs = 0; this.ls = 0;
		this.radius = 2.2; this.max = 16; this.driver = opts.driver ?? true;
		this.ai = null; this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 }; this.roll = 0; this.pitch = 0; this.spin = 0;
		if (this.police) this.addPolice();
		cars.push(this);
	}
	addPolice() {
		const bar = new THREE.Group();
		this.red = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(4, 0.2, 0.3), toneMapped: false }));
		this.blue = new THREE.Mesh(new THREE.BoxGeometry(0.62, 0.16, 0.3), new THREE.MeshBasicMaterial({ color: new THREE.Color(0.2, 0.6, 5), toneMapped: false }));
		this.red.position.x = -0.34; this.blue.position.x = 0.34; bar.add(this.red, this.blue);
		const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 0.08, 0.36), new THREE.MeshStandardMaterial({ color: 0x111111 })); base.position.y = -0.1; bar.add(base);
		bar.position.set(0, 1.32, -0.2); this.root.add(bar);
		for (const side of [-1, 1]) {
			const s = neonSign("POLICE", "#2a5cff", 0.22); s.material = s.material.clone(); s.material.color = new THREE.Color(1, 1, 1);
			s.position.set(side * 1.02, 0.72, 0); s.rotation.y = side * Math.PI / 2; this.root.add(s);
		}
		this.paint.color.setHex(0xf4f4f4);
	}
	get speed() { return Math.hypot(this.vx, this.vz); }
	place(x, z, h) { this.x = x; this.z = z; this.h = h; this.vx = this.vz = 0; this.sync(0); }
	physics(dt) {
		const { throttle, brake, steer, handbrake } = this.input;
		const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
		let fs = this.vx * fx + this.vz * fz, ls = this.vx * rx + this.vz * rz;
		const acc = this.police ? 18 : 16;
		if (throttle > 0) fs += throttle * acc * dt * (1 - clamp(fs / this.max, 0, 1) * 0.85);
		if (brake > 0) { if (fs > 0.5) fs -= brake * 34 * dt; else fs = Math.max(fs - brake * 9 * dt, -10); }
		if (throttle === 0 && brake === 0) fs -= Math.sign(fs) * Math.min(Math.abs(fs), (2 + Math.abs(fs) * 0.22) * dt);
		fs = clamp(fs, -10, this.max);
		const grip = handbrake ? 1.2 : 8.5;
		ls *= Math.exp(-grip * dt);
		if (handbrake) fs *= 1 - 0.5 * dt;
		this.steer = lerp(this.steer, steer, 1 - Math.exp(-10 * dt));
		const yaw = (fs / 2.7) * Math.tan(this.steer * 0.52) * (handbrake ? 1.6 : 1);
		this.h = wrapAngle(this.h + yaw * dt);
		const nfx = Math.sin(this.h), nfz = Math.cos(this.h);
		this.vx = nfx * fs - nfz * ls; this.vz = nfz * fs + nfx * ls;
		this.accel = (fs - this.fs) / Math.max(dt, 1e-3);
		this.fs = fs; this.ls = ls;
		this.x += this.vx * dt; this.z += this.vz * dt;
	}
	sync(dt) {
		this.root.position.set(this.x, 0.02, this.z);
		this.root.rotation.y = this.h;
		this.roll = lerp(this.roll, clamp(this.ls * 0.02 + this.steer * this.fs * -0.0035, -0.08, 0.08), 1 - Math.exp(-6 * dt));
		this.pitch = lerp(this.pitch, clamp((this.accel || 0) * -0.0025, -0.04, 0.04), 1 - Math.exp(-5 * dt));
		this.root.rotation.z = this.roll; this.root.rotation.x = this.pitch;
		this.spin += this.fs * dt / 0.34;
		for (const w of this.wheels) w.rotation.x = this.spin;
		for (const w of this.front) w.rotation.y = this.steer * 0.5;
		if (this.police) { const on = Math.floor(clock * 7) % 2 === 0; this.red.visible = on; this.blue.visible = !on; }
	}
}

// ================================================================ road graph AI
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
const rightOf = (dx, dz) => [-dz, dx];
function aiStart(car, i, j, d) {
	const [dx, dz] = DIRS[d]; const ni = i + dx, nj = j + dz; const [rx, rz] = rightOf(dx, dz);
	car.ai = { i, j, ni, nj, dx, dz, wps: [[nodePos(ni) + rx * LANE - dx * 10, nodePos(nj) + rz * LANE - dz * 10, "entry"]], base: rr(10, 14) };
	const t = rr(0.25, 0.75);
	car.place(lerp(nodePos(i), nodePos(ni), t) + rx * LANE, lerp(nodePos(j), nodePos(nj), t) + rz * LANE, Math.atan2(dx, dz));
}
function aiPlan(car) {
	const a = car.ai; const opts = [];
	for (let k = 0; k < 4; k++) { const [dx, dz] = DIRS[k]; if (dx === -a.dx && dz === -a.dz) continue; const ti = a.ni + dx, tj = a.nj + dz; if (ti < 0 || tj < 0 || ti > N || tj > N) continue; opts.push(k); }
	let k = opts.find((o) => DIRS[o][0] === a.dx && DIRS[o][1] === a.dz);
	if (k === undefined || rand() < 0.45) k = pick(opts);
	const [dx, dz] = DIRS[k]; const [rx, rz] = rightOf(dx, dz);
	const nx = nodePos(a.ni), nz = nodePos(a.nj);
	a.i = a.ni; a.j = a.nj; a.ni = a.i + dx; a.nj = a.j + dz; a.dx = dx; a.dz = dz;
	a.wps.push([nx + rx * LANE + dx * 9, nz + rz * LANE + dz * 9, "exit"]);
	a.wps.push([nodePos(a.ni) + rx * LANE - dx * 10, nodePos(a.nj) + rz * LANE - dz * 10, "entry"]);
}
function steerTo(car, tx, tz) { const want = Math.atan2(tx - car.x, tz - car.z); const diff = wrapAngle(want - car.h); return { steer: clamp(diff * 2.4, -1, 1), diff }; }
function aiDrive(car, dt, fast = false) {
	const a = car.ai;
	if (!a.wps.length) aiPlan(car);
	const [tx, tz] = a.wps[0];
	if (Math.hypot(tx - car.x, tz - car.z) < (fast ? 5.5 : 4)) { const w = a.wps.shift(); if (w[2] === "entry" && !a.wps.length) aiPlan(car); }
	const t = a.wps[0] || [tx, tz];
	const { steer, diff } = steerTo(car, t[0], t[1]);
	let target = fast ? 32 : a.base;
	if (Math.abs(diff) > 0.35) target *= fast ? 0.6 : 0.55;
	if (!fast) {
		const fx = Math.sin(car.h), fz = Math.cos(car.h);
		const others = player.car ? cars : [...cars, player];
		for (const o of others) {
			if (o === car) continue;
			const ox = o.x - car.x, oz = o.z - car.z; const ahead = ox * fx + oz * fz, side = Math.abs(ox * -fz + oz * fx);
			if (ahead > 0 && ahead < 12 && side < 2.6) target = Math.min(target, Math.max(0, (ahead - 5.5) * 1.3));
		}
	}
	car.input.steer = steer; car.input.throttle = car.fs < target ? 1 : 0; car.input.brake = car.fs > target + 1.5 ? 1 : 0;
	car.input.handbrake = fast && Math.abs(diff) > 0.55 && car.fs > 17 ? 1 : 0;
}

// ================================================================ people
const peds = [];
let player;
const TOPS = [0xffffff, 0x9fd3ff, 0xffb3c8, 0xfff1a8, 0xb8ffcf, 0xd6b8ff, 0xff9e7a, 0x8fe3e0, 0xff6b6b];
const BOTTOMS = [0xffffff, 0x6b7a99, 0xd8cbb8, 0x3a3a48, 0x9ab0c8];
let HERO_CLIPS = null;
function prepareHumans() {
	const rt = makeRetargeter(ASSETS.anims.scene, ASSETS.anims.animations, SkeletonUtils.clone(ASSETS.hero.scene));
	const src = (n) => ASSETS.anims.animations.find((a) => a.name === n);
	HERO_CLIPS = { Idle: makeIdleClip(ASSETS.hero.scene), Walk: rt(src("Walk")), Run: rt(src("Run")) };
}
function makeHuman(outfit) {
	const m = SkeletonUtils.clone(ASSETS.hero.scene);
	m.traverse((o) => {
		if (!o.isMesh) return; o.castShadow = true; o.frustumCulled = false;
		if (outfit) {
			const n = o.material.name;
			if (n === "Wolf3D_Outfit_Top") { o.material = o.material.clone(); o.material.color = new THREE.Color(outfit.top); }
			if (n === "Wolf3D_Outfit_Bottom") { o.material = o.material.clone(); o.material.color = new THREE.Color(outfit.bottom); }
			if (n === "Wolf3D_Headwear" && !outfit.hat) o.visible = false;
		}
	});
	const holder = new THREE.Group(); holder.add(m);
	const mixer = new THREE.AnimationMixer(m);
	const idle = mixer.clipAction(HERO_CLIPS.Idle), walk = mixer.clipAction(HERO_CLIPS.Walk), run = mixer.clipAction(HERO_CLIPS.Run);
	for (const a of [idle, walk, run]) { a.play(); a.setEffectiveWeight(0); }
	idle.setEffectiveWeight(1);
	scene.add(holder);
	return { root: holder, mixer, idle, walk, run, w: { idle: 1, walk: 0, run: 0 } };
}
function setGait(p, gait, dt, speed = 1) {
	for (const k of ["idle", "walk", "run"]) { p.w[k] = lerp(p.w[k], k === gait ? 1 : 0, 1 - Math.exp(-10 * dt)); p[k].setEffectiveWeight(p.w[k]); }
	p.walk.timeScale = speed; p.run.timeScale = speed;
}
function spawnPed(p) {
	const b = pick(blocks); p.block = b; p.s = rr(0, 4); p.dir = rand() < 0.5 ? 1 : -1; p.speed = rr(1.2, 1.7); p.state = "walk"; p.t = 0;
	p.root.visible = true; p.root.rotation.set(0, 0, 0);
}
function pedPos(p) {
	const b = p.block, m = 2.6; const x0 = b.x0 + m, x1 = b.x1 - m, z0 = b.z0 + m, z1 = b.z1 - m;
	const s = ((p.s % 4) + 4) % 4, f = s % 1;
	if (s < 1) return [lerp(x0, x1, f), z0, Math.PI / 2];
	if (s < 2) return [x1, lerp(z0, z1, f), 0];
	if (s < 3) return [lerp(x1, x0, f), z1, -Math.PI / 2];
	return [x0, lerp(z1, z0, f), Math.PI];
}
function updatePeds(dt) {
	for (const p of peds) {
		const far = Math.hypot(p.x - player.x, p.z - player.z) > 140;
		if (p.state === "walk") {
			p.s += (p.dir * p.speed * dt) / BLOCK;
			const [x, z, r] = pedPos(p); p.x = x; p.z = z;
			p.root.position.set(x, 0.3, z); p.root.rotation.y = r + (p.dir < 0 ? Math.PI : 0);
			setGait(p, "walk", dt, p.speed / 1.5);
		} else if (p.state === "run") {
			p.t += dt; p.x += p.vx * dt; p.z += p.vz * dt; p.root.position.set(p.x, 0.3, p.z); p.root.rotation.y = Math.atan2(p.vx, p.vz);
			setGait(p, "run", dt, 1.1); if (p.t > 5) spawnPed(p);
		} else if (p.state === "fly") {
			p.t += dt; p.vy -= 22 * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
			p.root.rotation.x += p.spin * dt; p.root.rotation.z += p.spin * 0.6 * dt;
			if (p.y <= 0.3 && p.vy < 0) { p.y = 0.3; p.state = "down"; p.t = 0; p.root.rotation.set(-Math.PI / 2, p.root.rotation.y, 0); }
			p.root.position.set(p.x, p.y + 0.3, p.z);
		} else if (p.state === "down") { p.t += dt; if (p.t > 10) spawnPed(p); }
		if (!far || p.state !== "walk") p.mixer.update(dt);
	}
}

// ================================================================ input
const keys = {};
let pressE = false, camFar = false, mouseYaw = 0, mousePitch = 0.12, mouseIdle = 99;
addEventListener("keydown", (e) => { keys[e.code] = true; if (e.code === "KeyE" || e.code === "KeyF") pressE = true; if (e.code === "KeyC") camFar = !camFar; if (e.code === "KeyR" && sfx) showMsg(sfx.toggleMusic() ? "RADIO ON" : "RADIO OFF", "#33f0ff", 1); if (e.code === "KeyM" && sfx) showMsg(sfx.toggleMute() ? "SOUND ON" : "MUTED", "#fff", 1); if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault(); });
addEventListener("keyup", (e) => { keys[e.code] = false; });
canvas.addEventListener("click", () => { if (started && document.pointerLockElement !== canvas) canvas.requestPointerLock?.(); });
addEventListener("mousemove", (e) => { if (document.pointerLockElement !== canvas) return; mouseYaw -= e.movementX * 0.0028; mousePitch = clamp(mousePitch + e.movementY * 0.002, -0.15, 0.9); mouseIdle = 0; });
function readInput() {
	return { up: keys.KeyW || keys.ArrowUp ? 1 : 0, down: keys.KeyS || keys.ArrowDown ? 1 : 0, left: keys.KeyA || keys.ArrowLeft ? 1 : 0, right: keys.KeyD || keys.ArrowRight ? 1 : 0, hand: keys.Space ? 1 : 0, sprint: keys.ShiftLeft || keys.ShiftRight ? 1 : 0 };
}

// ================================================================ game state
let clock = 0, wanted = 0, wantedCool = 0, money = 0, shake = 0, msgT = 0, bustedT = 0;
let driftCash = 0, distDriven = 0, peakWanted = 0, lostFrom3 = false, stoleCop = false, fiveStarT = 0, missionI = 0, missionDirty = true, missionT = 0;
const MISSIONS = [
	{ title: "Steal a car", hint: "Walk up to any car and press E", check: () => !!player.car, reward: 100 },
	{ title: "Hit 120 km/h", hint: "Floor it on a long straight", check: () => player.car && player.car.speed * 3.6 >= 120, reward: 250 },
	{ title: "Drift for $500", hint: "Hold Space while turning at speed", prog: () => `$${Math.min(500, Math.floor(driftCash))} / $500`, check: () => driftCash >= 500, reward: 500 },
	{ title: "Drive 3 km around Neon Bay", hint: "Cruise the beach boulevard", prog: () => `${(distDriven / 1000).toFixed(1)} / 3 km`, check: () => distDriven >= 3000, reward: 750 },
	{ title: "Get a 3-star wanted level", hint: "Ram traffic, cops or steal cars", check: () => wanted >= 3, reward: 1000 },
	{ title: "Lose the cops after 3 stars", hint: "Get 60 m away and stay out of sight", check: () => lostFrom3, reward: 2000 },
	{ title: "Steal a police car", hint: "Get out next to a cop car and press E", check: () => stoleCop, reward: 2500 },
	{ title: "Survive 5 stars for 30 seconds", hint: "Keep moving. Don't get boxed in", prog: () => `${Math.floor(fiveStarT)} / 30 s`, check: () => fiveStarT >= 30, reward: 5000 },
];
function updateMissions(dt) {
	if (wanted >= 5) fiveStarT += dt;
	peakWanted = Math.max(peakWanted, wanted);
	const m = MISSIONS[missionI];
	if (m && m.check()) {
		money += m.reward; missionI++; missionDirty = true; sfx?.sting("lost");
		showMsg(missionI === MISSIONS.length ? "ALL MISSIONS PASSED" : "MISSION PASSED", "#ffd23f", 2.4);
		hud.reward.textContent = `+$${m.reward.toLocaleString("en-US")}`; hud.reward.classList.add("show"); setTimeout(() => hud.reward.classList.remove("show"), 2400);
	}
	missionT -= dt;
	if (missionDirty || (missionT <= 0 && MISSIONS[missionI]?.prog)) { missionT = 0.25; missionDirty = false; renderMissions(); }
}
function renderMissions() {
	const done = missionI;
	hud.mission.innerHTML = `<div class="mh">MISSIONS <span>${done}/${MISSIONS.length}</span></div>` + MISSIONS.map((m, i) => {
		const cls = i < done ? "done" : i === done ? "cur" : "lock";
		const extra = i === done ? `<small>${m.prog ? m.prog() + " · " : ""}${m.hint}</small>` : "";
		return `<div class="mi ${cls}"><b>${i < done ? "✓" : i === done ? "▸" : i + 1}</b><div>${m.title} <em>$${m.reward.toLocaleString("en-US")}</em>${extra}</div></div>`;
	}).join("");
}
const hud = {
	stars: document.getElementById("stars"), money: document.getElementById("money"), speed: document.getElementById("speed"),
	msg: document.getElementById("msg"), tip: document.getElementById("tip"), mission: document.getElementById("mission"), mini: document.getElementById("mini"), reward: document.getElementById("reward"),
};
function showMsg(text, color = "#fff", secs = 2) { hud.msg.textContent = text; hud.msg.style.color = color; hud.msg.classList.add("show"); msgT = secs; }
function addWanted(n) { const before = Math.floor(wanted); wanted = clamp(wanted + n, 0, 5); wantedCool = 0; if (Math.floor(wanted) > before) { hud.stars.classList.add("flash"); sfx?.sting("star"); } }

function collideStatic(o, r) {
	let hit = 0;
	for (const c of colliders) {
		if (o.x < c.x0 - r - 1 || o.x > c.x1 + r + 1 || o.z < c.z0 - r - 1 || o.z > c.z1 + r + 1) continue;
		const cx = clamp(o.x, c.x0, c.x1), cz = clamp(o.z, c.z0, c.z1);
		let dx = o.x - cx, dz = o.z - cz; const d = Math.hypot(dx, dz);
		if (d < r) {
			if (d < 1e-4) { dx = 0; dz = 1; }
			const nx = dx / (d || 1), nz = dz / (d || 1); o.x += nx * (r - d); o.z += nz * (r - d);
			if (o.vx !== undefined) { const vn = o.vx * nx + o.vz * nz; if (vn < 0) { o.vx -= 1.35 * vn * nx; o.vz -= 1.35 * vn * nz; hit = Math.max(hit, -vn); } }
		}
	}
	o.x = clamp(o.x, BEACH_X - 55, CITY + 60); o.z = clamp(o.z, -60, CITY + 60);
	return hit;
}
function collideCars() {
	for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
		const A = cars[a], B = cars[b]; const dx = B.x - A.x, dz = B.z - A.z, rs = A.radius + B.radius;
		if (Math.abs(dx) > rs || Math.abs(dz) > rs) continue;
		const d = Math.hypot(dx, dz); if (d >= rs || d < 1e-4) continue;
		const nx = dx / d, nz = dz / d, pen = rs - d;
		A.x -= nx * pen / 2; A.z -= nz * pen / 2; B.x += nx * pen / 2; B.z += nz * pen / 2;
		const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
		if (rv < 0) {
			const j = -rv * 0.75; A.vx -= j * nx; A.vz -= j * nz; B.vx += j * nx; B.vz += j * nz;
			const pc = player.car;
			if ((A === pc || B === pc) && -rv > 6) { shake = Math.min(1, shake + -rv * 0.04); sfx?.crash(-rv); const other = A === pc ? B : A; addWanted(other.police ? 0.6 : 0.35); }
		}
	}
}

// drift smoke
const smoke = [];
const smokeTex = canvasTex(64, 64, (g) => { const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32); gr.addColorStop(0, "rgba(255,255,255,0.55)"); gr.addColorStop(1, "rgba(255,255,255,0)"); g.fillStyle = gr; g.fillRect(0, 0, 64, 64); }, { repeat: false });
for (let i = 0; i < 70; i++) { const s = new THREE.Sprite(new THREE.SpriteMaterial({ map: smokeTex, transparent: true, depthWrite: false, color: 0xffe2d6 })); s.visible = false; scene.add(s); smoke.push({ s, t: 9 }); }
let smokeI = 0;
function puff(x, z) { const p = smoke[smokeI++ % smoke.length]; p.t = 0; p.s.position.set(x, 0.5, z); p.s.visible = true; }
function updateSmoke(dt) { for (const p of smoke) { if (p.t > 1.4) { p.s.visible = false; continue; } p.t += dt; const k = p.t / 1.4; p.s.scale.setScalar(1.2 + k * 4); p.s.material.opacity = 0.5 * (1 - k); p.s.position.y += dt * 0.8; } }

// ================================================================ player
function makePlayer() { const c = makeHuman(); player = { ...c, x: 0, z: 0, h: 0, car: null }; }
function enterCar(car) {
	if (car.driver && !car.police) {
		const p = peds.find((q) => q.state === "walk");
		if (p) { p.state = "run"; p.t = 0; p.x = car.x - Math.cos(car.h) * 2.6; p.z = car.z + Math.sin(car.h) * 2.6; p.vx = -Math.cos(car.h) * 5.5; p.vz = Math.sin(car.h) * 5.5; p.root.visible = true; p.root.rotation.set(0, 0, 0); }
		addWanted(1); showMsg("CAR JACKED", "#ffd23f", 1.4); sfx?.sting("jack");
	} else if (car.police) { addWanted(2); showMsg("STOLE A COP CAR", "#ff4fa3", 1.6); stoleCop = true; }
	car.driver = true; car.ai = null; car.cop = null; car.max = car.police ? 42 : 40; player.car = car; player.root.visible = false;
}
function exitCar() {
	const c = player.car; player.car = null; c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }; c.driver = false;
	player.x = c.x - Math.cos(c.h) * 2.7; player.z = c.z + Math.sin(c.h) * 2.7; player.h = c.h; player.root.visible = true;
}
function nearestCar(r) { let best = null, bd = r; for (const c of cars) { const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < bd) { bd = d; best = c; } } return best; }
let recInput = null;
function updatePlayer(dt) {
	const inp = recInput || readInput();
	if (player.car) {
		const c = player.car;
		if (recInput?.auto) aiDrive(c, dt, true);
		else c.input = { throttle: inp.up, brake: inp.down, steer: inp.left - inp.right, handbrake: inp.hand };
		player.x = c.x; player.z = c.z;
		const slip = Math.abs(c.ls);
		if (slip > 4 && c.speed > 8) { money += slip * dt * 25; driftCash += slip * dt * 25; if (Math.random() < 0.7) { const bx = c.x - Math.sin(c.h) * 1.8, bz = c.z - Math.cos(c.h) * 1.8; puff(bx + Math.cos(c.h) * 0.8, bz - Math.sin(c.h) * 0.8); puff(bx - Math.cos(c.h) * 0.8, bz + Math.sin(c.h) * 0.8); } }
		if (c.speed > 25) money += dt * 12;
		distDriven += c.speed * dt;
		for (const p of peds) {
			if (p.state !== "walk" && p.state !== "run") continue;
			if (Math.hypot(p.x - c.x, p.z - c.z) < c.radius + 0.5 && c.speed > 5) {
				p.state = "fly"; p.t = 0; p.y = 0.3; p.vx = c.vx * 0.9 + rr(-2, 2); p.vz = c.vz * 0.9 + rr(-2, 2); p.vy = 6 + c.speed * 0.2; p.spin = rr(6, 12);
				setGait(p, "idle", 1); addWanted(1); shake = Math.min(1, shake + 0.3); sfx?.crash(6);
			}
		}
	} else {
		const fwd = inp.up - inp.down, side = inp.right - inp.left;
		const yaw = camYaw;
		let mx = Math.sin(yaw) * fwd - Math.cos(yaw) * side, mz = Math.cos(yaw) * fwd + Math.sin(yaw) * side;
		if (recInput?.walkTo) { const [tx, tz] = recInput.walkTo; mx = tx - player.x; mz = tz - player.z; }
		const len = Math.hypot(mx, mz);
		const running = inp.sprint || recInput?.walkTo;
		const spd = running ? 6.2 : 2.6;
		if (len > 0.01) { player.x += (mx / len) * spd * dt; player.z += (mz / len) * spd * dt; player.h = Math.atan2(mx, mz); }
		const o = { x: player.x, z: player.z }; collideStatic(o, 0.45); player.x = o.x; player.z = o.z;
		for (const c of cars) { const dx = player.x - c.x, dz = player.z - c.z, d = Math.hypot(dx, dz); if (d < c.radius + 0.45 && d > 0) { player.x = c.x + dx / d * (c.radius + 0.45); player.z = c.z + dz / d * (c.radius + 0.45); } }
		const onWalk = blocks.some((b) => player.x > b.x0 && player.x < b.x1 && player.z > b.z0 && player.z < b.z1);
		player.root.position.set(player.x, onWalk ? 0.3 : 0, player.z);
		player.root.rotation.y += wrapAngle(player.h - player.root.rotation.y) * (1 - Math.exp(-12 * dt));
		setGait(player, len > 0.01 ? (running ? "run" : "walk") : "idle", dt, 1);
		player.mixer.update(dt);
	}
	const near = !player.car && nearestCar(4.5);
	hud.tip.textContent = player.car ? "Press E to get out" : near ? (near.police ? "Press E to steal the police car" : "Press E to steal this car") : "";
	hud.tip.classList.toggle("show", !!hud.tip.textContent && !REC);
	if (pressE) { pressE = false; if (player.car) exitCar(); else if (near) enterCar(near); }
}

// ================================================================ police
function spawnCop() {
	let best = null;
	for (let t = 0; t < 30; t++) { const i = Math.floor(rr(0, N + 1)), j = Math.floor(rr(0, N + 1)); const d = Math.hypot(nodePos(i) - player.x, nodePos(j) - player.z); if (d > 70 && d < 150) { best = [i, j]; break; } }
	if (!best) return;
	const c = new Car({ police: true }); c.max = 37;
	c.place(nodePos(best[0]) + rr(-3, 3), nodePos(best[1]) + rr(-3, 3), Math.atan2(player.x - nodePos(best[0]), player.z - nodePos(best[1])));
	c.cop = { stuck: 0, rev: 0 };
}
function updatePolice(dt) {
	const cops = cars.filter((c) => c.cop);
	if (cops.length < Math.ceil(wanted * 1.4) && rand() < dt * 0.8) spawnCop();
	let near = false;
	for (const c of cops) {
		const d = Math.hypot(player.x - c.x, player.z - c.z);
		if (wanted < 1) { c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }; if (d > 120) removeCar(c); continue; }
		if (d < 60) near = true;
		const pc = player.car;
		const tx = player.x + (pc ? pc.vx * 0.45 : 0), tz = player.z + (pc ? pc.vz * 0.45 : 0);
		const { steer, diff } = steerTo(c, tx, tz);
		if (c.cop.rev > 0) { c.cop.rev -= dt; c.input = { throttle: 0, brake: 1, steer: -steer, handbrake: 0 }; continue; }
		let target = d < 14 ? Math.max((pc ? pc.speed : 0) + 3, 6) : 35;
		if (Math.abs(diff) > 0.8) target *= 0.6;
		c.input = { throttle: c.fs < target ? 1 : 0, brake: c.fs > target + 2 ? 1 : 0, steer, handbrake: Math.abs(diff) > 0.9 && c.fs > 15 ? 1 : 0 };
		if (c.speed < 1.2) { c.cop.stuck += dt; if (c.cop.stuck > 1.6) { c.cop.stuck = 0; c.cop.rev = 1.1; } } else c.cop.stuck = 0;
		if (d < 4.4 && (!pc || pc.speed < 2.5)) bustedT += dt;
	}
	if (!cops.some((c) => Math.hypot(player.x - c.x, player.z - c.z) < 4.4)) bustedT = Math.max(0, bustedT - dt);
	if (wanted > 0) {
		wantedCool = near ? 0 : wantedCool + dt;
		if (wantedCool > 7) { wanted = Math.max(0, Math.floor(wanted - 0.01)); wantedCool = 0; if (wanted === 0) { if (peakWanted >= 3) lostFrom3 = true; peakWanted = 0; showMsg("LOST THEM", "#7dff8a", 1.6); hud.stars.classList.remove("flash"); sfx?.sting("lost"); } }
	}
	if (bustedT > 2.2 && !REC) busted();
}
function removeCar(c) { scene.remove(c.root); cars.splice(cars.indexOf(c), 1); }
function busted() {
	bustedT = 0; showMsg("BUSTED", "#ff4fa3", 2.5); sfx?.sting("busted"); money = Math.max(0, money - 500); wanted = 0; peakWanted = 0; fiveStarT = 0; hud.stars.classList.remove("flash");
	for (const c of cars.filter((c) => c.cop)) removeCar(c);
	if (player.car) exitCar();
	player.x = BEACH_X - 12; player.z = CITY / 2;
}

// ================================================================ camera
let camYaw = Math.PI, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camOverride = null;
const _v = new THREE.Vector3();
function updateCamera(dt) {
	if (camOverride) { camOverride(camera, dt); return; }
	const c = player.car;
	mouseIdle += dt;
	if (c) {
		if (mouseIdle > 1.2) mouseYaw *= Math.exp(-3 * dt);
		camYaw += wrapAngle(c.h - camYaw) * (1 - Math.exp(-3.4 * dt));
	} else if (mouseIdle > 2 && (keys.KeyW || recInput?.walkTo)) camYaw += wrapAngle(player.h - camYaw) * (1 - Math.exp(-1.5 * dt));
	const yaw = camYaw + mouseYaw, spd = c ? c.speed : 0;
	const dist = c ? (camFar ? 15 : 8.2) + spd * 0.09 : 4.4, hgt = c ? (camFar ? 5.5 : 2.6) + mousePitch * 4 : 1.9 + mousePitch * 3;
	const px = player.x, pz = player.z;
	_v.set(px - Math.sin(yaw) * dist, hgt, pz - Math.cos(yaw) * dist);
	camPos.lerp(_v, 1 - Math.exp(-(c ? 9 : 12) * dt));
	camLook.lerp(_v.set(px + Math.sin(yaw) * 2.5, c ? 1.3 : 1.55, pz + Math.cos(yaw) * 2.5), 1 - Math.exp(-12 * dt));
	camera.position.copy(camPos);
	if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake * 0.6; shake = Math.max(0, shake - dt * 1.8); }
	camera.lookAt(camLook);
	camera.fov = lerp(camera.fov, (c ? 58 : 55) + spd * 0.4, 1 - Math.exp(-4 * dt)); camera.updateProjectionMatrix();
}

// ================================================================ HUD
const mctx = hud.mini.getContext("2d");
function drawHud() {
	const n = Math.floor(wanted + 0.001);
	[...hud.stars.children].forEach((s, i) => s.classList.toggle("on", i < n));
	if (n === 0) hud.stars.classList.remove("flash");
	hud.money.textContent = "$" + String(Math.floor(money)).padStart(8, "0");
	hud.speed.firstChild.textContent = String(Math.round((player.car ? player.car.speed : 0) * 3.6));
	hud.speed.style.opacity = player.car ? 1 : 0;
	const g = mctx, S = 400, sc = 1.5, yaw = camYaw + mouseYaw;
	g.save(); g.clearRect(0, 0, S, S); g.fillStyle = "#3b3846"; g.fillRect(0, 0, S, S);
	g.translate(S / 2, S / 2); g.rotate(Math.PI + yaw); g.scale(sc, sc); g.translate(-player.x, -player.z);
	g.fillStyle = "#2a78a8"; g.fillRect(-3000, -3000, 3000 + BEACH_X - 60, 6000);
	g.fillStyle = "#f2c79a"; g.fillRect(BEACH_X - 60, -3000, 60, 6000);
	for (const b of blocks) { g.fillStyle = b.kind === "downtown" ? "#7a6f9a" : b.kind === "park" ? "#4f8a4f" : "#a8899c"; g.fillRect(b.x0, b.z0, BLOCK, BLOCK); }
	const flash = Math.floor(clock * 6) % 2;
	for (const c of cars) { if (c === player.car) continue; g.fillStyle = c.police ? (flash ? "#ff2040" : "#2060ff") : "#f2eef8"; g.beginPath(); g.arc(c.x, c.z, c.police ? 4 : 2.2, 0, 7); g.fill(); }
	g.translate(player.x, player.z); g.rotate(Math.PI - (player.car ? player.car.h : player.h)); g.scale(1 / sc, 1 / sc);
	g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 3; g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.stroke(); g.fill();
	g.restore();
}

// ================================================================ loop
function step(dt) {
	clock += dt;
	if (msgT > 0) { msgT -= dt; if (msgT <= 0) hud.msg.classList.remove("show"); }
	updatePlayer(dt);
	for (const c of cars) {
		if (c === player.car) { /* driven by player */ }
		else if (c.ai && c.driver) aiDrive(c, dt);
		else if (!c.cop) c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
		c.physics(dt);
		const hit = collideStatic(c, c.radius);
		if (c === player.car && hit > 7) { shake = Math.min(1, shake + hit * 0.05); sfx?.crash(hit); }
	}
	collideCars();
	for (const c of cars) c.sync(dt);
	updatePolice(dt); updatePeds(dt); updateSmoke(dt); updateMissions(dt);
	if (sfx) {
		let copDist = 999; for (const c of cars) if (c.cop) copDist = Math.min(copDist, Math.hypot(c.x - player.x, c.z - player.z));
		const pc = player.car;
		sfx.update({ inCar: !!pc, speed: pc ? pc.speed : 0, throttle: pc ? pc.input.throttle : 0, slip: pc ? Math.abs(pc.ls) : 0, copDist, beachDist: Math.max(0, player.x - (BEACH_X - 60)), time: clock });
	}
	if (oceanMat.userData.shader) oceanMat.userData.shader.uniforms.uTime.value = clock;
	sun.position.set(player.x + SUN_DIR.x * 250, SUN_DIR.y * 250 + 40, player.z + SUN_DIR.z * 250); sun.target.position.set(player.x, 0, player.z);
	updateCamera(dt);
}
let last = performance.now(), started = false;
function frame(now) {
	const dt = Math.min(0.05, (now - last) / 1000); last = now;
	if (started) step(dt); else { clock += dt; introCam(camera, clock); }
	composer.render(); drawHud();
	requestAnimationFrame(frame);
}
function introCam(cam, t) {
	const a = t * 0.05 + 2.4, r = 230;
	cam.position.set(CITY * 0.35 + Math.cos(a) * r, 70, CITY / 2 + Math.sin(a) * r);
	cam.lookAt(CITY * 0.3, 20, CITY / 2);
}

// ================================================================ boot
async function boot() {
	const bar = document.getElementById("loading");
	await loadAssets((k) => (bar.textContent = `Loading Neon Bay… ${Math.round(k * 100)}%`));
	buildCity(); prepareCar(); prepareHumans(); makePlayer();
	for (let k = 0; k < 24; k++) { const c = new Car(); aiStart(c, Math.floor(rr(0, N)), Math.floor(rr(0, N)), Math.floor(rr(0, 4))); }
	for (let k = 0; k < 34; k++) { const p = makeHuman({ top: pick(TOPS), bottom: pick(BOTTOMS), hat: rand() < 0.35 }); peds.push(p); spawnPed(p); p.x = 0; p.z = 0; p.mixer.update(rr(0, 2)); }
	// start on the beach boulevard, a parked red car waiting
	player.x = nodePos(0) + ROAD / 2 + 2.2; player.z = nodePos(4) + 14; player.h = Math.PI;
	const starter = new Car({ color: 0xb3121f, driver: false }); starter.place(nodePos(0) + ROAD / 2 - 1.4, nodePos(4) + 9, Math.PI);
	camYaw = Math.PI; camPos.set(player.x, 3, player.z + 6);
	bar.textContent = "";
	document.getElementById("play").style.visibility = "visible";
	if (REC) { window.NB = recApi(starter); return; }
	const go = () => { if (started) return; started = true; sfx?.start(); document.getElementById("splash").style.display = "none"; canvas.requestPointerLock?.(); };
	document.getElementById("play").addEventListener("click", go);
	addEventListener("keydown", (e) => { if (e.code === "Enter") go(); });
	requestAnimationFrame(frame);
}

// ================================================================ recording / screenshot director
function recApi(starter) {
	started = true; let t = 0;
	return {
		tick(dt, draw = true) { t += dt; director(t, starter); step(dt); if (draw) { drawHud(); composer.render(); } },
		info() { return { t, wanted, cars: cars.length, x: player.x, z: player.z, inCar: !!player.car }; },
		set(o) { Object.assign(window, o); },
	};
}
function director(t, starter) {
	if (t < 3) { recInput = { up: 0, down: 0, left: 0, right: 0, hand: 0 }; return; }
	if (t < 5.2) { recInput = { walkTo: [starter.x + 2.6, starter.z] }; return; }
	if (!player.car) {
		if (Math.hypot(player.x - starter.x, player.z - starter.z) > 4.4) { player.x = starter.x + 2.6; player.z = starter.z; }
		pressE = true; recInput = { auto: true }; updatePlayer(0);
		const c = player.car, sx = c.x, sz = c.z; aiStart(c, 0, 4, 3); c.place(sx, sz, Math.PI); c.max = 40;
	}
	recInput = { auto: true };
	if (t > 9 && wanted < 2) addWanted(1);
	if (t > 13 && wanted < 3) addWanted(1);
}

boot().catch((e) => { console.error(e); document.getElementById("loading").textContent = "Failed to load: " + e.message; });
