(function (root, factory) {
  'use strict';
  const api = factory(root);
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.GasGuardAlarm = api;
})(typeof window === 'undefined' ? globalThis : window, function (root) {
  'use strict';

  // Alarm sounds, vibration and system notifications by safety level.
  //   watch   (yellow): one soft chime
  //   warning (orange): two beeps every 6 s until acknowledged
  //   danger  (red):    siren every 1.1 s + strong vibration until acknowledged
  // Browsers only allow sound after the user has touched the page once, so enable() must run from a tap.
  // Vibration works on Android browsers only; iOS Safari ignores navigator.vibrate.
  const PREF_KEY = 'gasguard.alarm.sound';

  function create(storage) {
    let ctx = null, loop = null, lastRank = -1, ackRank = -1;
    const wanted = () => { try { return storage && storage.getItem(PREF_KEY) === 'on'; } catch (e) { return false; } };
    const remember = on => { try { storage && storage.setItem(PREF_KEY, on ? 'on' : 'off'); } catch (e) { /* storage blocked */ } };

    function audio() {
      if (!ctx) { const A = root.AudioContext || root.webkitAudioContext; if (!A) return null; ctx = new A(); }
      if (ctx.state === 'suspended') ctx.resume().catch(() => {});
      return ctx;
    }
    function tone(freq, start, dur, type = 'sine', gain = 0.1, toFreq) {
      const c = audio();
      if (!c || c.state !== 'running') return;
      const o = c.createOscillator(), g = c.createGain(), t0 = c.currentTime + start;
      o.type = type; o.frequency.setValueAtTime(freq, t0);
      if (toFreq) o.frequency.linearRampToValueAtTime(toFreq, t0 + dur);
      g.gain.setValueAtTime(0.0001, t0); g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02); g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
      o.connect(g).connect(c.destination); o.start(t0); o.stop(t0 + dur + 0.05);
    }
    const vibrate = p => { try { root.navigator && root.navigator.vibrate && root.navigator.vibrate(p); } catch (e) { /* unsupported */ } };
    const SOUNDS = {
      watch: () => { tone(880, 0, 0.18, 'sine', 0.07); tone(1320, 0.2, 0.25, 'sine', 0.06); vibrate(150); },
      warning: () => { tone(740, 0, 0.16, 'square', 0.09); tone(740, 0.24, 0.16, 'square', 0.09); vibrate([300, 150, 300]); },
      danger: () => { tone(650, 0, 0.45, 'sawtooth', 0.16, 1250); tone(1250, 0.47, 0.45, 'sawtooth', 0.16, 650); vibrate([700, 150, 700]); }
    };
    const stopLoop = () => { if (loop) { clearInterval(loop); loop = null; } };

    function notify(level) {
      try {
        if (!root.Notification || root.Notification.permission !== 'granted') return;
        new root.Notification(`GasGuard: ${level.label}`, { body: `${level.headline} — ${level.actions[0]}`, tag: 'gasguard-level', renotify: true, requireInteraction: level.key === 'danger' });
      } catch (e) { /* some mobile browsers only allow notifications from a service worker */ }
    }

    return {
      wantsSound: wanted,
      soundOn: () => wanted() && ctx != null && ctx.state === 'running',
      notificationState: () => (root.Notification ? root.Notification.permission : 'unsupported'),
      enable() {
        remember(true);
        audio();
        tone(880, 0, 0.12, 'sine', 0.05);
        try { if (root.Notification && root.Notification.permission === 'default') return root.Notification.requestPermission(); } catch (e) { /* ignore */ }
        return Promise.resolve();
      },
      disable() { remember(false); stopLoop(); },
      resumeIfWanted() { if (wanted()) audio(); },
      alarming: () => loop != null,
      acknowledge() { ackRank = lastRank; stopLoop(); },
      stop: stopLoop,
      // Plays the red-level siren twice so people can check the volume.
      test() { audio(); SOUNDS.danger(); setTimeout(SOUNDS.danger, 1100); },
      // Called with every assessment; starts or stops sounds when the level changes.
      update(level) {
        const rank = level.rank;
        if (rank < ackRank) ackRank = -1; // dropped below the silenced level: arm again
        if (rank === lastRank) return;
        stopLoop();
        if (rank > lastRank && rank >= 1) {
          if (wanted() && SOUNDS[level.key]) SOUNDS[level.key]();
          notify(level);
        }
        if (rank >= 2 && rank > ackRank) loop = setInterval(() => { if (wanted()) SOUNDS[level.key](); }, level.key === 'danger' ? 1100 : 6000);
        lastRank = rank;
      }
    };
  }

  return Object.freeze({ create });
});
