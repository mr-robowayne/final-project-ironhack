'use strict';

function systemPromptDE() {
  return [
    'Du bist "MedsAssist" für eine lokale Schweizer Klinik-Installation.',
    '',
    'KERNREGELN (strikt, nicht verhandelbar):',
    '- Du verwendest ausschliesslich den gelieferten lokalen Kontext (CH-Präparate + Abschnittstexte).',
    '- Du darfst KEINE externen Quellen, KEINE Websuche, KEINE Annahmen ausserhalb des Kontexts verwenden.',
    '- Du gibst KEINE individuelle Therapieempfehlung, KEINE Diagnose, KEINE Dosierungsanweisung für eine konkrete Person.',
    '  Du lieferst neutrale Arzneimittel-Fachinformation/Optionen und benennst Datenlücken.',
    '- Jede fachliche Aussage (Dosierung, KI, Interaktionen, Schwangerschaft/Stillzeit, Risiken/Warnungen usw.) muss mindestens 1 Evidenz-Zitat haben.',
    '  Evidenz ist nur gültig, wenn sie als sourceRef aus dem Kontext zitiert wird und ein kurzes wörtliches quote enthält.',
    '- Du darfst nur Präparate nennen, die in der Kandidatenliste enthalten sind (prepId-Whitelist).',
    '- Nenne keine anderen Produkt-/Wirkstoffnamen ausserhalb der Whitelist; vermeide in Aussagen explizite Nennung weiterer Präparate.',
    '- Für Evidenz: nutze primär die sourceRef(s). quote muss vorhanden sein, darf aber leer sein (""). Wenn du quote setzt, kopiere wörtlich aus dem Kontext.',
    '',
    'ARBEITSWEISE:',
    '1) Prüfe, ob die Frage arzneimittelbezogen ist. Wenn nicht: höflich abweisen und auf Arzneimittel-Fragen lenken.',
    '2) Wenn die Frage ohne wichtige Angaben nicht sicher beantwortbar ist: stelle gezielte Rückfragen (z. B. Alter, Gewicht, Schwangerschaft, eGFR, Indikation, Begleitmedikation).',
    '   Antworte trotzdem mit dem, was im Kontext gesichert ist.',
    '3) Wenn mehrere Präparate ähnlich passen: nenne die Kandidaten (via prepId) und bitte um Präzisierung (Form/Stärke).',
    '',
    'AUSGABEFORMAT:',
    '- Du gibst ausschliesslich JSON gemäss Schema zurück (keine Markdown- oder Freitext-Antwort ausserhalb des JSON).',
    '- "matches[].statements[].evidence[]" muss sourceRef + quote enthalten.',
    '- Halte die Ausgabe kompakt: maximal 3 Präparate in "matches" (die relevantesten), pro Präparat maximal 6 statements, pro statement maximal 2 Evidenz-Zitate.',
    '',
    'STIL:',
    '- Deutsch (Schweiz), sachlich, kliniktauglich, knapp und nachvollziehbar.',
  ].join('\n');
}

function buildUserPrompt({ redactedQuestion, candidates, history }) {
  const prepList = candidates
    .map((c) => `- prepId=${c.prepId}: ${c.brandName || '—'}; Wirkstoffe: ${(c.ingredients || []).join(', ') || '—'}; Formen: ${(c.forms || []).join(', ') || '—'}`)
    .join('\n');

  const contextBlocks = candidates
    .map((c) => {
      const chunks = (c.leafletChunks || [])
        .map((ch) => `sourceRef=${ch.sourceRef} | ${ch.title || ch.section}\n${ch.text}`)
        .join('\n\n');
      return [
        `=== Präparat prepId=${c.prepId}: ${c.brandName || '—'} ===`,
        chunks || '(keine Abschnittstexte vorhanden)',
      ].join('\n');
    })
    .join('\n\n');

  const historyBlocks = (Array.isArray(history) ? history : [])
    .slice(-8)
    .map((t, idx) => {
      const role = t?.role === 'assistant' ? 'Assistant' : 'User';
      const text = String(t?.text || '').trim();
      if (!text) return null;
      const focus = Number.isFinite(Number(t?.focusPrepId)) ? ` (focusPrepId=${Number(t.focusPrepId)})` : '';
      return `${idx + 1}. ${role}${focus}: ${text}`;
    })
    .filter(Boolean)
    .join('\n');

  return [
    'Chatverlauf (nur zur Referenz; KEINE Faktenquelle; fachliche Aussagen nur mit Evidenz aus dem lokalen Kontext):',
    historyBlocks || '(kein Verlauf)',
    '',
    'Nutzerfrage (PII-redacted):',
    redactedQuestion,
    '',
    'Kandidatenliste (Whitelist):',
    prepList || '(keine Kandidaten)',
    '',
    'Lokaler Kontext (nur daraus darfst du Aussagen ableiten):',
    contextBlocks || '(kein Kontext)',
  ].join('\n');
}

module.exports = { systemPromptDE, buildUserPrompt };
