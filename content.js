(() => {
  "use strict";

  const defaults = {
    translationEnabled: true, subtitleMode: "complementary", targetLanguage: "auto",
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
  const hostname = window.location.hostname;
  const isYouTube = hostname.includes("youtube.com") &&
    (hostname === "youtube.com" || hostname.endsWith(".youtube.com"));
  const hiddenNativeNodes = new Set();
  let nativeNodes = [];
  const playerSelector = "#movie_player, .html5-video-player, .jwplayer, #player, .video-js, .vjs-player, [data-uia='video-canvas'], .btm-media-client-element";
  const playerUi = ".player-title, .overlay-info, [class*=title i], [class*=controls i], [class*=episode-info i], [class*=season-info i], button, input, select, [role=button], [role=menu], [role=dialog]";
  const staleAfter = 10_000;
  const captionAge = new Map();
  let staleTimer;

  function playerRoot() {
    return video?.closest(playerSelector) ?? video?.parentElement;
  }

  function captionText(node) {
    return (node.innerText || node.textContent).replace(/\s+/g, " ").trim();
  }

  function freshCaptionNodes(nodes) {
    clearTimeout(staleTimer);
    const now = performance.now();
    const previous = new Map(captionAge);
    captionAge.clear();
    let next = Infinity;
    const pageTitle = document.title.trim().toLowerCase();
    const fresh = nodes.filter(node => {
      if (node.closest(playerUi)) return false;
      const text = captionText(node);
      if (!text || text.toLowerCase() === pageTitle ||
          /^(?:season|episode|sezon|bölüm)\s*[:.#-]?\s*\d+\b|^s\d+\s*e\d+\b/i.test(text)) return false;
      const firstSeen = previous.get(text) ?? now;
      captionAge.set(text, firstSeen);
      const remaining = staleAfter - (now - firstSeen);
      if (remaining <= 0) return false;
      next = Math.min(next, remaining);
      return true;
    });
    if (Number.isFinite(next)) staleTimer = setTimeout(schedule, Math.ceil(next));
    return fresh;
  }
  const genericCaptions = [
    ".player-timedtext-text-container", ".player-timedtext", ".dss-subtitle-renderer-cue",
    ".vjs-text-track-display", '[class*="subtitle" i]', '[class*="caption" i]'
  ].join(", ");

  const captionLanguage = lang => String(lang || "").toLowerCase().split(/[-_]/)[0];
  const clamp = (value, min, max) => Math.max(min, Math.min(max, value));
  const videos = new Set();
  const containers = [...document.querySelectorAll("#dual-subtitle-master-container")];
  const overlay = containers.shift() ?? document.createElement("div");
  for (const duplicate of containers) duplicate.remove();
  if (overlay.dataset.dsmOwner === chrome.runtime.id) return;
  overlay.dataset.dsmOwner = chrome.runtime.id;
  const lines = [document.createElement("div"), document.createElement("div")];
  overlay.id = "dual-subtitle-master-container";
  overlay.hidden = true;
  const controls = document.createElement("div");
  controls.className = "dsm-translation";
  const status = document.createElement("span");
  status.setAttribute("role", "status");
  const buttons = settings.languages.map((_, index) => {
    const button = document.createElement("button");
    button.type = "button";
    button.addEventListener("pointerdown", event => event.stopPropagation());
    button.addEventListener("click", () => enableTranslation(index));
    return button;
  });
  controls.append(...buttons, status);
  overlay.replaceChildren(...lines, controls);

  const dictionary = document.createElement("div");
  dictionary.className = "dsm-dictionary";
  dictionary.setAttribute("popover", "manual");
  const meaning = document.createElement("span");
  meaning.setAttribute("role", "status");
  const saveWord = document.createElement("button");
  saveWord.type = "button";
  saveWord.textContent = "Kaydet ⭐";
  dictionary.append(meaning, saveWord);
  overlay.append(dictionary);
  dictionary.addEventListener("pointerdown", event => event.stopPropagation());

  const wordCache = new Map();
  let hoverTimer, closeTimer, lookup, selectedWord, wordEntry;
  function closeDictionary() {
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    lookup?.abort();
    selectedWord = undefined;
    wordEntry = undefined;
    dictionary.hidePopover();
  }

  function positionDictionary(word) {
    const rect = word.getBoundingClientRect();
    const box = dictionary.getBoundingClientRect();
    dictionary.style.left = clamp(rect.left, 0, Math.max(0, innerWidth - box.width)) + "px";
    dictionary.style.top = (rect.top >= box.height + 4 ? rect.top - box.height - 4 : rect.bottom + 4) + "px";
  }

  async function openDictionary(wordNode) {
    closeDictionary();
    if (!video || !wordNode.isConnected || !lines[0].contains(wordNode) || overlay.hidden) return;
    video.pause();
    selectedWord = wordNode;
    const word = wordNode.textContent;
    const context = lines[0].textContent;
    meaning.textContent = "Bakılıyor…";
    saveWord.disabled = true;
    saveWord.textContent = "Kaydet ⭐";
    dictionary.showPopover();
    positionDictionary(wordNode);
    const request = new AbortController();
    lookup = request;
    try {
      const source = detectSource(context) === "en" ? "en" : "auto";
      const key = source + ":" + word.toLowerCase();
      let translation = wordCache.get(key);
      if (!translation) {
        const data = await fetchTranslation(word, source, "tr", request.signal);
        translation = data[0].map(part => part?.[0] ?? "").join("").trim();
        if (!translation) throw Error("Sözlük karşılığı bulunamadı.");
        if (wordCache.size >= 100) wordCache.delete(wordCache.keys().next().value);
        wordCache.set(key, translation);
      }
      if (request.signal.aborted || selectedWord !== wordNode) return;
      wordEntry = { word, translation, context };
      meaning.textContent = translation;
      saveWord.disabled = false;
    } catch {
      if (request.signal.aborted) return;
      meaning.textContent = "Sözlük karşılığı alınamadı.";
    }
    if (!request.signal.aborted) positionDictionary(wordNode);
  }

  saveWord.addEventListener("click", async () => {
    const entry = wordEntry;
    if (!entry) return;
    saveWord.disabled = true;
    try {
      const result = await chrome.runtime.sendMessage({ type: "dsm-vocabulary-save", entry });
      if (!result?.ok) throw Error(result?.error);
      if (wordEntry === entry) saveWord.textContent = "Kaydedildi";
    } catch {
      if (wordEntry !== entry) return;
      meaning.textContent = "Kelime kaydedilemedi.";
      saveWord.disabled = false;
    }
  });

  lines[0].addEventListener("pointerover", event => {
    const word = event.target.closest("[data-dsm-word]");
    if (!word || word === selectedWord) return;
    clearTimeout(hoverTimer);
    clearTimeout(closeTimer);
    hoverTimer = setTimeout(() => void openDictionary(word), 220);
  });
  lines[0].addEventListener("pointerout", event => {
    if (event.target === event.relatedTarget) return;
    clearTimeout(hoverTimer);
    closeTimer = setTimeout(closeDictionary, 500);
  });
  lines[0].addEventListener("focusin", event => {
    if (event.target.matches("[data-dsm-word]")) void openDictionary(event.target);
  });
  dictionary.addEventListener("pointerenter", () => clearTimeout(closeTimer));
  dictionary.addEventListener("pointerleave", () => { closeTimer = setTimeout(closeDictionary, 500); });
  overlay.addEventListener("keydown", event => { if (event.key === "Escape") closeDictionary(); });

  function renderOriginal(text) {
    closeDictionary();
    const fragment = document.createDocumentFragment();
    for (const token of text.split(/([\p{L}\p{M}]+(?:['’‑-][\p{L}\p{M}]+)*)/u)) {
      if (!token) continue;
      if (!/^\p{L}/u.test(token)) {
        fragment.append(token);
        continue;
      }
      const word = document.createElement("span");
      word.dataset.dsmWord = "";
      word.tabIndex = 0;
      word.textContent = token;
      fragment.append(word);
    }
    lines[0].replaceChildren(fragment);
  }

  function applyVisualStyle(values) {
    if (typeof values.dsmDark === "boolean") overlay.dataset.theme = values.dsmDark ? "dark" : "light";
    if (Number.isFinite(values.dsmFont)) {
      overlay.style.setProperty("--dsm-sync-size", clamp(values.dsmFont, 14, 28) + "px");
    }
    if (/^#[\da-f]{6}$/i.test(values.dsmColor)) overlay.style.setProperty("--dsm-sync-color", values.dsmColor);
    if (typeof values.dsmBackground === "boolean" && Number.isFinite(values.dsmOpacity)) {
      overlay.style.setProperty("--dsm-sync-opacity", (values.dsmBackground ? clamp(values.dsmOpacity, 0, 100) : 0) + "%");
    }
    schedule();
  }

  const visual = { dsmDark: false, dsmBackground: true, dsmOpacity: 82 };
  chrome.storage.sync.get(visual).then(values => {
    Object.assign(visual, values);
    applyVisualStyle(visual);
  }).catch(() => {});
  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "sync") return;
    for (const key of ["dsmDark", "dsmFont", "dsmColor", "dsmBackground", "dsmOpacity"]) {
      if (changes[key]) visual[key] = changes[key].newValue;
    }
    applyVisualStyle(visual);
  });

  const cache = new Map();
  let activeKey = "", timer, controller, unknownLanguage, notice = "";
  let translationVideo;

  function enableTranslation(index) {
    unknownLanguage = settings.languages[index];
    notice = "";
    schedule();
  }

  function detectSource(text) {
    if (/[çğıöşüİÇĞÖŞÜ]/.test(text)) return "tr";
    const words = text.toLowerCase().match(/\p{L}+/gu) ?? [];
    const english = words.filter(word => /^(the|what|you|your|is|are|was|this|with|they|and|have|would|hello)$/.test(word)).length;
    const turkish = words.filter(word => /^(bir|ve|bu|ben|sen|biz|icin|ama|neden|merhaba|evet|hayir|var|yok)$/.test(word)).length;
    if (english === turkish) return "";
    return english > turkish ? "en" : "tr";
  }

  function setTranslationKey(key) {
    if (activeKey === key) return;
    clearTimeout(timer);
    controller?.abort();
    controller = undefined;
    activeKey = key;
    notice = "";
  }

  function fillTranslation(texts, unknown) {
    if (translationVideo !== video) {
      translationVideo = video;
      unknownLanguage = undefined;
      notice = "";
    }
    const available = texts.filter(Boolean);
    const originalText = available[0] || unknown;
    controls.hidden = true;
    if (!originalText || (available.length === 2 && available[0] !== available[1])) {
      setTranslationKey("");
      return;
    }

    const normalize = captionLanguage;
    const supported = lang => lang === "en" || lang === "tr";
    const metadata = available.length ? settings.languages[texts.findIndex(Boolean)] : "";
    const normalizedSrc = normalize(unknownLanguage || metadata || detectSource(originalText)) || "auto";
    const automaticTarget = normalizedSrc === "tr" ? "en" : "tr";
    const targetLang = settings.targetLanguage === "auto" ? automaticTarget : settings.targetLanguage;
    if (normalizedSrc === targetLang) {
      controls.hidden = true;
      setTranslationKey("");
      texts[0] = originalText;
      texts[1] = "";
      return;
    }
    const pair = normalizedSrc + ">" + targetLang;
    const key = JSON.stringify([pair, originalText]);
    const changed = activeKey !== key;
    setTranslationKey(key);

    texts[0] = originalText;
    texts[1] = "";
    controls.hidden = false;
    buttons.forEach((button, index) => {
      const lang = settings.languages[index];
      button.hidden = !supported(normalize(lang));
      button.textContent = "Kaynak: " + lang.toUpperCase();
    });
    status.textContent = notice;
    status.style.cssText = notice
      ? "display:block;padding:6px 10px;margin-top:4px;background:#991b1b;color:white;border-radius:4px"
      : "";
    controls.hidden = !notice && cache.has(key) && Boolean(cache.get(key));
    if (cache.has(key)) {
      texts[1] = cache.get(key);
      return;
    }
    if (!notice) status.textContent = "Çeviri hazırlanıyor…";
    if (!changed) return;
    timer = setTimeout(requestTranslation, 150);

    async function requestTranslation() {
      const request = new AbortController();
      controller = request;
      try {
        let data = await fetchTranslation(originalText, normalizedSrc, targetLang, request.signal);
        if (settings.targetLanguage === "auto" && normalizedSrc === "auto" && captionLanguage(data[2]) === "tr") {
          data = await fetchTranslation(originalText, "tr", "en", request.signal);
        }
        if (controller !== request || request.signal.aborted) return;
        const result = data[0].map(part => part?.[0] ?? "").join("").trim();
        if (!result || result === originalText.trim()) throw Error("Farklı bir çeviri alınamadı.");
        if (cache.size >= 50) cache.delete(cache.keys().next().value);
        cache.set(key, result);
      } catch (err) {
        if (controller !== request || request.signal.aborted) return;
        console.error("[Dual Subtitle Master Error]:", err);
        notice = err instanceof Error ? err.message : String(err);
      } finally {
        if (controller === request) {
          controller = undefined;
          schedule();
        }
      }
    }
  }

  async function fetchTranslation(text, source, target, signal) {
    signal.throwIfAborted();
    const response = await chrome.runtime.sendMessage({
      type: "dsm-google-translate", source, target, text
    });
    signal.throwIfAborted();
    if (response?.error) throw Error(response.error);
    const data = response?.data;
    if (!Array.isArray(data?.[0])) throw Error("Geçersiz çeviri yanıtı.");
    return data;
  }

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
      video?.removeAttribute("data-dsm-hide-cues");
      closeDictionary();
      clearTimeout(staleTimer);
      captionAge.clear();
      setTranslationKey("");
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
    if (!selector) return "";
    const player = playerRoot();
    const rawNodes = [...(player?.querySelectorAll(selector) ?? [])];
    const nodes = freshCaptionNodes(rawNodes);
    nativeNodes = nodes.filter(node => node.textContent.trim() &&
      (node.getClientRects().length || document.documentElement.hasAttribute("data-dsm-youtube")));
    const observed = rawNodes[0]?.parentElement;
    if (captionRoot !== observed) {
      captions.disconnect();
      captionRoot = observed;
      if (captionRoot) captions.observe(captionRoot, {
        childList: true, subtree: true, characterData: true
      });
    }
    let activeLanguage = captionLanguage(tracks.find(track => track.mode === "showing")?.language);
    if (selector === ".ytp-caption-segment") {
      activeLanguage = "";
      if (nodes.length && player?.id === "movie_player") {
        function receive(event) {
          activeLanguage = captionLanguage(event.detail);
        }
        player.addEventListener("dsm-caption-language", receive, { once: true });
        player.dispatchEvent(new Event("dsm-request-caption-language", { bubbles: true }));
        player.removeEventListener("dsm-caption-language", receive);
      }
    }
    const entries = nodes.map(node => ({
        text: (node.innerText || node.textContent).trim(),
        language: captionLanguage(node.closest("[lang]:not(html):not(body)")?.lang) || activeLanguage
      })).filter(entry => entry.text);
    for (let index = 0; index < texts.length; index++) {
      if (!texts[index]) {
        texts[index] = entries.filter(entry => entry.language === settings.languages[index])
          .map(entry => entry.text).join("\n");
      }
    }
    const unknown = entries.filter(entry => !settings.languages.includes(entry.language)).map(entry => entry.text).join("\n");
    return texts.includes(unknown) ? "" : unknown;
  }

  function readGenericCaptions(texts) {
    const player = playerRoot();
    const nodes = [...(player?.querySelectorAll(genericCaptions) ?? [])].filter(node => {
      if (overlay.contains(node) || node.closest(playerUi) || node.contains(video)) return false;
      const rect = node.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0 &&
        rect.right > bounds.left && rect.left < bounds.left + bounds.width &&
        rect.bottom > bounds.top && rect.top < bounds.top + bounds.height &&
        (hiddenNativeNodes.has(node) || getComputedStyle(node).visibility === "visible") &&
        Boolean(captionText(node));
    });
    const leaves = freshCaptionNodes(nodes.filter(node =>
      !nodes.some(other => other !== node && node.contains(other))));
    nativeNodes = leaves;
    const unknown = new Set();
    const byLanguage = new Map();
    for (const node of leaves) {
      const text = captionText(node);
      const lang = captionLanguage(node.closest("[lang]:not(html):not(body)")?.lang);
      if (!settings.languages.includes(lang)) {
        unknown.add(text);
        continue;
      }
      if (!byLanguage.has(lang)) byLanguage.set(lang, new Set());
      byLanguage.get(lang).add(text);
    }
    settings.languages.forEach((lang, index) => {
      if (!texts[index] && byLanguage.has(lang)) texts[index] = [...byLanguage.get(lang)].join("\n");
    });
    return [...unknown].filter(text => !texts.includes(text)).join("\n");
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
    overlay.style.top = top + travelY * (overlay.dataset.mode === "complementary" ? Math.min(settings.position.y, 0.72) : settings.position.y) + "px";
  }

  function updateNativeVisibility(hide) {
    const root = document.documentElement;
    video?.toggleAttribute("data-dsm-hide-cues", hide);
    root.toggleAttribute("data-dsm-youtube", hide && isYouTube);
    const next = new Set(hide && !isYouTube ? nativeNodes : []);
    for (const node of hiddenNativeNodes) {
      if (!next.has(node)) node.removeAttribute("data-dsm-hide-native");
    }
    for (const node of next) {
      if (!hiddenNativeNodes.has(node)) node.setAttribute("data-dsm-hide-native", "");
    }
    hiddenNativeNodes.clear();
    for (const node of next) hiddenNativeNodes.add(node);
  }

  let lastProcessedText;

  function update() {
    frame = 0;
    selectVideo();
    if (!video || !settings.translationEnabled) {
      closeDictionary();
      freshCaptionNodes([]);
      setTranslationKey("");
      updateNativeVisibility(false);
      overlay.hidden = true;
      document.documentElement.classList.remove("dsm-youtube-overlay");
      return;
    }
    nativeNodes = [];
    const { tracks, texts } = readTracks();
    const showingTrack = tracks.find(track => track.mode === "showing" && track.activeCues?.length);
    const unknown = (texts.some(value => !value) || isYouTube)
      ? (isYouTube ? readSiteCaptions(tracks, texts) : readGenericCaptions(texts)) : "";
    fillTranslation(texts, unknown);
    const parent = document.fullscreenElement || document.documentElement;
    if (overlay.parentNode !== parent) parent.append(overlay);
    const comparable = text => text.normalize("NFC").replace(/\s+/g, " ").trim();
    if (texts[0] && comparable(texts[0]) === comparable(texts[1])) texts[1] = "";
    const nativeActive = nativeNodes.length > 0 || Boolean(showingTrack);
    const dual = settings.subtitleMode === "dual";
    updateNativeVisibility(dual && Boolean(texts[0]));
    if (!dual && nativeActive) texts[0] = "";
    overlay.dataset.mode = !dual && nativeActive ? "complementary" : "dual";
    const renderKey = JSON.stringify(texts);
    if (renderKey !== lastProcessedText) {
      lastProcessedText = renderKey;
      for (const [index, line] of lines.entries()) {
        line.hidden = !texts[index];
        if (line.textContent !== texts[index]) {
          if (index === 0) renderOriginal(texts[index]);
          else line.textContent = texts[index];
        }
      }
    }
    overlay.hidden = !texts.some(Boolean);
    document.documentElement.classList.toggle("dsm-youtube-overlay",
      texts.every(Boolean) && selector === ".ytp-caption-segment");
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

  function isCaptionMutation(record) {
    const node = record.target instanceof Element ? record.target : record.target.parentElement;
    if (!playerRoot()?.contains(node)) return false;
    if (node?.closest(genericCaptions)) return true;
    return [...record.addedNodes, ...record.removedNodes].some(child =>
      child instanceof Element && (child.matches(genericCaptions) || child.querySelector(genericCaptions))
    );
  }

  new MutationObserver(records => {
    let relevant = false;
    for (const record of records) {
      if (overlay.contains(record.target)) continue;
      if (video && (isYouTube ? playerRoot()?.contains(record.target) : isCaptionMutation(record))) relevant = true;
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
  }).observe(document.documentElement, { childList: true, subtree: true, characterData: !isYouTube });

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
    const { languages, size, firstColor, secondColor, position,
      translationEnabled, subtitleMode, targetLanguage } = values;
    if (typeof translationEnabled === "boolean") settings.translationEnabled = translationEnabled;
    if (["dual", "complementary"].includes(subtitleMode)) settings.subtitleMode = subtitleMode;
    if (["auto", "en", "tr"].includes(targetLanguage) && targetLanguage !== settings.targetLanguage) {
      settings.targetLanguage = targetLanguage;
      setTranslationKey("");
    }
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



