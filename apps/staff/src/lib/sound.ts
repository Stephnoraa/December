/** Short two-tone alert. Browsers only allow audio after a user gesture, so call unlock() on a tap first. */
let ctx: AudioContext | null = null;

export function unlockAudio(): boolean {
  try {
    const Ctor =
      window.AudioContext ??
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!Ctor) return false;
    ctx ??= new Ctor();
    void ctx.resume();
    return true;
  } catch {
    return false;
  }
}

export function chime(): void {
  if (!ctx || ctx.state !== 'running') return;
  const now = ctx.currentTime;
  [880, 1320].forEach((freq, i) => {
    const osc = ctx!.createOscillator();
    const gain = ctx!.createGain();
    osc.frequency.value = freq;
    osc.type = 'sine';
    gain.gain.setValueAtTime(0.0001, now + i * 0.18);
    gain.gain.exponentialRampToValueAtTime(0.4, now + i * 0.18 + 0.02);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + i * 0.18 + 0.3);
    osc.connect(gain).connect(ctx!.destination);
    osc.start(now + i * 0.18);
    osc.stop(now + i * 0.18 + 0.32);
  });
}
