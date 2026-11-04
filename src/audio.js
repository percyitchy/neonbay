// All sound is synthesized with Web Audio: no audio files, no licensing issues.

export function createAudio() {
	const Ctx = window.AudioContext || window.webkitAudioContext;
	if (!Ctx) return null;
	const ctx = new Ctx();
	const master = ctx.createGain(); master.gain.value = 0.9;
	const comp = ctx.createDynamicsCompressor(); comp.threshold.value = -14; comp.ratio.value = 4;
	master.connect(comp).connect(ctx.destination);
	const musicBus = ctx.createGain(); musicBus.gain.value = 0.32; musicBus.connect(master);
	const sfxBus = ctx.createGain(); sfxBus.gain.value = 0.8; sfxBus.connect(master);

	// shared noise buffer
	const noiseBuf = ctx.createBuffer(1, ctx.sampleRate * 2, ctx.sampleRate);
	{ const d = noiseBuf.getChannelData(0); for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1; }
	const noise = (loop = true) => { const s = ctx.createBufferSource(); s.buffer = noiseBuf; s.loop = loop; return s; };

	// reverb impulse
	const reverb = ctx.createConvolver();
	{ const len = ctx.sampleRate * 2.4, b = ctx.createBuffer(2, len, ctx.sampleRate); for (let c = 0; c < 2; c++) { const d = b.getChannelData(c); for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3); } reverb.buffer = b; }
	const revGain = ctx.createGain(); revGain.gain.value = 0.35; reverb.connect(revGain).connect(musicBus);
	const delay = ctx.createDelay(1); delay.delayTime.value = 0.45; const fb = ctx.createGain(); fb.gain.value = 0.35;
	const delayOut = ctx.createGain(); delayOut.gain.value = 0.3; delay.connect(fb).connect(delay); delay.connect(delayOut).connect(musicBus);

	// ------------------------------------------------------------ music (synthwave, A minor, 100 bpm)
	const BPM = 100, STEP = 60 / BPM / 4;
	const midi = (n) => 440 * Math.pow(2, (n - 69) / 12);
	const CHORDS = [[57, 60, 64], [53, 57, 60], [48, 52, 55], [55, 59, 62]]; // Am F C G
	const BASS = [45, 41, 36, 43];
	let musicOn = true, step = 0, nextT = 0, timer = null;
	function env(g, t, a, peak, d) { g.gain.setValueAtTime(0.0001, t); g.gain.exponentialRampToValueAtTime(peak, t + a); g.gain.exponentialRampToValueAtTime(0.0001, t + a + d); }
	function kick(t) { const o = ctx.createOscillator(), g = ctx.createGain(); o.frequency.setValueAtTime(140, t); o.frequency.exponentialRampToValueAtTime(42, t + 0.12); env(g, t, 0.003, 0.9, 0.32); o.connect(g).connect(musicBus); o.start(t); o.stop(t + 0.4); }
	function snare(t) {
		const n = noise(false), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = "bandpass"; f.frequency.value = 1800; f.Q.value = 0.7;
		env(g, t, 0.002, 0.5, 0.22); n.connect(f).connect(g); g.connect(musicBus); g.connect(reverb); n.start(t); n.stop(t + 0.3);
		const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.value = 190; env(og, t, 0.002, 0.25, 0.1); o.connect(og).connect(musicBus); o.start(t); o.stop(t + 0.15);
	}
	function hat(t, v) { const n = noise(false), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = "highpass"; f.frequency.value = 8000; env(g, t, 0.001, v, 0.05); n.connect(f).connect(g).connect(musicBus); n.start(t); n.stop(t + 0.08); }
	function bass(t, note) {
		const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = "sawtooth"; o.frequency.value = midi(note);
		f.type = "lowpass"; f.frequency.setValueAtTime(900, t); f.frequency.exponentialRampToValueAtTime(220, t + 0.2); f.Q.value = 6;
		env(g, t, 0.005, 0.32, STEP * 1.8); o.connect(f).connect(g).connect(musicBus); o.start(t); o.stop(t + STEP * 2.2);
	}
	function pad(t, chord, dur) {
		const f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = "lowpass"; f.frequency.value = 1600;
		g.gain.setValueAtTime(0.0001, t); g.gain.linearRampToValueAtTime(0.06, t + 0.6); g.gain.linearRampToValueAtTime(0.0001, t + dur);
		f.connect(g); g.connect(musicBus); g.connect(reverb);
		for (const n of chord) for (const det of [-9, 9]) { const o = ctx.createOscillator(); o.type = "sawtooth"; o.frequency.value = midi(n + 12); o.detune.value = det; o.connect(f); o.start(t); o.stop(t + dur + 0.1); }
	}
	function arp(t, note) {
		const o = ctx.createOscillator(), f = ctx.createBiquadFilter(), g = ctx.createGain(); o.type = "square"; o.frequency.value = midi(note);
		f.type = "lowpass"; f.frequency.value = 2600; env(g, t, 0.003, 0.07, 0.16);
		o.connect(f).connect(g); g.connect(musicBus); g.connect(delay); o.start(t); o.stop(t + 0.2);
	}
	function schedule() {
		while (nextT < ctx.currentTime + 0.15) {
			if (musicOn) {
				const bar = Math.floor(step / 16) % 4, s = step % 16, chord = CHORDS[bar];
				if (s % 4 === 0) kick(nextT);
				if (s === 4 || s === 12) snare(nextT);
				hat(nextT, s % 2 ? 0.05 : 0.12);
				if (s % 2 === 0) bass(nextT, BASS[bar] + (s % 8 === 6 ? 12 : 0));
				if (s === 0) pad(nextT, chord, STEP * 16);
				if (step >= 64) arp(nextT, chord[[0, 1, 2, 1][s % 4]] + 12 + (s >= 8 ? 12 : 0));
			}
			step++; nextT += STEP;
		}
	}

	// ------------------------------------------------------------ loops: engine, tyres, siren, waves
	const engA = ctx.createOscillator(), engB = ctx.createOscillator(), engF = ctx.createBiquadFilter(), engG = ctx.createGain();
	engA.type = "sawtooth"; engB.type = "square"; engF.type = "lowpass"; engF.frequency.value = 600; engF.Q.value = 3; engG.gain.value = 0;
	engA.connect(engF); engB.connect(engF); engF.connect(engG).connect(sfxBus);
	const tyre = noise(), tyreF = ctx.createBiquadFilter(), tyreG = ctx.createGain(); tyreF.type = "bandpass"; tyreF.frequency.value = 2100; tyreF.Q.value = 4; tyreG.gain.value = 0;
	tyre.connect(tyreF).connect(tyreG).connect(sfxBus);
	const sir = ctx.createOscillator(), sirG = ctx.createGain(); sir.type = "triangle"; sirG.gain.value = 0; sir.connect(sirG).connect(sfxBus);
	const wave = noise(), waveF = ctx.createBiquadFilter(), waveG = ctx.createGain(); waveF.type = "lowpass"; waveF.frequency.value = 500; waveG.gain.value = 0;
	wave.connect(waveF).connect(waveG).connect(sfxBus);
	let started = false;

	const api = {
		start() {
			if (started) { ctx.resume(); return; }
			started = true; ctx.resume();
			for (const s of [engA, engB, tyre, sir, wave]) s.start();
			nextT = ctx.currentTime + 0.1; timer = setInterval(schedule, 25);
		},
		toggleMusic() { musicOn = !musicOn; return musicOn; },
		toggleMute() { master.gain.value = master.gain.value > 0 ? 0 : 0.9; return master.gain.value > 0; },
		update({ inCar, speed, throttle, slip, copDist, beachDist, time }) {
			if (!started) return;
			const t = ctx.currentTime, k = 0.08;
			const rpm = inCar ? 0.25 + (speed % 9) / 9 * 0.75 * Math.min(1, speed / 6) + throttle * 0.15 : 0;
			const f = 38 + speed * 2.6 + rpm * 40;
			engA.frequency.setTargetAtTime(f, t, k); engB.frequency.setTargetAtTime(f * 0.5, t, k);
			engF.frequency.setTargetAtTime(300 + rpm * 900 + throttle * 600, t, k);
			engG.gain.setTargetAtTime(inCar ? 0.05 + throttle * 0.07 + Math.min(speed, 40) * 0.0012 : 0, t, 0.1);
			tyreG.gain.setTargetAtTime(inCar && slip > 4 && speed > 6 ? Math.min(0.22, (slip - 4) * 0.03) : 0, t, 0.05);
			const sv = copDist < 160 ? Math.pow(1 - copDist / 160, 2) * 0.11 : 0;
			sir.frequency.setTargetAtTime(Math.sin(time * 4.2) > 0 ? 960 : 700, t, 0.03); sirG.gain.setTargetAtTime(sv, t, 0.2);
			const wv = beachDist < 70 ? (1 - beachDist / 70) * (0.05 + 0.04 * Math.sin(time * 0.7)) : 0;
			waveG.gain.setTargetAtTime(Math.max(0, wv), t, 0.4);
		},
		crash(strength) {
			if (!started) return;
			const t = ctx.currentTime, v = Math.min(1, strength / 20);
			const n = noise(false), f = ctx.createBiquadFilter(), g = ctx.createGain(); f.type = "lowpass"; f.frequency.value = 1400;
			env(g, t, 0.002, 0.25 + v * 0.5, 0.35); n.connect(f).connect(g).connect(sfxBus); n.start(t); n.stop(t + 0.5);
			const o = ctx.createOscillator(), og = ctx.createGain(); o.frequency.setValueAtTime(110, t); o.frequency.exponentialRampToValueAtTime(40, t + 0.2);
			env(og, t, 0.002, 0.4 + v * 0.4, 0.25); o.connect(og).connect(sfxBus); o.start(t); o.stop(t + 0.3);
		},
		sting(kind) {
			if (!started) return;
			const t = ctx.currentTime;
			const seqs = { jack: [64, 69], star: [76, 72], lost: [64, 67, 71, 76], busted: [64, 60, 57, 52] };
			(seqs[kind] || seqs.star).forEach((n, i) => {
				const o = ctx.createOscillator(), g = ctx.createGain(); o.type = "square"; o.frequency.value = midi(n);
				env(g, t + i * 0.11, 0.005, 0.12, 0.18); o.connect(g); g.connect(sfxBus); o.start(t + i * 0.11); o.stop(t + i * 0.11 + 0.25);
			});
		},
	};
	return api;
}
