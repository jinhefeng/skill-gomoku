class SoundManager {
    constructor() {
        this.ctx = new (window.AudioContext || window.webkitAudioContext)();
        this.masterGain = this.ctx.createGain();
        this.masterGain.gain.value = 0.3;
        this.masterGain.connect(this.ctx.destination);
    }
    resume() { if (this.ctx.state === 'suspended') this.ctx.resume(); }
    playTone(freq, type, duration, vol = 0.1, startTime = 0) {
        const osc = this.ctx.createOscillator();
        const gain = this.ctx.createGain();
        osc.type = type;
        osc.frequency.setValueAtTime(freq, this.ctx.currentTime + startTime);
        gain.gain.setValueAtTime(0, this.ctx.currentTime + startTime);
        gain.gain.linearRampToValueAtTime(vol, this.ctx.currentTime + startTime + 0.01);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + startTime + duration);
        osc.connect(gain);
        gain.connect(this.masterGain);
        osc.start(this.ctx.currentTime + startTime);
        osc.stop(this.ctx.currentTime + startTime + duration);
    }
    playNoise(duration, vol = 0.1) {
        const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0);
        for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource();
        noise.buffer = buffer;
        const gain = this.ctx.createGain();
        const filter = this.ctx.createBiquadFilter();
        filter.type = 'bandpass'; filter.frequency.value = 1000; filter.Q.value = 1;
        gain.gain.setValueAtTime(vol, this.ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, this.ctx.currentTime + duration);
        noise.connect(filter); filter.connect(gain); gain.connect(this.masterGain);
        noise.start();
    }
    playPlace() { this.playTone(800, 'sine', 0.1, 0.2); setTimeout(() => this.playTone(1200, 'sine', 0.05, 0.1), 50); }
    playBeep() { this.playTone(440, 'square', 0.1, 0.1); }
    playSand() {
        this.resume();
        const duration = 1.5; const bufferSize = this.ctx.sampleRate * duration;
        const buffer = this.ctx.createBuffer(1, bufferSize, this.ctx.sampleRate);
        const data = buffer.getChannelData(0); for (let i = 0; i < bufferSize; i++) data[i] = Math.random() * 2 - 1;
        const noise = this.ctx.createBufferSource(); noise.buffer = buffer;
        const filter = this.ctx.createBiquadFilter(); filter.type = 'bandpass'; filter.Q.value = 1;
        filter.frequency.setValueAtTime(200, this.ctx.currentTime); filter.frequency.linearRampToValueAtTime(1200, this.ctx.currentTime + 0.8); filter.frequency.linearRampToValueAtTime(400, this.ctx.currentTime + 1.5);
        const gain = this.ctx.createGain(); gain.gain.setValueAtTime(0, this.ctx.currentTime); gain.gain.linearRampToValueAtTime(0.4, this.ctx.currentTime + 0.2); gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 1.5);
        noise.connect(filter); filter.connect(gain); gain.connect(this.masterGain); noise.start();
    }
    playTime() {
        this.resume();
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain(); osc.type = 'sine';
        osc.frequency.setValueAtTime(200, this.ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(800, this.ctx.currentTime + 0.4);
        const lfo = this.ctx.createOscillator(); lfo.frequency.value = 15; const lfoGain = this.ctx.createGain(); lfoGain.gain.value = 50;
        lfo.connect(lfoGain); lfoGain.connect(osc.frequency); lfo.start();
        gain.gain.setValueAtTime(0, this.ctx.currentTime); gain.gain.linearRampToValueAtTime(0.3, this.ctx.currentTime + 0.1); gain.gain.linearRampToValueAtTime(0, this.ctx.currentTime + 0.5);
        osc.connect(gain); gain.connect(this.masterGain); osc.start(); osc.stop(this.ctx.currentTime + 0.5); lfo.stop(this.ctx.currentTime + 0.5);
    }
    playStrength() {
        this.resume();
        const osc = this.ctx.createOscillator(); const gain = this.ctx.createGain(); osc.type = 'sine';
        osc.frequency.setValueAtTime(150, this.ctx.currentTime); osc.frequency.exponentialRampToValueAtTime(40, this.ctx.currentTime + 0.5);
        gain.gain.setValueAtTime(0.8, this.ctx.currentTime); gain.gain.exponentialRampToValueAtTime(0.01, this.ctx.currentTime + 0.5);
        osc.connect(gain); gain.connect(this.masterGain); osc.start(); osc.stop(this.ctx.currentTime + 0.5);
        this.playNoise(0.3, 0.4);
    }
    playGameStart() { this.resume(); [440, 554, 659, 880].forEach((f, i) => this.playTone(f, 'sine', 0.3, 0.2, i * 0.1)); }
    playWin() {
        this.resume();
        [523.25, 659.25, 783.99, 1046.50].forEach((f, i) => this.playTone(f, 'triangle', 0.4, 0.3, i * 0.15));
        setTimeout(() => { this.playTone(523.25, 'sine', 1.0, 0.2); this.playTone(659.25, 'sine', 1.0, 0.2); this.playTone(783.99, 'sine', 1.0, 0.2); }, 600);
    }
    playLoss() {
        this.resume();
        [783.99, 659.25, 523.25].forEach((f, i) => this.playTone(f, 'sine', 0.6, 0.2, i * 0.4));
        setTimeout(() => { this.playTone(130, 'sawtooth', 1.0, 0.2); this.playTone(123, 'sawtooth', 1.0, 0.2); }, 1200);
    }
}
window.SoundManager = SoundManager;
