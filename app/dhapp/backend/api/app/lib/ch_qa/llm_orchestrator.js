"use strict";

// Strict compressor-only orchestrator
const ai = require("../aiClient");

const SYS_PROMPT = `
Rolle: CH-Fachinfo-Kompressor.
Regeln:
- Antworte NUR aus den gelieferten Passagen. Nichts hinzufügen oder raten.
- Wenn nicht beantwortbar: "unanswerable": true.
- Gib ausschließlich validen JSON innerhalb <json>...</json> mit Schema:
  {"summary": string, "bullets": string[], "sources": string[], "unanswerable": boolean}
- Sprache = Sprache der Nutzerfrage/Passagen.
- Keine Texte außerhalb des JSON.
`.trim();

function shapeForModel({ intent, constraints, passages }) {
  const maxChars = parseInt(process.env.MAX_PASSAGE_CHARS || "1200", 10);
  const shaped = passages
    .slice(0, parseInt(process.env.MAX_PASSAGES || "6", 10))
    .map((p) => ({
      section: p.section,
      text: String(p.text || "").slice(0, maxChars),
      source: p.source,
    }));
  return { intent, constraints, passages: shaped };
}

function validateJson(out, passages) {
  if (!out || typeof out !== "object") return false;
  const hasAll = [
    "summary",
    "bullets",
    "sources",
    "unanswerable",
  ].every((k) => Object.prototype.hasOwnProperty.call(out, k));
  if (!hasAll) return false;

  const allowedSources = new Set(passages.map((p) => p.source));
  if (!Array.isArray(out.sources) || !out.sources.every((s) => allowedSources.has(s)))
    return false;

  // Soft entity/word check: terms must appear in provided passages or sources
  const concat = (
    passages.map((p) => p.text + " " + p.source).join(" ") || ""
  ).toLowerCase();
  const text = (
    (out.summary || "") + " " + (out.bullets || []).join(" ")
  ).toLowerCase();
  const risky = (text.match(/[a-zäöüüß\-’'´]+/gi) || []).filter((t) => t.length > 3);
  const unseen = risky.filter((t) => !concat.includes(t)).slice(0, 5);
  return unseen.length < 1;
}

async function compressPassages({ intent, constraints, passages }) {
  const payload = shapeForModel({ intent, constraints, passages });
  const userContent = JSON.stringify(payload);
  const stop = (process.env.AI_STOP || "</json>,\n\n\n").split(",");
  const res = await ai.chatCompletion({
    system: SYS_PROMPT,
    messages: [
      { role: "user", content: `<json_request>${userContent}</json_request>\n<json>` },
    ],
    temperature: parseFloat(process.env.AI_TEMPERATURE || "0.1"),
    top_p: parseFloat(process.env.AI_TOP_P || "0.9"),
    top_k: parseInt(process.env.AI_TOP_K || "40", 10),
    max_tokens: parseInt(process.env.AI_MAX_NEW_TOKENS || "400", 10),
    stop,
  });

  const text = res?.content || "";
  const between = text.split("<json>")[1]?.split("</json>")[0];
  if (!between) return { unanswerable: true };

  let out;
  try {
    out = JSON.parse(between);
  } catch {
    return { unanswerable: true };
  }
  if (!validateJson(out, payload.passages)) return { unanswerable: true };

  // Normalize: limit bullets to 5, trim strings
  out.summary = (out.summary || "").trim();
  out.bullets = (out.bullets || [])
    .slice(0, 5)
    .map((b) => String(b).trim())
    .filter(Boolean);
  out.sources = (out.sources || []).filter(Boolean);
  return out;
}

module.exports = { compressPassages };

