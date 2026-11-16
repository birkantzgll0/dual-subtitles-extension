(() => {
  if (location.hostname !== 'youtube.com' && !location.hostname.endsWith('.youtube.com')) return;
  document.addEventListener("dsm-request-caption-language", event => {
    const player = event.target;
    if (player.id !== "movie_player") return;
    try {
      const track = player.getOption?.("captions", "track");
      const language = track?.translationLanguage?.languageCode ?? track?.languageCode;
      if (typeof language === "string") {
        player.dispatchEvent(new CustomEvent("dsm-caption-language", { detail: language }));
      }
    } catch {
      // The player may not expose a caption track.
    }
  }, true);
})();
