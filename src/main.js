import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";
import { mergeGeometries } from "three/addons/utils/BufferGeometryUtils.js";

// ---------------------------------------------------------------- setup
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

const N = 8, BLOCK = 42, ROAD = 14, P = BLOCK + ROAD, CITY = N * P, LANE = 3.3;
const nodePos = (i) => i * P;

const canvas = document.getElementById("game");
const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, preserveDrawingBuffer: REC, powerPreference: "high-performance" });
renderer.setPixelRatio(REC ? 1 : Math.min(devicePixelRatio, 1.75));
renderer.setSize(innerWidth, innerHeight, false);
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;
renderer.outputColorSpace = THREE.SRGBColorSpace;

const scene = new THREE.Scene();
scene.fog = new THREE.Fog(0xe88a78, 140, 560);
const camera = new THREE.PerspectiveCamera(62, innerWidth / innerHeight, 0.3, 2000);
addEventListener("resize", () => {
	renderer.setSize(innerWidth, innerHeight, false);
	camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix();
});

// ---------------------------------------------------------------- sky + light
const SUN_DIR = new THREE.Vector3(-1, 0.16, 0.25).normalize();
{
	const geo = new THREE.SphereGeometry(1500, 32, 16);
	const mat = new THREE.ShaderMaterial({
		side: THREE.BackSide, depthWrite: false, fog: false,
		uniforms: { sun: { value: SUN_DIR } },
		vertexShader: `varying vec3 vDir; void main(){ vDir = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }`,
		fragmentShader: `uniform vec3 sun; varying vec3 vDir;
		void main(){
			float h = vDir.y;
			vec3 top = vec3(0.16,0.07,0.36); vec3 mid = vec3(0.86,0.30,0.50); vec3 hor = vec3(1.0,0.66,0.40);
			vec3 c = mix(hor, mid, smoothstep(0.0, 0.18, h)); c = mix(c, top, smoothstep(0.15, 0.6, h));
			if (h < 0.0) c = mix(hor, vec3(0.55,0.32,0.42), smoothstep(0.0,-0.2,h));
			float d = max(dot(normalize(vDir), normalize(sun)), 0.0);
			c += vec3(1.0,0.75,0.45) * pow(d, 12.0) * 0.55;
			c = mix(c, vec3(1.0,0.93,0.75), smoothstep(0.9965, 0.9985, d));
			gl_FragColor = vec4(c, 1.0);
		}`,
	});
	scene.add(new THREE.Mesh(geo, mat));
}
scene.add(new THREE.HemisphereLight(0xffc7b0, 0x3d2a5c, 1.15));
const sun = new THREE.DirectionalLight(0xffb27a, 2.6);
sun.castShadow = true;
sun.shadow.mapSize.set(2048, 2048);
const SC = 70;
Object.assign(sun.shadow.camera, { left: -SC, right: SC, top: SC, bottom: -SC, near: 1, far: 400 });
sun.shadow.bias = -0.0006; sun.shadow.normalBias = 0.6;
scene.add(sun, sun.target);

// ---------------------------------------------------------------- materials & textures
function canvasTex(w, h, draw, srgb = true) {
	const c = document.createElement("canvas"); c.width = w; c.height = h;
	draw(c.getContext("2d"), w, h);
	const t = new THREE.CanvasTexture(c);
	if (srgb) t.colorSpace = THREE.SRGBColorSpace;
	t.anisotropy = 4; t.wrapS = t.wrapT = THREE.RepeatWrapping;
	return t;
}
const FACADES = [
	{ base: "#2b3a5a", win: "#4c6a9a", lit: ["#ffd27a", "#ffe9b0", "#9ff3ff"] },
	{ base: "#d98a8a", win: "#7a4e66", lit: ["#ffd27a", "#ffb0d8"] },
	{ base: "#e9dccb", win: "#5a7f95", lit: ["#ffe2a0", "#ffffff"] },
	{ base: "#1f4d55", win: "#5ab0b8", lit: ["#a6fff1", "#ffd27a"] },
	{ base: "#6a4c8c", win: "#3a2c55", lit: ["#ff86d0", "#ffd27a", "#8af0ff"] },
	{ base: "#f2b880", win: "#7d5a4a", lit: ["#fff1c2"] },
];
const facadeMats = FACADES.map((f) => {
	const map = canvasTex(128, 128, (g, w, h) => {
		g.fillStyle = f.base; g.fillRect(0, 0, w, h);
		g.fillStyle = "rgba(0,0,0,.12)"; g.fillRect(0, 0, w, 6);
		for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) { g.fillStyle = f.win; g.fillRect(6 + x * 31, 14 + y * 29, 22, 18); }
	});
	const emissiveMap = canvasTex(128, 128, (g, w, h) => {
		g.fillStyle = "#000"; g.fillRect(0, 0, w, h);
		for (let y = 0; y < 4; y++) for (let x = 0; x < 4; x++) if (Math.random() < 0.45) { g.fillStyle = f.lit[(x + y) % f.lit.length]; g.fillRect(6 + x * 31, 14 + y * 29, 22, 18); }
	});
	return { map, emissiveMap };
});
const roofMat = new THREE.MeshStandardMaterial({ color: 0x3a3442, roughness: 0.95 });
function towerMaterial(fi, w, h) {
	const f = facadeMats[fi];
	const map = f.map.clone(); map.repeat.set(Math.max(1, Math.round(w / 4.5)), Math.max(1, Math.round(h / 4))); map.needsUpdate = true;
	const em = f.emissiveMap.clone(); em.repeat.copy(map.repeat); em.needsUpdate = true;
	return new THREE.MeshStandardMaterial({ map, emissiveMap: em, emissive: 0xffffff, emissiveIntensity: 0.85, roughness: 0.75, metalness: 0.05 });
}

// ---------------------------------------------------------------- world
const colliders = []; // {x0,x1,z0,z1}
const blocks = [];   // {i,j,x0,x1,z0,z1,kind}
const world = new THREE.Group(); scene.add(world);

const ground = new THREE.Mesh(new THREE.PlaneGeometry(3000, 3000), new THREE.MeshStandardMaterial({ color: 0x2e2a36, roughness: 0.92 }));
ground.rotation.x = -Math.PI / 2; ground.position.set(CITY / 2, 0, CITY / 2); ground.receiveShadow = true; world.add(ground);

// beach + ocean on the west (sunset side)
const sand = new THREE.Mesh(new THREE.PlaneGeometry(46, 3000), new THREE.MeshStandardMaterial({ color: 0xf0c890, roughness: 1 }));
sand.rotation.x = -Math.PI / 2; sand.position.set(-ROAD / 2 - 23, 0.03, CITY / 2); sand.receiveShadow = true; world.add(sand);
const oceanMat = new THREE.MeshStandardMaterial({ color: 0x2c7fa8, roughness: 0.18, metalness: 0.15, emissive: 0x16306a, emissiveIntensity: 0.35 });
const ocean = new THREE.Mesh(new THREE.PlaneGeometry(1400, 3000, 1, 1), oceanMat);
ocean.rotation.x = -Math.PI / 2; ocean.position.set(-ROAD / 2 - 46 - 700, 0.06, CITY / 2); world.add(ocean);
const foam = new THREE.Mesh(new THREE.PlaneGeometry(2.2, 3000), new THREE.MeshBasicMaterial({ color: 0xffffff, transparent: true, opacity: 0.7 }));
foam.rotation.x = -Math.PI / 2; foam.position.set(-ROAD / 2 - 46, 0.08, CITY / 2); world.add(foam);

// road markings
{
	const dash = new THREE.PlaneGeometry(0.28, 3.2); dash.rotateX(-Math.PI / 2);
	const zebra = new THREE.PlaneGeometry(0.9, 5); zebra.rotateX(-Math.PI / 2);
	const yellow = new THREE.MeshBasicMaterial({ color: 0xf2c94c });
	const white = new THREE.MeshBasicMaterial({ color: 0xe8e4f0 });
	const dashes = [], zebras = [];
	for (let k = 0; k <= N; k++) {
		for (let s = 0; s < N; s++) {
			const a = s * P + ROAD / 2 + 7, b = (s + 1) * P - ROAD / 2 - 7;
			for (let t = a; t < b; t += 7) { dashes.push([nodePos(k), t, 0]); dashes.push([t, nodePos(k), Math.PI / 2]); }
		}
	}
	for (let i = 0; i <= N; i++) for (let j = 0; j <= N; j++) {
		const x = nodePos(i), z = nodePos(j);
		for (let q = -5; q <= 5; q += 2) {
			zebras.push([x + q, z - ROAD / 2 - 2.6, 0], [x + q, z + ROAD / 2 + 2.6, 0], [x - ROAD / 2 - 2.6, z + q, Math.PI / 2], [x + ROAD / 2 + 2.6, z + q, Math.PI / 2]);
		}
	}
	const m4 = new THREE.Matrix4(), q4 = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
	const inst = (geo, mat, list, y) => {
		const im = new THREE.InstancedMesh(geo, mat, list.length);
		list.forEach(([x, z, r], i) => { q4.setFromAxisAngle(up, r); m4.compose(new THREE.Vector3(x, y, z), q4, one); im.setMatrixAt(i, m4); });
		world.add(im);
	};
	inst(dash, yellow, dashes, 0.02); inst(zebra, white, zebras, 0.021);
}

// palms (instanced)
const palmSpots = [];
function palmGeometries() {
	const parts = [];
	let y = 0, x = 0;
	for (let s = 0; s < 6; s++) {
		const g = new THREE.CylinderGeometry(0.22 - s * 0.02, 0.28 - s * 0.02, 1.4, 7);
		g.translate(x, y + 0.7, 0); parts.push(g); y += 1.35; x += 0.12 + s * 0.04;
	}
	const trunk = mergeGeometries(parts);
	const leaves = [];
	for (let k = 0; k < 8; k++) {
		const g = new THREE.ConeGeometry(0.55, 4.2, 4); g.scale(1, 1, 0.25);
		g.rotateZ(-Math.PI / 2 - 0.35); g.translate(2.0, -0.55, 0); g.rotateY((k / 8) * Math.PI * 2);
		g.translate(x, y, 0); leaves.push(g);
	}
	return { trunk, leaves: mergeGeometries(leaves) };
}
function buildPalms() {
	const { trunk, leaves } = palmGeometries();
	const tm = new THREE.InstancedMesh(trunk, new THREE.MeshStandardMaterial({ color: 0x8a5a3c, roughness: 1 }), palmSpots.length);
	const lm = new THREE.InstancedMesh(leaves, new THREE.MeshStandardMaterial({ color: 0x2f9a58, roughness: 0.8, side: THREE.DoubleSide }), palmSpots.length);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), e = new THREE.Euler();
	palmSpots.forEach(([x, z, s, r], i) => { e.set(0, r, 0); q.setFromEuler(e); m.compose(new THREE.Vector3(x, 0, z), q, new THREE.Vector3(s, s, s)); tm.setMatrixAt(i, m); lm.setMatrixAt(i, m); });
	tm.castShadow = lm.castShadow = true;
	world.add(tm, lm);
}

// street lamps (instanced)
const lampSpots = [];
function buildLamps() {
	const pole = new THREE.CylinderGeometry(0.1, 0.14, 6.5, 6); pole.translate(0, 3.25, 0);
	const arm = new THREE.BoxGeometry(1.6, 0.12, 0.12); arm.translate(0.75, 6.4, 0);
	const bulb = new THREE.BoxGeometry(0.7, 0.18, 0.35); bulb.translate(1.4, 6.3, 0);
	const pm = new THREE.InstancedMesh(mergeGeometries([pole, arm]), new THREE.MeshStandardMaterial({ color: 0x2a2633, roughness: 0.6 }), lampSpots.length);
	const bm = new THREE.InstancedMesh(bulb, new THREE.MeshBasicMaterial({ color: 0xffe3a8 }), lampSpots.length);
	const m = new THREE.Matrix4(), q = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0), one = new THREE.Vector3(1, 1, 1);
	lampSpots.forEach(([x, z, r], i) => { q.setFromAxisAngle(up, r); m.compose(new THREE.Vector3(x, 0.3, z), q, one); pm.setMatrixAt(i, m); bm.setMatrixAt(i, m); });
	pm.castShadow = true; world.add(pm, bm);
}

// neon signs
const NEON = [["MOTEL", "#ff4fa3"], ["OPEN 24/7", "#3ff2ff"], ["PALMS", "#7dff8a"], ["NEON BAY", "#ff4fa3"], ["DINER", "#ffd23f"], ["CLUB 88", "#b46bff"], ["TACOS", "#ff8a3d"], ["HOTEL", "#3ff2ff"], ["ARCADE", "#ff4fa3"], ["SURF", "#3ff2ff"]];
function neonSign(text, color) {
	const tex = canvasTex(512, 128, (g, w, h) => {
		g.clearRect(0, 0, w, h); g.font = "bold 84px Arial Black, Impact, sans-serif"; g.textAlign = "center"; g.textBaseline = "middle";
		g.shadowColor = color; g.shadowBlur = 24; g.fillStyle = color; g.fillText(text, w / 2, h / 2 + 4);
		g.shadowBlur = 0; g.fillStyle = "#fff"; g.globalAlpha = 0.85; g.fillText(text, w / 2, h / 2 + 4);
	});
	const w = 3 + text.length * 1.25;
	const m = new THREE.Mesh(new THREE.PlaneGeometry(w, w / 4), new THREE.MeshBasicMaterial({ map: tex, transparent: true, toneMapped: false, fog: true }));
	return m;
}

function addTower(x0, z0, w, d, h, fi) {
	const mat = towerMaterial(fi, Math.max(w, d), h);
	const mesh = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), [mat, mat, roofMat, roofMat, mat, mat]);
	mesh.position.set(x0 + w / 2, h / 2 + 0.3, z0 + d / 2); mesh.castShadow = true; mesh.receiveShadow = true; world.add(mesh);
	if (h > 30 && rand() < 0.6) {
		const cap = new THREE.Mesh(new THREE.BoxGeometry(w * 0.55, rr(2, 6), d * 0.55), roofMat);
		cap.position.set(x0 + w / 2, h + 0.3 + cap.geometry.parameters.height / 2, z0 + d / 2); cap.castShadow = true; world.add(cap);
		if (rand() < 0.5) { const ant = new THREE.Mesh(new THREE.CylinderGeometry(0.12, 0.2, 10, 6), roofMat); ant.position.set(cap.position.x, cap.position.y + 6, cap.position.z); world.add(ant); }
	}
	colliders.push({ x0: x0 - 0.2, x1: x0 + w + 0.2, z0: z0 - 0.2, z1: z0 + d + 0.2 });
	return mesh;
}

// ---------------------------------------------------------------- assets
const loader = new GLTFLoader();
const ASSETS = {};
async function loadModels() {
	const list = {
		red: "assets/cars/vehicle-truck-red.glb", yellow: "assets/cars/vehicle-truck-yellow.glb", green: "assets/cars/vehicle-truck-green.glb",
		purple: "assets/cars/vehicle-truck-purple.glb", moto: "assets/cars/vehicle-motorcycle.glb", char: "assets/char/character.glb",
		houseA: "assets/city/building-small-a.glb", houseB: "assets/city/building-small-b.glb", houseC: "assets/city/building-small-c.glb",
		houseD: "assets/city/building-small-d.glb", garage: "assets/city/building-garage.glb", trees: "assets/city/grass-trees-tall.glb",
		trees2: "assets/city/grass-trees.glb", fountain: "assets/city/pavement-fountain.glb",
	};
	await Promise.all(Object.entries(list).map(async ([k, url]) => { ASSETS[k] = await loader.loadAsync(url); }));
	for (const g of Object.values(ASSETS)) g.scene.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; if (o.material.map) o.material.map.anisotropy = 4; } });
}
function fitModel(obj, size, axis = "max") {
	const box = new THREE.Box3().setFromObject(obj), s = new THREE.Vector3(); box.getSize(s);
	const k = size / (axis === "max" ? Math.max(s.x, s.z) : axis === "y" ? s.y : s[axis]);
	obj.scale.multiplyScalar(k);
	const b2 = new THREE.Box3().setFromObject(obj), c = new THREE.Vector3(); b2.getCenter(c);
	obj.position.x -= c.x; obj.position.z -= c.z; obj.position.y -= b2.min.y;
	return obj;
}
function placeProp(key, x, z, size, rot, axis) {
	const holder = new THREE.Group(); const m = ASSETS[key].scene.clone(true); fitModel(m, size, axis); holder.add(m);
	holder.position.set(x, 0.3, z); holder.rotation.y = rot; world.add(holder); return holder;
}

function buildCity() {
	const c = (N - 1) / 2;
	const lawnMat = new THREE.MeshStandardMaterial({ color: 0x5f9a52, roughness: 1 });
	const walkMat = new THREE.MeshStandardMaterial({ color: 0xa79fb5, roughness: 0.95 });
	const plazaMat = new THREE.MeshStandardMaterial({ color: 0xcdb7a6, roughness: 0.95 });
	for (let i = 0; i < N; i++) for (let j = 0; j < N; j++) {
		const x0 = nodePos(i) + ROAD / 2, z0 = nodePos(j) + ROAD / 2, x1 = x0 + BLOCK, z1 = z0 + BLOCK;
		const d = Math.max(Math.abs(i - c), Math.abs(j - c));
		let kind = d <= 1.5 ? "downtown" : d <= 2.5 ? "mid" : "suburb";
		if (rand() < 0.1 && kind !== "downtown") kind = "park";
		if (i === 0) kind = rand() < 0.5 ? "beachfront" : "park";
		blocks.push({ i, j, x0, x1, z0, z1, kind });
		const walk = new THREE.Mesh(new THREE.BoxGeometry(BLOCK, 0.3, BLOCK), walkMat);
		walk.position.set(x0 + BLOCK / 2, 0.15, z0 + BLOCK / 2); walk.receiveShadow = true; world.add(walk);
		const inner = 3.2, ix0 = x0 + inner, iz0 = z0 + inner, iw = BLOCK - inner * 2;
		if (kind === "downtown" || kind === "mid") {
			const plaza = new THREE.Mesh(new THREE.PlaneGeometry(iw, iw), plazaMat); plaza.rotation.x = -Math.PI / 2; plaza.position.set(x0 + BLOCK / 2, 0.31, z0 + BLOCK / 2); plaza.receiveShadow = true; world.add(plaza);
			const split = rand() < 0.75;
			const cells = split ? [[0, 0], [1, 0], [0, 1], [1, 1]] : [[0, 0]];
			const cw = split ? iw / 2 : iw;
			for (const [a, b] of cells) {
				if (split && rand() < 0.15) continue;
				const m = 1.2, w = cw - m * 2 - rr(0, 3), dd = cw - m * 2 - rr(0, 3);
				const h = kind === "downtown" ? rr(28, 98) * (1 - d * 0.18) : rr(9, 26);
				const tw = addTower(ix0 + a * cw + m, iz0 + b * cw + m, w, dd, h, Math.floor(rand() * FACADES.length));
				if (rand() < 0.35) {
					const [txt, col] = pick(NEON); const s = neonSign(txt, col);
					const face = Math.floor(rand() * 4); const hh = rr(6, Math.min(16, h - 2));
					const cx = tw.position.x, cz = tw.position.z;
					if (face === 0) { s.position.set(cx, hh, cz + dd / 2 + 0.06); }
					if (face === 1) { s.position.set(cx, hh, cz - dd / 2 - 0.06); s.rotation.y = Math.PI; }
					if (face === 2) { s.position.set(cx + w / 2 + 0.06, hh, cz); s.rotation.y = Math.PI / 2; }
					if (face === 3) { s.position.set(cx - w / 2 - 0.06, hh, cz); s.rotation.y = -Math.PI / 2; }
					world.add(s);
				}
			}
		} else {
			const lawn = new THREE.Mesh(new THREE.PlaneGeometry(iw, iw), lawnMat); lawn.rotation.x = -Math.PI / 2; lawn.position.set(x0 + BLOCK / 2, 0.31, z0 + BLOCK / 2); lawn.receiveShadow = true; world.add(lawn);
			if (kind === "park") {
				placeProp("fountain", x0 + BLOCK / 2, z0 + BLOCK / 2, 10, 0);
				colliders.push({ x0: x0 + BLOCK / 2 - 4, x1: x0 + BLOCK / 2 + 4, z0: z0 + BLOCK / 2 - 4, z1: z0 + BLOCK / 2 + 4 });
				for (let k = 0; k < 6; k++) placeProp(rand() < 0.5 ? "trees" : "trees2", rr(ix0 + 4, ix0 + iw - 4), rr(iz0 + 4, iz0 + iw - 4), 8, rr(0, 6));
				for (let k = 0; k < 5; k++) palmSpots.push([rr(ix0 + 3, ix0 + iw - 3), rr(iz0 + 3, iz0 + iw - 3), rr(0.9, 1.3), rr(0, 6)]);
			} else {
				const houses = ["houseA", "houseB", "houseC", "houseD", "garage"];
				const spots = [[0.27, 0.27], [0.73, 0.27], [0.27, 0.73], [0.73, 0.73]];
				for (const [a, b] of spots) {
					const hx = ix0 + iw * a, hz = iz0 + iw * b, size = rr(10, 13);
					const rot = [0, Math.PI / 2, Math.PI, -Math.PI / 2][Math.floor(rand() * 4)];
					placeProp(pick(houses), hx, hz, size, rot);
					colliders.push({ x0: hx - size / 2, x1: hx + size / 2, z0: hz - size / 2, z1: hz + size / 2 });
				}
				for (let k = 0; k < 3; k++) palmSpots.push([rr(ix0 + 2, ix0 + iw - 2), rr(iz0 + 2, iz0 + iw - 2), rr(0.8, 1.2), rr(0, 6)]);
			}
		}
		// lamps on sidewalks
		for (let t = 6; t < BLOCK - 4; t += 18) {
			lampSpots.push([x0 + t, z0 + 1.2, Math.PI / 2], [x0 + t, z1 - 1.2, -Math.PI / 2], [x0 + 1.2, z0 + t, 0], [x1 - 1.2, z0 + t, Math.PI]);
		}
	}
	// beach palms
	for (let z = -40; z < CITY + 40; z += rr(9, 16)) palmSpots.push([rr(-ROAD / 2 - 30, -ROAD / 2 - 6), z, rr(1.1, 1.6), rr(0, 6)]);
	buildPalms(); buildLamps();
}

// ---------------------------------------------------------------- cars
const cars = [];
const CAR_KEYS = ["red", "yellow", "green", "purple", "red", "yellow", "green"];
let carProtos = {};
function makeCarProto(key) {
	const m = ASSETS[key].scene.clone(true);
	m.updateMatrixWorld(true);
	const wf = m.getObjectByName("wheel-front-left") || m.getObjectByName("wheel-front");
	const wb = m.getObjectByName("wheel-back-left") || m.getObjectByName("wheel-back");
	const holder = new THREE.Group(); holder.add(m);
	const len = key === "moto" ? 2.4 : 4.8;
	fitModel(m, len, "max");
	m.updateMatrixWorld(true);
	const pf = new THREE.Vector3(), pb = new THREE.Vector3(); wf.getWorldPosition(pf); wb.getWorldPosition(pb);
	const ax = Math.abs(pf.x - pb.x) > Math.abs(pf.z - pb.z) ? "x" : "z";
	// make the model face +z
	if (ax === "x") holder.rotation.y = pf.x > pb.x ? -Math.PI / 2 : Math.PI / 2;
	else if (pf.z < pb.z) holder.rotation.y = Math.PI;
	const outer = new THREE.Group(); outer.add(holder);
	return outer;
}
class Car {
	constructor(key, opts = {}) {
		this.key = key; this.root = carProtos[key].clone(true); scene.add(this.root);
		this.wheels = []; this.front = [];
		this.root.traverse((o) => { if (o.name && o.name.startsWith("wheel")) { this.wheels.push(o); if (o.name.includes("front")) this.front.push(o); } });
		this.x = 0; this.z = 0; this.h = 0; this.vx = 0; this.vz = 0; this.steer = 0; this.fs = 0;
		this.radius = key === "moto" ? 1.2 : 2.1; this.max = 16; this.driver = opts.driver ?? true; this.police = !!opts.police;
		this.ai = null; this.input = { throttle: 0, brake: 0, steer: 0, handbrake: 0 }; this.roll = 0; this.stuck = 0; this.reverseT = 0;
		this.spin = 0;
		if (this.police) this.addLightbar();
		cars.push(this);
	}
	addLightbar() {
		const bar = new THREE.Group();
		this.red = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.45), new THREE.MeshBasicMaterial({ color: 0xff2040, toneMapped: false }));
		this.blue = new THREE.Mesh(new THREE.BoxGeometry(0.7, 0.28, 0.45), new THREE.MeshBasicMaterial({ color: 0x2060ff, toneMapped: false }));
		this.red.position.x = -0.4; this.blue.position.x = 0.4; bar.add(this.red, this.blue);
		bar.position.set(0, 2.55, 0.2); this.root.add(bar);
		const sign = neonSign("POLICE", "#ffffff"); sign.scale.setScalar(0.32); sign.position.set(0, 2.1, -2.42); sign.rotation.y = Math.PI; this.root.add(sign);
		const sign2 = sign.clone(); sign2.position.z = 2.42; sign2.rotation.y = 0; this.root.add(sign2);
	}
	get speed() { return Math.hypot(this.vx, this.vz); }
	place(x, z, h) { this.x = x; this.z = z; this.h = h; this.vx = this.vz = 0; this.sync(0); }
	physics(dt) {
		const { throttle, brake, steer, handbrake } = this.input;
		const fx = Math.sin(this.h), fz = Math.cos(this.h), rx = -fz, rz = fx;
		let fs = this.vx * fx + this.vz * fz, ls = this.vx * rx + this.vz * rz;
		const acc = this.police ? 17 : 15;
		if (throttle > 0) fs += throttle * acc * dt * (1 - clamp(fs / this.max, 0, 1) * 0.85);
		if (brake > 0) { if (fs > 0.5) fs -= brake * 32 * dt; else fs = Math.max(fs - brake * 9 * dt, -9); }
		if (throttle === 0 && brake === 0) fs -= Math.sign(fs) * Math.min(Math.abs(fs), (2 + Math.abs(fs) * 0.25) * dt);
		fs = clamp(fs, -10, this.max);
		const grip = handbrake ? 1.3 : 8.5;
		ls *= Math.exp(-grip * dt);
		if (handbrake) fs *= 1 - 0.55 * dt;
		this.steer = lerp(this.steer, steer, 1 - Math.exp(-10 * dt));
		const yaw = (fs / 2.9) * Math.tan(this.steer * 0.55) * (handbrake ? 1.55 : 1);
		this.h = wrapAngle(this.h + yaw * dt);
		const nfx = Math.sin(this.h), nfz = Math.cos(this.h);
		this.vx = nfx * fs + -nfz * ls; this.vz = nfz * fs + nfx * ls;
		this.fs = fs; this.ls = ls;
		this.x += this.vx * dt; this.z += this.vz * dt;
	}
	sync(dt) {
		this.root.position.set(this.x, 0.02, this.z);
		this.root.rotation.y = this.h;
		this.roll = lerp(this.roll, clamp((this.ls || 0) * 0.025 + this.steer * (this.fs || 0) * -0.004, -0.12, 0.12), 1 - Math.exp(-6 * dt));
		this.root.rotation.z = this.roll;
		this.spin += (this.fs || 0) * dt / 0.45;
		for (const w of this.wheels) w.rotation.x = this.spin;
		for (const w of this.front) w.rotation.y = this.steer * 0.45;
		if (this.police) { const on = Math.floor(clock * 6) % 2 === 0; this.red.visible = on; this.blue.visible = !on; }
	}
}

// ---------------------------------------------------------------- road graph AI
const DIRS = [[1, 0], [-1, 0], [0, 1], [0, -1]];
function laneOffset(dx, dz) { return [-dz * LANE * -1, dx * LANE * -1]; } // right side of travel
function rightOf(dx, dz) { const fz = dz, fx = dx; return [-fz, fx]; }
function aiStart(car, i, j, d) {
	const [dx, dz] = DIRS[d]; const ni = i + dx, nj = j + dz;
	const [rx, rz] = rightOf(dx, dz);
	car.ai = { i, j, ni, nj, dx, dz, wps: [[nodePos(ni) + rx * LANE - dx * 9, nodePos(nj) + rz * LANE - dz * 9, "entry"]], base: rr(9, 13) };
	const t = rr(0.25, 0.75);
	car.place(lerp(nodePos(i), nodePos(ni), t) + rx * LANE, lerp(nodePos(j), nodePos(nj), t) + rz * LANE, Math.atan2(dx, dz));
}
function aiPlan(car) {
	const a = car.ai; const opts = [];
	for (let k = 0; k < 4; k++) {
		const [dx, dz] = DIRS[k];
		if (dx === -a.dx && dz === -a.dz) continue;
		const ti = a.ni + dx, tj = a.nj + dz;
		if (ti < 0 || tj < 0 || ti > N || tj > N) continue;
		opts.push(k);
	}
	let k = opts.find((o) => DIRS[o][0] === a.dx && DIRS[o][1] === a.dz);
	if (k === undefined || rand() < 0.45) k = pick(opts);
	if (a.forceTurn !== undefined && opts.includes(a.forceTurn)) { k = a.forceTurn; a.forceTurn = undefined; }
	const [dx, dz] = DIRS[k]; const [rx, rz] = rightOf(dx, dz);
	const nx = nodePos(a.ni), nz = nodePos(a.nj);
	a.i = a.ni; a.j = a.nj; a.ni = a.i + dx; a.nj = a.j + dz; a.dx = dx; a.dz = dz;
	a.wps.push([nx + rx * LANE + dx * 8, nz + rz * LANE + dz * 8, "exit"]);
	a.wps.push([nodePos(a.ni) + rx * LANE - dx * 9, nodePos(a.nj) + rz * LANE - dz * 9, "entry"]);
}
function steerTo(car, tx, tz) {
	const want = Math.atan2(tx - car.x, tz - car.z);
	const diff = wrapAngle(want - car.h);
	return { steer: clamp(diff * 2.4, -1, 1), diff };
}
function aiDrive(car, dt, fast = false) {
	const a = car.ai;
	if (!a.wps.length) aiPlan(car);
	const [tx, tz] = a.wps[0];
	if (Math.hypot(tx - car.x, tz - car.z) < (fast ? 5 : 3.5)) { const w = a.wps.shift(); if (w[2] === "entry" && !a.wps.length) aiPlan(car); }
	const t = a.wps[0] || [tx, tz];
	const { steer, diff } = steerTo(car, t[0], t[1]);
	let target = fast ? 31 : a.base;
	if (Math.abs(diff) > 0.35) target *= fast ? 0.62 : 0.55;
	if (!fast) {
		const fx = Math.sin(car.h), fz = Math.cos(car.h);
		for (const o of [...cars, player.car ? null : player].filter(Boolean)) {
			if (o === car) continue;
			const ox = (o.x ?? o.pos.x) - car.x, oz = (o.z ?? o.pos.z) - car.z;
			const ahead = ox * fx + oz * fz, side = Math.abs(ox * -fz + oz * fx);
			if (ahead > 0 && ahead < 11 && side < 2.6) target = Math.min(target, Math.max(0, (ahead - 5) * 1.2));
		}
	}
	const fs = car.fs || 0;
	car.input.steer = steer;
	car.input.throttle = fs < target ? 1 : 0;
	car.input.brake = fs > target + 1.5 ? 1 : 0;
	car.input.handbrake = fast && Math.abs(diff) > 0.55 && fs > 17 ? 1 : 0;
}

// ---------------------------------------------------------------- people
const peds = [];
let player;
function makeCharacter(tint) {
	const m = SkeletonUtils.clone(ASSETS.char.scene);
	const holder = new THREE.Group(); fitModel(m, 1.8, "y"); holder.add(m);
	if (tint) m.traverse((o) => { if (o.isMesh) { o.material = o.material.clone(); o.material.color = new THREE.Color(tint); } });
	const mixer = new THREE.AnimationMixer(m);
	const clip = (n) => ASSETS.char.animations.find((a) => a.name === n);
	const walk = mixer.clipAction(clip("walk")), idle = mixer.clipAction(clip("idle"));
	walk.play(); idle.play(); walk.weight = 0; idle.weight = 1;
	scene.add(holder);
	return { root: holder, mixer, walk, idle };
}
const PED_TINTS = ["#ffd0b0", "#b0e0ff", "#ffb0d8", "#c8ffb0", "#fff0a0", "#d8c0ff", "#ffffff"];
function spawnPed(p) {
	const b = pick(blocks.filter((q) => q.kind !== "park" || rand() < 0.3));
	p.block = b; p.s = rr(0, 4); p.dir = rand() < 0.5 ? 1 : -1; p.speed = rr(1.2, 1.8); p.state = "walk"; p.t = 0;
	p.root.visible = true; p.root.rotation.set(0, 0, 0);
}
function pedPos(p) {
	const b = p.block, m = 1.4; const x0 = b.x0 + m, x1 = b.x1 - m, z0 = b.z0 + m, z1 = b.z1 - m;
	const s = ((p.s % 4) + 4) % 4, f = s % 1;
	if (s < 1) return [lerp(x0, x1, f), z0, Math.PI / 2];
	if (s < 2) return [x1, lerp(z0, z1, f), 0];
	if (s < 3) return [lerp(x1, x0, f), z1, -Math.PI / 2];
	return [x0, lerp(z1, z0, f), Math.PI];
}
function updatePeds(dt) {
	for (const p of peds) {
		p.mixer.update(dt);
		if (p.state === "walk") {
			p.s += (p.dir * p.speed * dt) / BLOCK;
			const [x, z, r] = pedPos(p); p.x = x; p.z = z;
			p.root.position.set(x, 0.3, z); p.root.rotation.y = r + (p.dir < 0 ? Math.PI : 0);
			p.walk.weight = 1; p.idle.weight = 0; p.walk.timeScale = p.speed / 1.4;
		} else if (p.state === "run") {
			p.t += dt; p.x += p.vx * dt; p.z += p.vz * dt; p.root.position.set(p.x, 0.3, p.z); p.root.rotation.y = Math.atan2(p.vx, p.vz);
			p.walk.weight = 1; p.walk.timeScale = 2.6; if (p.t > 4) spawnPed(p);
		} else if (p.state === "fly") {
			p.t += dt; p.vy -= 22 * dt; p.x += p.vx * dt; p.z += p.vz * dt; p.y += p.vy * dt;
			p.root.rotation.x += p.spin * dt; p.root.rotation.z += p.spin * 0.6 * dt;
			if (p.y <= 0.3 && p.vy < 0) { p.y = 0.3; p.state = "down"; p.t = 0; p.root.rotation.set(-Math.PI / 2, p.root.rotation.y, 0); }
			p.root.position.set(p.x, p.y, p.z); p.walk.weight = 0; p.idle.weight = 0;
		} else if (p.state === "down") { p.t += dt; if (p.t > 10) spawnPed(p); }
	}
}

// ---------------------------------------------------------------- input
const keys = {};
addEventListener("keydown", (e) => { keys[e.code] = true; if (e.code === "KeyE") pressE = true; if (e.code === "KeyC") camFar = !camFar; if (["Space", "ArrowUp", "ArrowDown"].includes(e.code)) e.preventDefault(); });
addEventListener("keyup", (e) => { keys[e.code] = false; });
let pressE = false, camFar = false;
function readInput() {
	return {
		up: keys.KeyW || keys.ArrowUp ? 1 : 0, down: keys.KeyS || keys.ArrowDown ? 1 : 0,
		left: keys.KeyA || keys.ArrowLeft ? 1 : 0, right: keys.KeyD || keys.ArrowRight ? 1 : 0,
		hand: keys.Space ? 1 : 0, sprint: keys.ShiftLeft || keys.ShiftRight ? 1 : 0,
	};
}

// ---------------------------------------------------------------- game state
let clock = 0, wanted = 0, wantedCool = 0, money = 0, shake = 0, msgT = 0, bustedT = 0;
const hud = {
	stars: document.getElementById("stars"), money: document.getElementById("money"), speed: document.getElementById("speed"),
	msg: document.getElementById("msg"), tip: document.getElementById("tip"), mission: document.getElementById("mission"), mini: document.getElementById("mini"),
};
function showMsg(text, color = "#fff", secs = 2) { hud.msg.textContent = text; hud.msg.style.color = color; hud.msg.classList.add("show"); msgT = secs; }
function addWanted(n) { const before = Math.floor(wanted); wanted = clamp(wanted + n, 0, 5); wantedCool = 0; if (Math.floor(wanted) > before) hud.stars.classList.add("flash"); }

function collideStatic(o, r) {
	let hit = 0;
	for (const c of colliders) {
		if (o.x < c.x0 - r - 1 || o.x > c.x1 + r + 1 || o.z < c.z0 - r - 1 || o.z > c.z1 + r + 1) continue;
		const cx = clamp(o.x, c.x0, c.x1), cz = clamp(o.z, c.z0, c.z1);
		let dx = o.x - cx, dz = o.z - cz; let d = Math.hypot(dx, dz);
		if (d < r) {
			if (d < 1e-4) { dx = 0; dz = 1; d = 0; }
			const nx = dx / (d || 1), nz = dz / (d || 1); o.x += nx * (r - d); o.z += nz * (r - d);
			if (o.vx !== undefined) { const vn = o.vx * nx + o.vz * nz; if (vn < 0) { o.vx -= 1.35 * vn * nx; o.vz -= 1.35 * vn * nz; hit = Math.max(hit, -vn); } }
		}
	}
	o.x = clamp(o.x, -ROAD / 2 - 40, CITY + 60); o.z = clamp(o.z, -60, CITY + 60);
	return hit;
}
function collideCars() {
	for (let a = 0; a < cars.length; a++) for (let b = a + 1; b < cars.length; b++) {
		const A = cars[a], B = cars[b]; const dx = B.x - A.x, dz = B.z - A.z, rsum = A.radius + B.radius;
		if (Math.abs(dx) > rsum || Math.abs(dz) > rsum) continue;
		const d = Math.hypot(dx, dz); if (d >= rsum || d < 1e-4) continue;
		const nx = dx / d, nz = dz / d, pen = rsum - d;
		A.x -= nx * pen / 2; A.z -= nz * pen / 2; B.x += nx * pen / 2; B.z += nz * pen / 2;
		const rv = (B.vx - A.vx) * nx + (B.vz - A.vz) * nz;
		if (rv < 0) {
			const j = -rv * 0.75; A.vx -= j * nx; A.vz -= j * nz; B.vx += j * nx; B.vz += j * nz;
			const pc = player.car;
			if ((A === pc || B === pc) && -rv > 6) { shake = Math.min(1, shake + -rv * 0.04); const other = A === pc ? B : A; addWanted(other.police ? 0.6 : 0.35); }
		}
	}
}

// ---------------------------------------------------------------- player
function makePlayer() {
	const c = makeCharacter("#9ff3ff");
	player = { ...c, pos: new THREE.Vector3(), vx: 0, vz: 0, x: 0, z: 0, h: 0, car: null };
}
function enterCar(car) {
	if (car.driver && !car.police) {
		const p = peds.find((q) => q.state === "down" || q.state === "walk");
		if (p) { p.state = "run"; p.t = 0; p.x = car.x - Math.cos(car.h) * 2.5; p.z = car.z + Math.sin(car.h) * 2.5; p.vx = -Math.cos(car.h) * 5; p.vz = Math.sin(car.h) * 5; p.root.visible = true; p.root.rotation.set(0, 0, 0); }
		addWanted(1); showMsg("CAR JACKED", "#ffd23f", 1.4);
	} else if (car.police) { addWanted(2); showMsg("STOLE A COP CAR", "#ff4fa3", 1.6); }
	car.driver = true; car.ai = null; car.max = car.police ? 40 : 37; player.car = car; player.root.visible = false;
}
function exitCar() {
	const c = player.car; player.car = null; c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }; c.driver = false;
	player.x = c.x - Math.cos(c.h) * 2.6; player.z = c.z + Math.sin(c.h) * 2.6; player.root.visible = true;
}
function nearestCar(r) {
	let best = null, bd = r;
	for (const c of cars) { const d = Math.hypot(c.x - player.x, c.z - player.z); if (d < bd) { bd = d; best = c; } }
	return best;
}
let recInput = null;
function updatePlayer(dt) {
	const inp = recInput || readInput();
	if (player.car) {
		const c = player.car;
		if (recInput?.auto) aiDrive(c, dt, true);
		else c.input = { throttle: inp.up, brake: inp.down, steer: inp.left - inp.right, handbrake: inp.hand };
		player.x = c.x; player.z = c.z;
		if (c.input.handbrake && Math.abs(c.ls || 0) > 4) money += Math.abs(c.ls) * dt * 25;
		if (c.speed > 22) money += dt * 12;
		// hit peds
		for (const p of peds) {
			if (p.state !== "walk" && p.state !== "run") continue;
			if (Math.hypot(p.x - c.x, p.z - c.z) < c.radius + 0.6 && c.speed > 5) {
				p.state = "fly"; p.t = 0; p.y = 0.3; p.vx = c.vx * 0.9 + rr(-2, 2); p.vz = c.vz * 0.9 + rr(-2, 2); p.vy = 6 + c.speed * 0.2; p.spin = rr(6, 12);
				addWanted(1); shake = Math.min(1, shake + 0.3);
			}
		}
	} else {
		const fwd = inp.up - inp.down, side = inp.right - inp.left;
		const yaw = camYaw;
		let mx = Math.sin(yaw) * fwd - Math.cos(yaw) * side, mz = Math.cos(yaw) * fwd + Math.sin(yaw) * side;
		if (recInput?.walkTo) { const [tx, tz] = recInput.walkTo; mx = tx - player.x; mz = tz - player.z; }
		const len = Math.hypot(mx, mz);
		const spd = recInput?.walkTo ? 5.5 : inp.sprint ? 9 : 5;
		if (len > 0.01) { player.x += (mx / len) * spd * dt; player.z += (mz / len) * spd * dt; player.h = Math.atan2(mx, mz); }
		const o = { x: player.x, z: player.z }; collideStatic(o, 0.5); player.x = o.x; player.z = o.z;
		for (const c of cars) { const dx = player.x - c.x, dz = player.z - c.z, d = Math.hypot(dx, dz); if (d < c.radius + 0.5 && d > 0) { player.x = c.x + dx / d * (c.radius + 0.5); player.z = c.z + dz / d * (c.radius + 0.5); } }
		player.root.position.set(player.x, 0.3, player.z);
		player.root.rotation.y = lerp(player.root.rotation.y, player.root.rotation.y + wrapAngle(player.h - player.root.rotation.y), 1 - Math.exp(-12 * dt));
		const moving = len > 0.01 ? 1 : 0;
		player.walk.weight = lerp(player.walk.weight, moving, 0.2); player.idle.weight = 1 - player.walk.weight; player.walk.timeScale = spd / 4;
		player.mixer.update(dt);
	}
	const near = !player.car && nearestCar(4.5);
	hud.tip.textContent = player.car ? "Press E to get out" : near ? (near.police ? "Press E to steal the police car" : "Press E to steal this car") : "";
	hud.tip.classList.toggle("show", !!hud.tip.textContent && !REC);
	if (pressE) { pressE = false; if (player.car) exitCar(); else if (near) enterCar(near); }
}

// ---------------------------------------------------------------- police
function spawnCop() {
	let best = null;
	for (let t = 0; t < 30; t++) {
		const i = Math.floor(rr(0, N + 1)), j = Math.floor(rr(0, N + 1));
		const d = Math.hypot(nodePos(i) - player.x, nodePos(j) - player.z);
		if (d > 70 && d < 150) { best = [i, j]; break; }
	}
	if (!best) return;
	const c = new Car("purple", { police: true }); c.max = 36;
	c.place(nodePos(best[0]) + rr(-3, 3), nodePos(best[1]) + rr(-3, 3), Math.atan2(player.x - nodePos(best[0]), player.z - nodePos(best[1])));
	c.cop = { stuck: 0, rev: 0 };
}
function updatePolice(dt) {
	const cops = cars.filter((c) => c.police && c !== player.car && c.cop);
	const wantCops = Math.ceil(wanted * 1.4);
	if (cops.length < wantCops && Math.floor(clock * 2) % 3 === 0 && rand() < 0.2) spawnCop();
	let near = false;
	for (const c of cops) {
		const d = Math.hypot(player.x - c.x, player.z - c.z);
		if (wanted < 1) { c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0 }; if (d > 120) removeCar(c); continue; }
		if (d < 60) near = true;
		const pc = player.car; const lead = pc ? 0.45 : 0;
		const tx = player.x + (pc ? pc.vx * lead : 0), tz = player.z + (pc ? pc.vz * lead : 0);
		const { steer, diff } = steerTo(c, tx, tz);
		if (c.cop.rev > 0) { c.cop.rev -= dt; c.input = { throttle: 0, brake: 1, steer: -steer, handbrake: 0 }; continue; }
		const fs = c.fs || 0;
		let target = d < 14 ? Math.max((pc ? pc.speed : 0) + 3, 6) : 34;
		if (Math.abs(diff) > 0.8) target *= 0.6;
		c.input = { throttle: fs < target ? 1 : 0, brake: fs > target + 2 ? 1 : 0, steer, handbrake: Math.abs(diff) > 0.9 && fs > 15 ? 1 : 0 };
		if (c.speed < 1.2) { c.cop.stuck += dt; if (c.cop.stuck > 1.6) { c.cop.stuck = 0; c.cop.rev = 1.1; } } else c.cop.stuck = 0;
		if (d < 4.2 && (!pc || pc.speed < 2.5)) { bustedT += dt; }
	}
	if (!cops.some((c) => Math.hypot(player.x - c.x, player.z - c.z) < 4.2)) bustedT = Math.max(0, bustedT - dt);
	if (wanted > 0) {
		wantedCool = near ? 0 : wantedCool + dt;
		if (wantedCool > 7) { wanted = Math.max(0, Math.floor(wanted - 0.01)); wantedCool = 0; if (wanted === 0) { showMsg("LOST THEM", "#7dff8a", 1.6); hud.stars.classList.remove("flash"); } }
	}
	if (bustedT > 2.2 && !REC) busted();
}
function removeCar(c) { scene.remove(c.root); cars.splice(cars.indexOf(c), 1); }
function busted() {
	bustedT = 0; showMsg("BUSTED", "#ff4fa3", 2.5); money = Math.max(0, money - 500);
	wanted = 0; hud.stars.classList.remove("flash");
	for (const c of cars.filter((c) => c.cop)) removeCar(c);
	if (player.car) exitCar();
	player.x = -ROAD / 2 - 10; player.z = CITY / 2;
}

// ---------------------------------------------------------------- camera
let camYaw = 0, camPos = new THREE.Vector3(), camLook = new THREE.Vector3(), camOverride = null;
function updateCamera(dt) {
	if (camOverride) { camOverride(camera, dt); return; }
	const c = player.car;
	const tgtYaw = c ? c.h : player.h;
	const spd = c ? c.speed : 0;
	camYaw = camYaw + wrapAngle(tgtYaw - camYaw) * (1 - Math.exp(-(c ? 3.2 : 2.2) * dt));
	const dist = c ? (camFar ? 18 : 10.5) + spd * 0.12 : 6.5, hgt = c ? (camFar ? 8 : 4.4) : 3.2;
	const want = new THREE.Vector3(player.x - Math.sin(camYaw) * dist, hgt, player.z - Math.cos(camYaw) * dist);
	camPos.lerp(want, 1 - Math.exp(-8 * dt));
	camLook.lerp(new THREE.Vector3(player.x + Math.sin(camYaw) * 3, c ? 1.6 : 1.5, player.z + Math.cos(camYaw) * 3), 1 - Math.exp(-10 * dt));
	camera.position.copy(camPos);
	if (shake > 0) { camera.position.x += (Math.random() - 0.5) * shake; camera.position.y += (Math.random() - 0.5) * shake * 0.6; shake = Math.max(0, shake - dt * 1.8); }
	camera.lookAt(camLook);
	camera.fov = lerp(camera.fov, 62 + spd * 0.45, 0.08); camera.updateProjectionMatrix();
}

// ---------------------------------------------------------------- HUD
const mctx = hud.mini.getContext("2d");
function drawHud() {
	const n = Math.floor(wanted + 0.001);
	[...hud.stars.children].forEach((s, i) => s.classList.toggle("on", i < n));
	if (n === 0) hud.stars.classList.remove("flash");
	hud.money.textContent = "$" + String(Math.floor(money)).padStart(6, "0");
	const kmh = Math.round((player.car ? player.car.speed : 0) * 3.6);
	hud.speed.firstChild.textContent = String(kmh);
	hud.mission.textContent = wanted >= 1 ? "Lose the cops! Get out of their sight." : player.car ? "Cruise Neon Bay. Drift for cash, hit the beach road." : "Find a ride. Walk up to any car and press E.";
	// minimap
	const g = mctx, S = 400, sc = 1.6; g.save(); g.clearRect(0, 0, S, S); g.fillStyle = "#26222e"; g.fillRect(0, 0, S, S);
	g.translate(S / 2, S / 2); g.rotate(Math.PI + camYaw); g.scale(sc, sc); g.translate(-player.x, -player.z);
	g.fillStyle = "#2c7fa8"; g.fillRect(-2000, -2000, 2000 - ROAD / 2 - 46, 4000);
	g.fillStyle = "#f0c890"; g.fillRect(-ROAD / 2 - 46, -2000, 46, 4000);
	for (const b of blocks) { g.fillStyle = b.kind === "downtown" ? "#5a4f74" : b.kind === "mid" ? "#6b5f80" : b.kind === "park" ? "#3f7a46" : "#4f7448"; g.fillRect(b.x0, b.z0, BLOCK, BLOCK); }
	const flash = Math.floor(clock * 6) % 2;
	for (const c of cars) { if (c === player.car) continue; g.fillStyle = c.police ? (flash ? "#ff2040" : "#2060ff") : "#d8d0e8"; const r = c.police ? 4 : 2.2; g.beginPath(); g.arc(c.x, c.z, r, 0, 7); g.fill(); }
	g.translate(player.x, player.z); g.rotate(Math.PI - (player.car ? player.car.h : player.h)); g.scale(1 / sc, 1 / sc);
	g.fillStyle = "#fff"; g.strokeStyle = "#000"; g.lineWidth = 3;
	g.beginPath(); g.moveTo(0, -16); g.lineTo(11, 12); g.lineTo(0, 6); g.lineTo(-11, 12); g.closePath(); g.stroke(); g.fill();
	g.restore();
}

// ---------------------------------------------------------------- loop
function step(dt) {
	clock += dt;
	if (msgT > 0) { msgT -= dt; if (msgT <= 0) hud.msg.classList.remove("show"); }
	updatePlayer(dt);
	for (const c of cars) {
		if (c === player.car) { /* input set */ }
		else if (c.ai && c.driver) aiDrive(c, dt);
		else if (!c.cop) c.input = { throttle: 0, brake: 1, steer: 0, handbrake: 0 };
		c.physics(dt);
		const hit = collideStatic(c, c.radius);
		if (c === player.car && hit > 7) { shake = Math.min(1, shake + hit * 0.05); }
	}
	collideCars();
	for (const c of cars) c.sync(dt);
	updatePolice(dt);
	updatePeds(dt);
	sun.position.set(player.x + SUN_DIR.x * 200, SUN_DIR.y * 200, player.z + SUN_DIR.z * 200); sun.target.position.set(player.x, 0, player.z);
	updateCamera(dt);
}
let last = performance.now();
function frame(now) {
	const dt = Math.min(0.05, (now - last) / 1000); last = now;
	if (started) step(dt);
	else { clock += dt; introCam(camera, clock); }
	renderer.render(scene, camera); drawHud();
	requestAnimationFrame(frame);
}
function introCam(cam, t) {
	const a = t * 0.06 + 2.2, r = 260;
	cam.position.set(CITY / 2 + Math.cos(a) * r, 120, CITY / 2 + Math.sin(a) * r);
	cam.lookAt(CITY / 2, 10, CITY / 2);
}

// ---------------------------------------------------------------- boot
let started = false;
async function boot() {
	await loadModels();
	buildCity();
	for (const k of new Set([...CAR_KEYS, "purple", "moto"])) carProtos[k] = makeCarProto(k);
	makePlayer();
	for (let k = 0; k < 34; k++) { const c = new Car(k % 9 === 0 ? "moto" : pick(CAR_KEYS)); aiStart(c, Math.floor(rr(0, N)), Math.floor(rr(0, N)), Math.floor(rr(0, 4))); if (c.x < -1 || c.z < -1 || c.x > CITY + 1 || c.z > CITY + 1) aiStart(c, 2, 2, 0); }
	for (let k = 0; k < 46; k++) { const p = makeCharacter(pick(PED_TINTS)); peds.push(p); spawnPed(p); p.mixer.update(rr(0, 2)); }
	player.x = nodePos(1) + ROAD / 2 + 1.5; player.z = nodePos(4) + 10; player.h = Math.PI;
	camPos.set(player.x, 6, player.z + 8);
	document.getElementById("loading").textContent = "";
	if (REC) { window.NB = recApi(); return; }
	const go = () => { if (started) return; started = true; document.getElementById("splash").style.display = "none"; };
	document.getElementById("splash").addEventListener("click", go);
	addEventListener("keydown", (e) => { if (e.code === "Enter") go(); });
	requestAnimationFrame(frame);
}

// ---------------------------------------------------------------- recording director
function recApi() {
	// a parked car right next to the player, with a driver inside
	const stolen = new Car("red"); stolen.place(nodePos(1) + LANE, nodePos(4) + 4, Math.PI); stolen.driver = true;
	player.x = nodePos(1) + ROAD / 2 + 2; player.z = nodePos(4) + 12; player.h = Math.PI;
	let t = 0; started = true;
	return {
		duration: 30,
		tick(dt, draw = true) {
			t += dt; director(t, stolen);
			step(dt);
			if (draw) { drawHud(); renderer.render(scene, camera); }
		},
		info() { return { t, wanted, cars: cars.length, x: player.x, z: player.z, inCar: !!player.car }; },
	};
}
function director(t, stolen) {
	// 0-4s drone flyover, 4-6.2 walk to the car, 6.2 steal it, then drive with cops
	if (t < 4.2) {
		recInput = { up: 0, down: 0, left: 0, right: 0, hand: 0 };
		const k = t / 4.2, e = k * k * (3 - 2 * k);
		camOverride = (cam) => {
			cam.position.set(lerp(-70, player.x - 14, e), lerp(150, 8, e), lerp(CITY * 0.25, player.z + 22, e));
			cam.lookAt(lerp(CITY / 2, player.x, e), lerp(20, 1.5, e), lerp(CITY / 2, player.z - 6, e));
			cam.fov = 58; cam.updateProjectionMatrix();
		};
		camPos.copy(camera.position); camLook.set(player.x, 1.5, player.z - 4); camYaw = Math.PI;
		return;
	}
	camOverride = null;
	if (t < 6.2) { recInput = { up: 0, down: 0, left: 0, right: 0, hand: 0, walkTo: [stolen.x + 2.6, stolen.z] }; return; }
	if (!player.car) {
		if (Math.hypot(player.x - stolen.x, player.z - stolen.z) > 4.4) { player.x = stolen.x + 2.6; player.z = stolen.z; }
		pressE = true; recInput = { auto: true };
		updatePlayer(0);
		const c = player.car, sx = c.x, sz = c.z; aiStart(c, 1, 4, 3); c.place(sx, sz, Math.PI); c.max = 38;
	}
	recInput = { auto: true };
	if (t > 9.5 && wanted < 2) addWanted(1);
	if (t > 14 && wanted < 3) addWanted(1);
	if (t > 18.5 && t < 23) {
		const c = player.car;
		camOverride = (cam, dt) => {
			const fx = Math.sin(c.h), fz = Math.cos(c.h);
			const want = new THREE.Vector3(c.x + fz * 7 + fx * 3, 2.2, c.z - fx * 7 + fz * 3);
			cam.position.lerp(want, 1 - Math.exp(-6 * dt)); cam.lookAt(c.x - fx * 4, 1.2, c.z - fz * 4); cam.fov = 60; cam.updateProjectionMatrix();
		};
	} else if (t >= 26) {
		const c = player.car, k = Math.min(1, (t - 26) / 4);
		camOverride = (cam, dt) => {
			cam.position.lerp(new THREE.Vector3(c.x - Math.sin(c.h) * (12 + k * 30), 5 + k * 60, c.z - Math.cos(c.h) * (12 + k * 30)), 1 - Math.exp(-3 * dt));
			cam.lookAt(c.x, 0, c.z);
		};
	}
}

boot().catch((e) => { console.error(e); document.getElementById("loading").textContent = "Failed to load: " + e.message; });
