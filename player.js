/**
 * SHOW VERSE - Video Player Controller (player.js)
 * Fullscreen / Landscape Controls & Screen Lock Engine
 */

// Player State
export let isLocked = false;
export let isAmbientOn = true;
export let activeHls = null;
let unlockFadeTimer = null;
let controlsFadeTimer = null;

const FALLBACK_STREAM = 'https://vjs.zencdn.net/v/oceans.mp4';

// Cache elements
function getElements() {
  return {
    modal: document.getElementById('playerModal'),
    video: document.getElementById('mainVideo'),
    stage: document.getElementById('playerStage'),
    stageContainer: document.getElementById('playerStageContainer'),
    topBar: document.getElementById('playerTopBar'),
    bottomBar: document.getElementById('playerBottomBar'),
    smallUnlockBtn: document.getElementById('smallUnlockBtn'),
    progressBar: document.getElementById('progressBar'),
    bufferedBar: document.getElementById('bufferedBar'),
    timeDisplay: document.getElementById('timeDisplay'),
    scrubContainer: document.getElementById('scrubContainer'),
    playIcon: document.getElementById('playIcon'),
    volumeIcon: document.getElementById('volumeIcon'),
    volumeSlider: document.getElementById('volumeSlider'),
    ambientToggleBtn: document.getElementById('ambientToggleBtn'),
    fullscreenBtn: document.getElementById('fullscreenBtn'),
    qualityModal: document.getElementById('qualityModal'),
    audioSubModal: document.getElementById('audioSubModal')
  };
}

// ========================================================
// 1. FULLSCREEN & LANDSCAPE CONTROLS ENGINE
// ========================================================

/**
 * Request or exit fullscreen on the ENTIRE player container (#playerModal)
 * so that all custom controls (top bar, transport, progress bar, audio/cc, quality)
 * remain visible and interactive above the video stream.
 */
export function toggleFullscreen() {
  const { modal } = getElements();
  if (!modal) return;

  const isFullscreen = !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );

  if (!isFullscreen) {
    if (modal.requestFullscreen) {
      modal.requestFullscreen().catch(err => {
        console.warn("Fullscreen request error:", err ? (err.message || String(err)) : "Error");
      });
    } else if (modal.webkitRequestFullscreen) {
      modal.webkitRequestFullscreen();
    } else if (modal.mozRequestFullScreen) {
      modal.mozRequestFullScreen();
    } else if (modal.msRequestFullscreen) {
      modal.msRequestFullscreen();
    }
  } else {
    if (document.exitFullscreen) {
      document.exitFullscreen().catch(err => {});
    } else if (document.webkitExitFullscreen) {
      document.webkitExitFullscreen();
    } else if (document.mozCancelFullScreen) {
      document.mozCancelFullScreen();
    } else if (document.msExitFullscreen) {
      document.msExitFullscreen();
    }
  }
}

/**
 * Handle browser fullscreen changes across vendors
 */
export function handleFullscreenChange() {
  const isFs = !!(
    document.fullscreenElement ||
    document.webkitFullscreenElement ||
    document.mozFullScreenElement ||
    document.msFullscreenElement
  );

  const { modal, fullscreenBtn } = getElements();
  if (modal) {
    modal.classList.toggle('is-fullscreen', isFs);
  }

  if (fullscreenBtn) {
    fullscreenBtn.innerHTML = isFs
      ? `<i data-lucide="minimize" class="w-4 h-4"></i>`
      : `<i data-lucide="maximize" class="w-4 h-4"></i>`;
    fullscreenBtn.title = isFs ? "Exit Fullscreen" : "Fullscreen";
    if (window.lucide) window.lucide.createIcons();
  }
}

// Attach fullscreen listeners
document.addEventListener('fullscreenchange', handleFullscreenChange);
document.addEventListener('webkitfullscreenchange', handleFullscreenChange);
document.addEventListener('mozfullscreenchange', handleFullscreenChange);
document.addEventListener('MSFullscreenChange', handleFullscreenChange);

// ========================================================
// 2. REDESIGNED LOCK SCREEN BEHAVIOR
// ========================================================

/**
 * Lock Screen:
 * - Hides all main player controls (top bar, bottom bar, modals)
 * - Shows small semi-transparent unlock button on the corner for 3s
 * - No massive center overlay blocking the video
 */
export function toggleLockScreen() {
  isLocked = true;
  const { topBar, bottomBar, qualityModal, audioSubModal } = getElements();

  if (topBar) topBar.classList.add('hidden');
  if (bottomBar) bottomBar.classList.add('hidden');
  if (qualityModal) qualityModal.classList.add('hidden');
  if (audioSubModal) audioSubModal.classList.add('hidden');

  showSmallUnlockBriefly();
  if (window.showToast) {
    window.showToast("Screen Controls Locked 🔒");
  }
}

/**
 * Unlock Screen:
 * - Restores main player controls
 * - Hides small unlock button
 */
export function unlockScreen(e) {
  if (e) {
    e.preventDefault();
    e.stopPropagation();
  }
  isLocked = false;
  if (unlockFadeTimer) {
    clearTimeout(unlockFadeTimer);
    unlockFadeTimer = null;
  }

  const { topBar, bottomBar, smallUnlockBtn } = getElements();
  if (smallUnlockBtn) {
    smallUnlockBtn.classList.remove('opacity-100', 'pointer-events-auto');
    smallUnlockBtn.classList.add('opacity-0', 'pointer-events-none');
  }

  if (topBar) topBar.classList.remove('hidden');
  if (bottomBar) bottomBar.classList.remove('hidden');

  if (window.showToast) {
    window.showToast("Screen Unlocked 🔓");
  }
  if (window.lucide) window.lucide.createIcons();
}

/**
 * Flash the small unlock icon quietly on the corner for 3 seconds
 */
export function showSmallUnlockBriefly() {
  const { smallUnlockBtn } = getElements();
  if (!smallUnlockBtn) return;

  smallUnlockBtn.classList.remove('hidden', 'opacity-0', 'pointer-events-none');
  smallUnlockBtn.classList.add('opacity-100', 'pointer-events-auto');

  if (unlockFadeTimer) clearTimeout(unlockFadeTimer);
  unlockFadeTimer = setTimeout(() => {
    if (isLocked) {
      smallUnlockBtn.classList.remove('opacity-100', 'pointer-events-auto');
      smallUnlockBtn.classList.add('opacity-0', 'pointer-events-none');
    }
  }, 3000);
}

let lastTapTime = 0;
let lastTapX = 0;
let singleTapTimeout = null;
let playerSkipAnimTimeout = null;

export function triggerPlayerSkipAnimation(seconds) {
  const isForward = seconds > 0;
  const leftEl = document.getElementById('playerSkipLeftIndicator');
  const rightEl = document.getElementById('playerSkipRightIndicator');
  const targetEl = isForward ? rightEl : leftEl;
  const otherEl = isForward ? leftEl : rightEl;
  const textEl = document.getElementById(isForward ? 'playerSkipRightText' : 'playerSkipLeftText');

  if (otherEl) {
    otherEl.classList.remove('animate-skip-left', 'animate-skip-right');
  }

  if (targetEl) {
    if (textEl) textEl.innerText = `${isForward ? '+' : ''}${seconds}s`;
    targetEl.classList.remove('animate-skip-left', 'animate-skip-right');
    // Force reflow
    void targetEl.offsetWidth;
    targetEl.classList.add(isForward ? 'animate-skip-right' : 'animate-skip-left');

    if (playerSkipAnimTimeout) clearTimeout(playerSkipAnimTimeout);
    playerSkipAnimTimeout = setTimeout(() => {
      targetEl.classList.remove('animate-skip-left', 'animate-skip-right');
    }, 650);
  }
}

/**
 * Handle taps on the screen / stage:
 * - If locked: only fade in/out the small unlock icon for 3 seconds
 * - Unlocked: Double-tap on left/right half triggers smooth +/-10s skip animation
 * - Single tap: toggles play/pause
 */
export function handlePlayerScreenTap(e) {
  // Ignore clicks on buttons, inputs, links, or scrub progress bar
  if (e.target.closest('button, input, select, a, #scrubContainer, #smallUnlockBtn, .glass-card, #playerTopBar, #playerBottomBar')) {
    return;
  }

  if (isLocked) {
    e.preventDefault();
    e.stopPropagation();
    showSmallUnlockBriefly();
    return;
  }

  const now = Date.now();
  const tapDelay = now - lastTapTime;
  const rect = (e.currentTarget || document.getElementById('playerStageContainer')).getBoundingClientRect();
  const tapX = e.clientX - rect.left;
  const width = rect.width;

  if (tapDelay < 320 && Math.abs(tapX - lastTapX) < 120) {
    // DOUBLE-TAP DETECTED
    if (singleTapTimeout) {
      clearTimeout(singleTapTimeout);
      singleTapTimeout = null;
    }
    lastTapTime = 0;

    if (tapX < width * 0.42) {
      // Left side double-tap -> Rewind 10s
      skipTime(-10);
    } else if (tapX > width * 0.58) {
      // Right side double-tap -> Forward 10s
      skipTime(10);
    } else {
      // Center double tap toggles play
      togglePlay();
    }
  } else {
    // Potential single tap
    lastTapTime = now;
    lastTapX = tapX;
    if (singleTapTimeout) clearTimeout(singleTapTimeout);
    singleTapTimeout = setTimeout(() => {
      togglePlay();
      singleTapTimeout = null;
    }, 280);
  }
}

// ========================================================
// 3. PLAYBACK & CONTROLS HELPERS
// ========================================================

export function togglePlay() {
  const { video } = getElements();
  if (!video) return;

  if (video.paused) {
    video.play();
    updatePlayIcon(true);
  } else {
    video.pause();
    updatePlayIcon(false);
  }
}

export function updatePlayIcon(isPlaying) {
  const { playIcon } = getElements();
  if (playIcon) {
    playIcon.setAttribute('data-lucide', isPlaying ? 'pause' : 'play');
    if (window.lucide) window.lucide.createIcons();
  }
}

export function skipTime(seconds) {
  const { video } = getElements();
  if (!video) return;
  const duration = video.duration;
  const current = video.currentTime;
  if (!Number.isFinite(duration) || duration <= 0 || !Number.isFinite(current)) return;
  const targetTime = Math.max(0, Math.min(duration, current + Number(seconds)));
  video.currentTime = targetTime;
  if (window.saveContinueWatchingProgress) {
    window.saveContinueWatchingProgress(targetTime, duration);
  }
  // Trigger in-player frame skip animation overlay
  triggerPlayerSkipAnimation(seconds);
}

export function seekVideo(e) {
  const { video, scrubContainer } = getElements();
  if (!video || !scrubContainer) return;
  const duration = video.duration;
  if (!Number.isFinite(duration) || duration <= 0) return;
  const rect = scrubContainer.getBoundingClientRect();
  if (!rect.width) return;
  const pos = Math.max(0, Math.min(1, (e.clientX - rect.left) / rect.width));
  const targetTime = pos * duration;
  video.currentTime = targetTime;
  if (window.saveContinueWatchingProgress) {
    window.saveContinueWatchingProgress(targetTime, duration);
  }
}

export function changeVolume(val) {
  const { video, volumeIcon } = getElements();
  if (!video) return;
  video.volume = Number(val);
  if (volumeIcon) {
    volumeIcon.setAttribute('data-lucide', Number(val) === 0 ? 'volume-x' : 'volume-2');
    if (window.lucide) window.lucide.createIcons();
  }
}

export function toggleMute() {
  const { video, volumeSlider } = getElements();
  if (!video) return;
  video.muted = !video.muted;
  changeVolume(video.muted ? 0 : 1);
  if (volumeSlider) volumeSlider.value = video.muted ? 0 : 1;
}

export function toggleAmbientLighting() {
  const { stage, ambientToggleBtn } = getElements();
  isAmbientOn = !isAmbientOn;
  if (stage) {
    stage.classList.toggle('ambient-glow-box', isAmbientOn);
  }
  if (ambientToggleBtn) {
    ambientToggleBtn.innerHTML = isAmbientOn
      ? `<i data-lucide="sun" class="w-4 h-4"></i> <span class="hidden sm:inline">Ambient Glow: ON</span>`
      : `<i data-lucide="moon" class="w-4 h-4"></i> <span class="hidden sm:inline">Ambient Glow: OFF</span>`;
    if (window.lucide) window.lucide.createIcons();
  }
  if (window.showToast) {
    window.showToast(`Ambient Lighting: ${isAmbientOn ? 'ENABLED' : 'DISABLED'}`);
  }
}

export function togglePiP() {
  const { video } = getElements();
  if (!video) return;
  try {
    if (document.pictureInPictureElement) {
      document.exitPictureInPicture();
    } else if (video.requestPictureInPicture) {
      video.requestPictureInPicture();
    }
  } catch (err) {
    if (window.showToast) window.showToast("PiP not supported on this browser");
  }
}

export function toggleQualityModal() {
  const { qualityModal } = getElements();
  if (qualityModal) qualityModal.classList.toggle('hidden');
}

export function selectQuality(q) {
  const badge = document.getElementById('currentQualityBadge');
  if (badge) badge.innerText = q.split(' ')[0];
  const { qualityModal } = getElements();
  if (qualityModal) qualityModal.classList.add('hidden');
  if (window.showToast) window.showToast(`Stream quality: ${q}`);
}

export function toggleAudioSubModal() {
  const { audioSubModal } = getElements();
  if (audioSubModal) audioSubModal.classList.toggle('hidden');
}

export function setAudioTrack(track) {
  if (window.showToast) window.showToast(`Audio Track: ${track}`);
  const { audioSubModal } = getElements();
  if (audioSubModal) audioSubModal.classList.add('hidden');
}

export function setSubtitle(sub) {
  if (window.showToast) window.showToast(`Subtitles: ${sub}`);
  const { audioSubModal } = getElements();
  if (audioSubModal) audioSubModal.classList.add('hidden');
}

// Expose globally on window for inline HTML onclick handlers
window.toggleFullscreen = toggleFullscreen;
window.toggleLockScreen = toggleLockScreen;
window.unlockScreen = unlockScreen;
window.handlePlayerScreenTap = handlePlayerScreenTap;
window.togglePlay = togglePlay;
window.updatePlayIcon = updatePlayIcon;
window.skipTime = skipTime;
window.triggerPlayerSkipAnimation = triggerPlayerSkipAnimation;
window.seekVideo = seekVideo;
window.changeVolume = changeVolume;
window.toggleMute = toggleMute;
window.toggleAmbientLighting = toggleAmbientLighting;
window.togglePiP = togglePiP;
window.toggleQualityModal = toggleQualityModal;
window.selectQuality = selectQuality;
window.toggleAudioSubModal = toggleAudioSubModal;
window.setAudioTrack = setAudioTrack;
window.setSubtitle = setSubtitle;
