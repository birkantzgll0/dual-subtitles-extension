(() => {
  "use strict";

  const defaults = {
    languages: ["en", "tr"], size: 20, firstColor: "#ffffff",
    secondColor: "#ffe082", position: { x: 0.5, y: 0.92 }
  };
  const settings = { ...defaults };
  const platformCaptions = [
    ["youtube.com", ".ytp-caption-segment"],
    ["netflix.com", ".player-timedtext-text-container"],
    ["disneyplus.com", ".dss-subtitle-renderer-cue"]
  ];
  const selector = platformCaptions.find(([domain]) =>
    location.hostname === domain || location.hostname.endsWith("." + domain)
  )?.[1];
  const captionLanguage = lang => String(lang || "").toLowerCase().split(/[-_]/)[0];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const videos = new Set();
  const overlay = document.createElement("div");
  const lines = [document.createElement("div"), document.createElement("div")];
  overlay.id = "dual-subtitle-container";
  overlay.hidden = true;
  overlay.append(...lines);

  let video, lifetime, frame, drag, bounds;
  const enabledTracks = new Set();
  const cueListeners = new Map();
  const resize = new ResizeObserver(schedule);
  const captions = new MutationObserver(schedule);
  let captionRoot;

  function schedule() {
    if (!frame) frame = requestAnimationFrame(update);
  }

  function videoBounds(candidate) {
    if (!candidate.isConnected || document.pictureInPictureElement === candidate) return;
    const full = document.fullscreenElement;
    if (full && (full === candidate || !full.contains(candidate))) return;
    const rect = candidate.getBoundingClientRect();
    const viewport = window.visualViewport;
    const left = Math.max(rect.left, viewport?.offsetLeft ?? 0);
    const top = Math.max(rect.top, viewport?.offsetTop ?? 0);
    const right = Math.min(rect.right, viewport ? viewport.offsetLeft + viewport.width : innerWidth);
    const bottom = Math.min(rect.bottom, viewport ? viewport.offsetTop + viewport.height : innerHeight);
    if (right - left >= 48 && bottom - top >= 32) {
      const style = getComputedStyle(candidate);
      if (style.display !== "none" && style.visibility === "visible") {
        return { left, top, width: right - left, height: bottom - top };
      }
    }
  }

  function selectVideo() {
    let winner, winnerBounds, best = 0;
    for (const candidate of videos) {
      const box = videoBounds(candidate);
      if (!box) continue;
      const score = box.width * box.height * (candidate.paused ? 1 : 3);
      if (score <= best) continue;
      winner = candidate;
      winnerBounds = box;
      best = score;
    }
    if (winner !== video) {
      lifetime?.abort();
      if (video) resize.unobserve(video);
      for (const track of enabledTracks) {
        if (track.mode === "hidden") track.mode = "disabled";
      }
      enabledTracks.clear();
      cueListeners.clear();
      captions.disconnect();
      captionRoot = undefined;
      drag = undefined;
      delete overlay.dataset.dragging;
      video = winner;
      if (video) {
        lifetime = new AbortController();
        for (const event of ["addtrack", "removetrack", "change"]) {
          video.textTracks.addEventListener(event, schedule, { signal: lifetime.signal });
        }
        resize.observe(video);
      }
    }
    bounds = winnerBounds;
  }

  function readTracks() {
    const tracks = [...video.textTracks].filter(track =>
      track.kind === "subtitles" || track.kind === "captions"
    );
    const selected = settings.languages.map(lang => {
      const matches = tracks.filter(track => captionLanguage(track.language) === lang);
      return matches.find(track => track.mode === "showing") ?? matches[0];
    });
    for (const [track, listener] of cueListeners) {
      if (selected.includes(track)) continue;
      track.removeEventListener("cuechange", listener);
      cueListeners.delete(track);
      if (enabledTracks.delete(track) && track.mode === "hidden") track.mode = "disabled";
    }
    for (const track of selected) {
      if (!track) continue;
      if (!cueListeners.has(track)) {
        const listener = () => schedule();
        track.addEventListener("cuechange", listener, { signal: lifetime.signal });
        cueListeners.set(track, listener);
      }
      if (track.mode === "disabled") {
        enabledTracks.add(track);
        track.mode = "hidden";
      }
    }
    return { tracks, texts: selected.map(track => Array.from(track?.activeCues ?? [], cue =>
      typeof cue.getCueAsHTML === "function" ? cue.getCueAsHTML().textContent : cue.text
    ).filter(Boolean).join("\n").trim()) };
  }

  function readSiteCaptions(tracks, texts) {
    if (!selector) return;
    const fullscreen = document.fullscreenElement;
    const player = video.closest("#movie_player, [data-uia='video-canvas'], .btm-media-client-element");
    const root = fullscreen || (player?.querySelector(selector) ? player : document);
    const nodes = [...root.querySelectorAll(selector)];
    const observed = nodes[0]?.parentElement;
    if (captionRoot !== observed) {
      captions.disconnect();
      captionRoot = observed;
      if (captionRoot) captions.observe(captionRoot, {
        childList: true, subtree: true, characterData: true
      });
    }
    const activeLanguage = captionLanguage(tracks.find(track => track.mode === "showing")?.language);
    const entries = nodes.filter(node => node.getClientRects().length &&
      getComputedStyle(node).visibility === "visible").map(node => ({
        text: (node.innerText || node.textContent).trim(),
        language: captionLanguage(node.closest("[lang]:not(html):not(body)")?.lang) || activeLanguage
      })).filter(entry => entry.text);
    for (let index = 0; index < texts.length; index++) {
      if (!texts[index]) {
        texts[index] = entries.filter(entry => entry.language === settings.languages[index])
          .map(entry => entry.text).join("\n");
      }
    }
    const unknown = entries.filter(entry => !entry.language).map(entry => entry.text).join("\n");
    if (unknown && !texts.includes(unknown)) {
      const empty = texts.indexOf("");
      if (empty !== -1) texts[empty] = unknown;
    }
  }

  function place() {
    const { left, top, width, height } = bounds;
    overlay.style.maxWidth = width + "px";
    overlay.style.maxHeight = height + "px";
    const box = overlay.getBoundingClientRect();
    const travelX = Math.max(0, width - box.width);
    const travelY = Math.max(0, height - box.height);
    if (drag) {
      settings.position = {
        x: travelX ? clamp((drag.x - drag.offsetX - left) / travelX, 0, 1) : settings.position.x,
        y: travelY ? clamp((drag.y - drag.offsetY - top) / travelY, 0, 1) : settings.position.y
      };
    }
    overlay.style.left = left + travelX * settings.position.x + "px";
    overlay.style.top = top + travelY * settings.position.y + "px";
  }

  function update() {
    frame = 0;
    selectVideo();
    if (!video) {
      overlay.hidden = true;
      return;
    }
    const { tracks, texts } = readTracks();
    if (texts.some(value => !value)) readSiteCaptions(tracks, texts);
    const parent = document.fullscreenElement || document.documentElement;
    if (overlay.parentNode !== parent) parent.append(overlay);
    for (const [index, line] of lines.entries()) {
      line.hidden = !texts[index];
      if (line.textContent !== texts[index]) line.textContent = texts[index];
    }
    overlay.hidden = !texts.some(Boolean);
    if (!overlay.hidden) place();
  }

  overlay.addEventListener("pointerdown", event => {
    if (!event.isPrimary || event.button !== 0 || !bounds || drag) return;
    const box = overlay.getBoundingClientRect();
    drag = { id: event.pointerId, x: event.clientX, y: event.clientY,
      offsetX: event.clientX - box.left, offsetY: event.clientY - box.top };
    overlay.setPointerCapture(event.pointerId);
    overlay.dataset.dragging = "";
    event.preventDefault();
  });
  overlay.addEventListener("pointermove", event => {
    if (drag?.id !== event.pointerId) return;
    drag.x = event.clientX;
    drag.y = event.clientY;
    schedule();
  });
  function stopDrag(event) {
    if (drag?.id !== event.pointerId) return;
    if (bounds && !overlay.hidden) place();
    drag = undefined;
    delete overlay.dataset.dragging;
    chrome.storage.local.set({ position: settings.position }).catch(() => {});
  }
  for (const event of ["pointerup", "pointercancel", "lostpointercapture"]) {
    overlay.addEventListener(event, stopDrag);
  }

  const visibility = new IntersectionObserver(schedule);
  function register(node) {
    if (node instanceof HTMLVideoElement && !videos.has(node)) {
      videos.add(node);
      visibility.observe(node);
    }
  }
  function inspect(node) {
    if (!(node instanceof Element)) return;
    register(node);
    node.querySelectorAll("video").forEach(register);
  }

  new MutationObserver(records => {
    let relevant = false;
    for (const record of records) {
      if (overlay.contains(record.target)) continue;
      if (videos.size && selector) relevant = true;
      if (record.target instanceof HTMLVideoElement) relevant = true;
      for (const node of record.addedNodes) {
        if (node === overlay) continue;
        const size = videos.size;
        inspect(node);
        if (size !== videos.size) relevant = true;
      }
    }
    for (const candidate of videos) {
      if (candidate.isConnected) continue;
      visibility.unobserve(candidate);
      videos.delete(candidate);
      relevant = true;
    }
    if (relevant) schedule();
  }).observe(document.documentElement, { childList: true, subtree: true });

  for (const event of ["play", "pause", "loadedmetadata", "emptied",
    "enterpictureinpicture", "leavepictureinpicture", "fullscreenchange", "load"]) {
    document.addEventListener(event, event => {
      if (event.target instanceof HTMLVideoElement) register(event.target);
      if (event.type === "fullscreenchange" || event.target instanceof HTMLVideoElement ||
          event.target instanceof HTMLTrackElement) schedule();
    }, true);
  }
  window.addEventListener("resize", schedule);
  window.addEventListener("scroll", schedule, { capture: true, passive: true });
  window.visualViewport?.addEventListener("resize", schedule);
  window.visualViewport?.addEventListener("scroll", schedule);

  function configure(values) {
    const { languages, size, firstColor, secondColor, position } = values;
    if (Array.isArray(languages) && languages.length === 2 &&
        languages.every(lang => typeof lang === "string" && /^[a-z]{2,3}$/i.test(lang)) &&
        captionLanguage(languages[0]) !== captionLanguage(languages[1])) {
      settings.languages = languages.map(captionLanguage);
    }
    if (Number.isFinite(size)) settings.size = clamp(size, 12, 48);
    if (/^#[\da-f]{6}$/i.test(firstColor)) settings.firstColor = firstColor;
    if (/^#[\da-f]{6}$/i.test(secondColor)) settings.secondColor = secondColor;
    if (!drag && Number.isFinite(position?.x) && Number.isFinite(position?.y)) {
      settings.position = { x: clamp(position.x, 0, 1), y: clamp(position.y, 0, 1) };
    }
    overlay.style.setProperty("--dsm-size", settings.size + "px");
    overlay.style.setProperty("--dsm-first", settings.firstColor);
    overlay.style.setProperty("--dsm-second", settings.secondColor);
    schedule();
  }
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    configure(Object.fromEntries(Object.entries(changes).map(([key, change]) =>
      [key, change.newValue ?? defaults[key]]
    )));
  });
  chrome.storage.local.get(defaults).then(configure).catch(() => {});
  document.querySelectorAll("video").forEach(register);
  schedule();
})();
