"use strict";

const $ = id => document.getElementById(id);
const local = chrome.storage.local;
const sync = chrome.storage.sync;
const fields = [
  ["enabled", local, "translationEnabled", true],
  ["mode", local, "subtitleMode", "complementary"],
  ["target", local, "targetLanguage", "auto"],
  ["dark", sync, "dsmDark", false],
  ["font", sync, "dsmFont", 20],
  ["color", sync, "dsmColor", "#ffffff"],
  ["background", sync, "dsmBackground", true],
  ["opacity", sync, "dsmOpacity", 82]
];
let entries = [];
let listRevision = 0;

function report(error) {
  $("status").textContent = error?.message || "İşlem tamamlanamadı.";
}

async function bind([id, storage, key, initial]) {
  const field = $(id);
  const checkbox = field.type === "checkbox";
  const range = field.type === "range";
  const { [key]: value } = await storage.get({ [key]: initial });
  if (checkbox) field.checked = value;
  else field.value = value;
  if (range) {
    const showValue = () => {
      $(id + "Value").value = field.value + (id === "font" ? " px" : "%");
    };
    showValue();
    field.addEventListener("input", showValue);
  }
  field.addEventListener("change", () => {
    const next = checkbox ? field.checked : range ? field.valueAsNumber : field.value;
    storage.set({ [key]: next }).catch(report);
  });
}

function renderWords(values) {
  entries = Array.isArray(values) ? values : [];
  $("empty").hidden = entries.length > 0;
  $("export").disabled = !entries.length;
  const cards = entries.slice().reverse().map(entry => {
    const card = document.createElement("li");
    const word = document.createElement("strong");
    word.textContent = entry.word;
    const meaning = document.createElement("span");
    meaning.className = "meaning";
    meaning.textContent = entry.translation;
    const context = document.createElement("p");
    context.className = "context";
    context.textContent = entry.context;
    const trash = document.createElement("button");
    trash.type = "button";
    trash.className = "trash";
    trash.textContent = "🗑";
    trash.setAttribute("aria-label", entry.word + " kaydını sil");
    trash.addEventListener("click", async () => {
      trash.disabled = true;
      try {
        const response = await chrome.runtime.sendMessage({ type: "dsm-vocabulary-delete", id: entry.id });
        if (!response?.ok) throw Error(response?.error || "Kelime silinemedi.");
      } catch (error) {
        report(error);
      } finally {
        trash.disabled = false;
      }
    });
    card.append(word, meaning, context, trash);
    return card;
  });
  $("words").replaceChildren(...cards);
}

function selectPanel(words) {
  $("settingsPanel").hidden = words;
  $("wordsPanel").hidden = !words;
  $("settingsTab").setAttribute("aria-pressed", String(!words));
  $("wordsTab").setAttribute("aria-pressed", String(words));
}
$("settingsTab").onclick = () => selectPanel(false);
$("wordsTab").onclick = () => selectPanel(true);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== "local" || !changes.saved_vocabulary) return;
  listRevision++;
  renderWords(changes.saved_vocabulary.newValue);
});

$("export").onclick = () => {
  const cell = value => {
    const text = String(value ?? "");
    const safe = /^\s*[=+@-]|^[\t\r\n]/.test(text) ? "'" + text : text;
    return '"' + safe.replaceAll('"', '""') + '"';
  };
  const rows = [["word", "translation", "context", "date"],
    ...entries.map(entry => [entry.word, entry.translation, entry.context, entry.date])];
  const url = URL.createObjectURL(new Blob(["\uFEFF", rows.map(row => row.map(cell).join(",")).join("\r\n")],
    { type: "text/csv;charset=utf-8" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = "dual-subtitle-vocabulary.csv";
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};

const initialRevision = listRevision;
local.get({ saved_vocabulary: [] }).then(values => {
  if (listRevision === initialRevision) renderWords(values.saved_vocabulary);
}).catch(report);
Promise.all(fields.map(bind)).catch(report);
