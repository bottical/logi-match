(function () {
  const SOUND_PATHS = {
    scan: './sounds/scan.mp3',
    complete: './sounds/complete.mp3',
    error: './sounds/error.mp3',
  };

  const cache = {};
  let unlocked = false;

  function createAudio(src) {
    const audio = new Audio(src);
    audio.preload = 'auto';
    audio.volume = 1.0;
    return audio;
  }

  function getAudio(type) {
    if (!cache[type]) {
      cache[type] = createAudio(SOUND_PATHS[type]);
    }
    return cache[type];
  }

  async function play(type) {
    try {
      const base = getAudio(type);
      const audio = base.cloneNode(true);
      audio.volume = base.volume;
      audio.currentTime = 0;
      await audio.play();
    } catch (_) {
      // ignore playback errors
    }
  }

  async function unlock() {
    if (unlocked) return;

    try {
      await Promise.all(
        Object.keys(SOUND_PATHS).map(async (type) => {
          const audio = getAudio(type);
          audio.muted = true;
          await audio.play();
          audio.pause();
          audio.currentTime = 0;
          audio.muted = false;
        })
      );
      unlocked = true;
    } catch (_) {
      unlocked = false;
      // ignore unlock failures
    }
  }

  ['click', 'keydown', 'touchstart', 'pointerdown'].forEach((eventName) => {
    window.addEventListener(eventName, unlock, { passive: true });
  });

  window.inspectionAudio = {
    unlock,
    playScan: () => {
      void play('scan');
    },
    playComplete: () => {
      void play('complete');
    },
    playError: () => {
      void play('error');
    },
  };
})();
