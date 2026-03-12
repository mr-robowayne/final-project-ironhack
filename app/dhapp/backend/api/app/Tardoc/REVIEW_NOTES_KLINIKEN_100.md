# Review Notes – TARDOC Abrechnung (Stand: Repo-Analyse)

Geltungsbereich: `dhpatientsync_20251007_144615/` inkl. `Tardoc/` Doks (TARDOC, Pauschalen, GeneralInvoice 5.0, Anhänge).

## 1) Ergebnis (Go/No‑Go)

**No‑Go** für Rollout in **100 Kliniken** im aktuellen Stand, weil:

- **GeneralInvoice 5.0 XML Export ist ein Blocker**, bis er **in eurer Laufzeitumgebung XSD‑validiert** und mit realen Kostenträgern/EDI‑Flows getestet ist (Rückweisungsrisiko): XSD: `dhpatientsync_20251007_144615/Tardoc/generalInvoiceRequest_500.xsd:1397`, neue Implementierung: `dhpatientsync_20251007_144615/lib/invoices/generalInvoice50.js:125`, Integration: `dhpatientsync_20251007_144615/server.js:5678`, `dhpatientsync_20251007_144615/lib/invoices/service.js:270`
- **Regelabdeckung TARDOC/Pauschalen ist nur „best effort“/heuristisch** (Anhang C/F/G/H nicht vollständig operationalisiert): Validierung: `dhpatientsync_20251007_144615/server.js:5080`, Heuristik-Input: `dhpatientsync_20251007_144615/Tardoc/heuristic_rules.json:1`
- **Betrieb/Skalierung**: doppelte Flows (`/api/faelle` filebasiert + `/api/invoices` DB) → Risiko von Inkonsistenzen: `dhpatientsync_20251007_144615/server.js:5966`, Frontend: `dhpatientsync_20251007_144615/frontend/src/faelle.js:1716`

## 2) Analyse: Rechnen die Rechnungen „sauber und richtig“?

### 2.1 Source of Truth / Rechenfluss

Aktuell wird mehrfach gerechnet:

- Frontend berechnet pro Konsultation aus Taxpunkten → CHF: `dhpatientsync_20251007_144615/frontend/src/faelle.js:545`
- Claim wird an Server geschickt, Server normalisiert und berechnet totals erneut: `dhpatientsync_20251007_144615/server.js:5080`
- Beim DB‑Persistieren wird zusätzlich ein PDF erzeugt; totals können nochmals angepasst werden (VAT‑Helper): `dhpatientsync_20251007_144615/lib/invoices/service.js:133`

Für Produktion ist zwingend, dass **eine Stelle „source of truth“** ist (i.d.R. Server), und UI nur „Preview“.

### 2.2 Gefundene Rechenprobleme (behoben)

**A) `taxpoints_override` wurde serverseitig nicht in CHF berücksichtigt (kritisch)**  

- Problem: bei TARDOC‑Einzelleistungen (nicht Pauschale) konnte der Nutzer Taxpunkte manuell setzen (z.B. bei `AL/IPL=0` Positionen), aber `amount_chf` wurde aus `(al_points+tl_points)` berechnet → blieb 0, obwohl `taxpoints` > 0.
- Fix: Wenn `taxpoints_override` gesetzt ist (und keine expliziten `al_override`/`tl_override`), wird `al_points = taxpoints` gesetzt (tl=0), so dass CHF stimmt.
- Stellen: `dhpatientsync_20251007_144615/server.js:5367` und UI‑Spiegelung `dhpatientsync_20251007_144615/frontend/src/faelle.js:454`

**B) Prozent‑Zuschläge (AL/IPL‑Split) gingen verloren**  

- Problem: Zuschläge wurden als „alles AL“ gespeichert (tl=0), obwohl einige Zuschläge in der Definition TL‑Anteil haben (z.B. `KF.10.0130` 40% AL / 20% IPL).
- Fix: Server/Frontend behalten **Split**: `al_points=tpFromAl`, `tl_points=tpFromTl`, `taxpoints=Summe` (bei Auto‑Berechnung; bei manuellem Taxpunkte‑Override bleibt tl=0).
- Stellen: Server `dhpatientsync_20251007_144615/server.js:5448`, Frontend `dhpatientsync_20251007_144615/frontend/src/faelle.js:454`

### 2.4 Datenfelder für GeneralInvoice 5.0 (Geschlecht / Sex)

- GeneralInvoice 5.0 verlangt `patient.gender` (male|female|diverse) **und** `patient.sex` (male|female). Bei `gender=diverse` ist `sex` zwingend.
- Umsetzung:
  - Neues Feld `patients.treated_sex` (Migration): `dhpatientsync_20251007_144615/migrations/20251217-220_add_treated_sex_to_patients.sql:1`
  - API liefert/akzeptiert `treated_sex`: `dhpatientsync_20251007_144615/server.js:520`
  - UI‑Erfassung bei „Divers“: `dhpatientsync_20251007_144615/frontend/src/Benutzererstellen.js:75`, `dhpatientsync_20251007_144615/frontend/src/App.js:1122`

### 2.3 Offene Rechen-/Fachrisiken (nicht gelöst, aber wichtig)

**1) Taxpunktwert (CHF/TP) ist nur „Beispiel“-Logik / falsche Ableitung**  
- UI nutzt Kanton aus Rechnungs‑PLZ („Kanton für Rechnungs-PLZ“) als Basis für den Punktwert: `dhpatientsync_20251007_144615/frontend/src/faelle.js:956`
- Anhang H: Taxpunktwert wird in separaten Verträgen geregelt; nicht aus PLZ ableitbar: `dhpatientsync_20251007_144615/Tardoc/pdf_texts/250430_AnhangH_Rechnungsstellung.txt:20`
- Risiko: falsche CHF‑Beträge trotz korrekter Taxpunkte.
 - Umsetzung (neu): Mandanten‑Settings `billing.pointValues` + optionales Erzwingen serverseitig: API `dhpatientsync_20251007_144615/server.js:1761`, UI Editor `dhpatientsync_20251007_144615/frontend/src/BillingSettings.js:1`

**2) Rundungsregeln / Summenbildung**  
- Aktuell: pro Linie auf 2 Dezimalstellen gerundet; Total = Summe Linien. Je nach Vorgabe (Forum Datenaustausch / Kostenträger) kann abweichende Total‑Rundung verlangt sein.

**3) Notfall-/Zeitfenster-Zuschläge sind validiert, aber UI liefert keine Uhrzeit**  
- Server verlangt `time` bei Notfall-Zuschlägen: `dhpatientsync_20251007_144615/server.js:5332`
- UI hat keine verpflichtende Zeit-Eingabe für solche Leistungen → echte Fälle werden blockieren.

**4) VAT/MWST Modell ist inkonsistent**  
- `computeVatTotals` nimmt default `KVG` an und setzt VAT=0; Selbstzahler‑Fälle werden nicht sauber als eigener BillingType modelliert: `dhpatientsync_20251007_144615/lib/invoices/service.js:134`
- Für viele medizinische Leistungen ist VAT=0 korrekt, aber für Zusatzleistungen/Produkte braucht ihr ein klares Modell (pro Linie steuerbar).

## 3) Anpassungen (priorisiert)

### MUST (Blocker)
- **GeneralInvoice 5.0 Export XSD‑konform implementieren** (tiers_garant/payant/soldant, balance/vat, esrQR/esrQRRed, Pflichtattribute wie `request_timestamp`, Patient `gender/sex`, etc.): `dhpatientsync_20251007_144615/Tardoc/generalInvoiceRequest_500.xsd:1254`
- **Taxpunktwert-Quelle korrekt**: pro Mandant/Kostenträger/Vertrag/Periode; nicht aus PLZ „raten“. UI braucht Auswahl/Regelwerk, Server muss es erzwingen.
- **Regelwerk C/F/G/H** auf produktionsreife Validierung bringen (nicht nur heuristisch).

### Rollout (Punktwert)
- Konfiguration via UI: Menü → `Abrechnung (Punktwert)` (`dhpatientsync_20251007_144615/frontend/src/BillingSettings.js:1`)
- Serverseitig erzwingen: `enforce_point_value=true` (dann überschreibt der Server `settlement.point_value_chf` gemäss Konfiguration)

### Validierung (empfohlen)
- XSD‑Validation lokal: `bash dhpatientsync_20251007_144615/scripts/validate_generalinvoice50_xsd.sh --samples`
- XSD‑Validation erzeugter XMLs: `bash dhpatientsync_20251007_144615/scripts/validate_generalinvoice50_xsd.sh --latest` (nach dem Erstellen einer Rechnung)
- Hinweis: `generalInvoiceRequest_500.xsd`/`generalInvoiceResponse_500.xsd` verwenden lokale Vendor‑Schemas (ohne externe Downloads): `dhpatientsync_20251007_144615/Tardoc/vendor/xmldsig-core-schema.xsd:1`, `dhpatientsync_20251007_144615/Tardoc/vendor/xenc-schema.xsd:1`

### SHOULD
- Rechen-Source-of-truth vereinheitlichen (Server), Frontend nur Preview.
- `/api/faelle` vs `/api/invoices` konsolidieren oder klare Synchronisations-/Migrationsstrategie.

### COULD
- Auditierbarkeit: pro Rechnung „Rechenprotokoll“ (welche Regeln/Overrides griffen) als persistierte Struktur.
- Regressionstest-Suite: Katalog-Updates (TARDOC/Pauschalen) gegen feste „Goldens“.
