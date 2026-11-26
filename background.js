const endpoint = "https://translate.googleapis.com/translate_a/single";
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id || message?.type !== "dsm-google-translate" ||
      !/^(auto|[a-z]{2,3})$/.test(message.source) ||
      !["en", "tr"].includes(message.target) ||
      typeof message.text !== "string" || message.text.length > 4096) return;
  const url = new URL(endpoint);
  url.search = new URLSearchParams({
    client: "gtx", sl: message.source, tl: message.target, dt: "t", q: message.text
  });
  chrome.storage.local.get({ googleTranslationEnabled: false }).then(({ googleTranslationEnabled }) => {
    if (googleTranslationEnabled !== true) throw Error("Google çevirisi kapalı.");
    return fetch(url, { credentials: "omit", referrerPolicy: "no-referrer", signal: AbortSignal.timeout(8000) });
  })
    .then(response => {
      if (!response.ok) throw Error("Google Translate HTTP " + response.status);
      return response.json();
    })
    .then(data => respond({ data }), error => respond({ error: error.message }));
  return true;
});

let vocabularyWrites = Promise.resolve();
chrome.runtime.onMessage.addListener((message, sender, respond) => {
  if (sender.id !== chrome.runtime.id ||
      !["dsm-vocabulary-save", "dsm-vocabulary-delete"].includes(message?.type)) return;
  const operation = vocabularyWrites.then(async () => {
    const stored = await chrome.storage.local.get({ saved_vocabulary: [] });
    const entries = Array.isArray(stored.saved_vocabulary) ? stored.saved_vocabulary : [];
    if (message.type === "dsm-vocabulary-delete") {
      await chrome.storage.local.set({ saved_vocabulary: entries.filter(entry => entry.id !== message.id) });
      return;
    }
    const { word, translation, context } = message.entry ?? {};
    if ([word, translation, context].some(value => typeof value !== "string" || !value.trim()) ||
        word.length > 128 || translation.length > 512 || context.length > 4096) throw Error("Geçersiz kelime kaydı.");
    if (entries.some(entry => entry.word === word && entry.translation === translation && entry.context === context)) return;
    const id = Math.max(Date.now(), (entries.at(-1)?.id || 0) + 1);
    await chrome.storage.local.set({
      saved_vocabulary: [...entries, { id, word, translation, context, date: new Date().toISOString().slice(0, 10) }]
    });
  });
  vocabularyWrites = operation.catch(() => {});
  operation.then(() => respond({ ok: true }), error => respond({ error: error.message }));
  return true;
});
