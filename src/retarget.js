import * as THREE from "three";
import * as SkeletonUtils from "three/addons/utils/SkeletonUtils.js";

// Retarget Mixamo clips (Soldier.glb) onto another humanoid with the same bone names minus the "mixamorig" prefix.
// 1) pose the target's limbs to match the source reference pose (T-pose), 2) bake each frame via world-space deltas.
const strip = (n) => n.replace(/^mixamorig:?/, "");
const LIMBS = [["LeftArm", "LeftForeArm"], ["LeftForeArm", "LeftHand"], ["RightArm", "RightForeArm"], ["RightForeArm", "RightHand"],
	["LeftUpLeg", "LeftLeg"], ["LeftLeg", "LeftFoot"], ["RightUpLeg", "RightLeg"], ["RightLeg", "RightFoot"]];

function bonesOf(root, map = (n) => n) { const out = {}; root.traverse((o) => { if (o.isBone) out[map(o.name)] = o; }); return out; }
function topo(bones) { const list = Object.values(bones); const depth = (b) => { let d = 0, p = b.parent; while (p) { d++; p = p.parent; } return d; }; return list.sort((a, b) => depth(a) - depth(b)); }

export function makeRetargeter(srcScene, srcClips, tgtScene) {
	const src = SkeletonUtils.clone(srcScene);
	const sb = bonesOf(src, strip), tb = bonesOf(tgtScene);
	const names = Object.keys(tb).filter((n) => sb[n]);
	// source reference = TPose clip frame 0 (falls back to bind pose)
	const mixer = new THREE.AnimationMixer(src);
	const tpose = srcClips.find((c) => c.name === "TPose");
	if (tpose) { mixer.clipAction(tpose).play(); mixer.update(0); }
	src.updateMatrixWorld(true);
	// align target limbs with source limb directions
	tgtScene.updateMatrixWorld(true);
	const a = new THREE.Vector3(), b = new THREE.Vector3(), c = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion();
	for (const [bone, child] of LIMBS) {
		if (!tb[bone] || !tb[child] || !sb[bone] || !sb[child]) continue;
		sb[bone].getWorldPosition(a); sb[child].getWorldPosition(b); const want = b.sub(a).normalize();
		tb[bone].getWorldPosition(c); tb[child].getWorldPosition(d); const have = d.sub(c).normalize();
		q.setFromUnitVectors(have, want); // world-space correction
		const wq = tb[bone].getWorldQuaternion(new THREE.Quaternion());
		const newWorld = q.multiply(wq);
		tb[bone].parent.getWorldQuaternion(pq);
		tb[bone].quaternion.copy(pq.invert().multiply(newWorld));
		tgtScene.updateMatrixWorld(true);
	}
	const refS = {}, refT = {};
	for (const n of names) { refS[n] = sb[n].getWorldQuaternion(new THREE.Quaternion()); refT[n] = tb[n].getWorldQuaternion(new THREE.Quaternion()); }
	const tRest = {}; for (const n of names) tRest[n] = tb[n].quaternion.clone();
	const order = topo(Object.fromEntries(names.map((n) => [n, tb[n]])));

	return function retarget(clip, fps = 30) {
		mixer.stopAllAction();
		const act = mixer.clipAction(clip); act.play();
		const frames = Math.max(2, Math.round(clip.duration * fps) + 1);
		const times = new Float32Array(frames);
		const qv = {}; for (const n of names) qv[n] = new Float32Array(frames * 4);
		const W = {}; const tmp = new THREE.Quaternion(), par = new THREE.Quaternion();
		for (let f = 0; f < frames; f++) {
			const t = Math.min(clip.duration, f / fps); times[f] = t;
			mixer.setTime(t); src.updateMatrixWorld(true);
			for (const bone of order) {
				const n = names.find((k) => tb[k] === bone);
				const ws = sb[n].getWorldQuaternion(tmp);
				const delta = ws.clone().multiply(refS[n].clone().invert());
				W[n] = delta.multiply(refT[n]);
				// parent world (target): either a retargeted bone or the bone's static parent chain
				const p = bone.parent; const pn = names.find((k) => tb[k] === p);
				if (pn) par.copy(W[pn]); else p.getWorldQuaternion(par);
				const local = par.clone().invert().multiply(W[n]);
				local.toArray(qv[n], f * 4);
			}
		}
		const tracks = names.map((n) => new THREE.QuaternionKeyframeTrack(`${tb[n].name}.quaternion`, times, qv[n]));
		act.stop();
		return new THREE.AnimationClip(clip.name, clip.duration, tracks);
	};
}

// A relaxed standing pose built from the model's own rest pose with the arms lowered, plus slow breathing.
export function makeIdleClip(tgtScene) {
	const m = SkeletonUtils.clone(tgtScene); m.updateMatrixWorld(true);
	const tb = bonesOf(m);
	const c = new THREE.Vector3(), d = new THREE.Vector3(), q = new THREE.Quaternion(), pq = new THREE.Quaternion();
	for (const [bone, child, dir] of [["LeftArm", "LeftForeArm", new THREE.Vector3(0.16, -1, 0.04)], ["RightArm", "RightForeArm", new THREE.Vector3(-0.16, -1, 0.04)],
		["LeftForeArm", "LeftHand", new THREE.Vector3(0.05, -1, 0.18)], ["RightForeArm", "RightHand", new THREE.Vector3(-0.05, -1, 0.18)]]) {
		if (!tb[bone] || !tb[child]) continue;
		tb[bone].getWorldPosition(c); tb[child].getWorldPosition(d);
		q.setFromUnitVectors(d.sub(c).normalize(), dir.normalize());
		const nw = q.multiply(tb[bone].getWorldQuaternion(new THREE.Quaternion()));
		tb[bone].parent.getWorldQuaternion(pq); tb[bone].quaternion.copy(pq.invert().multiply(nw)); m.updateMatrixWorld(true);
	}
	const tracks = [];
	for (const [n, b] of Object.entries(tb)) {
		const q0 = b.quaternion.clone();
		if (n === "Spine1" || n === "Spine") {
			const q1 = q0.clone().multiply(new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(1, 0, 0), -0.025));
			tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0, 1.6, 3.2], [...q0.toArray(), ...q1.toArray(), ...q0.toArray()]));
		} else tracks.push(new THREE.QuaternionKeyframeTrack(`${b.name}.quaternion`, [0], q0.toArray()));
	}
	return new THREE.AnimationClip("Idle", 3.2, tracks);
}
