# Galaxus Preis-Tracker

Läuft komplett bei GitHub (GitHub Actions), dein PC muss nicht an sein.
Zweimal täglich (09:00 und 18:00 Zürcher Zeit) werden die Preise der Produkte in
`merkliste.json` über die öffentliche Galaxus-Schnittstelle (mcp.galaxus.ch) abgefragt.

## Wie kommt die E-Mail?
Wenn ein Preis fällt, erstellt der Workflow ein neues Issue in diesem Repo und weist es dir zu.
GitHub schickt dir dafür automatisch eine E-Mail an deine GitHub-Adresse.
(Einstellung: github.com/settings/notifications, "Email" muss für "Watching"/"Participating" aktiv sein.)

## Wann gibt es eine Meldung?
- Der Preis ist tiefer als bei der letzten Prüfung, oder
- der Preis ist der tiefste bisher gemessene, oder
- der Preis ist neu auf oder unter deinem `wunschpreis`.

## Dateien
- `merkliste.json` – die überwachten Produkte
- `preisverlauf.json` – alle gemessenen Preise (wird automatisch aktualisiert)
- `tracker.mjs` – das Script
- `.github/workflows/preise-pruefen.yml` – Zeitplan

## Produkt hinzufügen
In `merkliste.json` (direkt auf github.com bearbeitbar) unter `produkte` einen Eintrag ergänzen:

```json
{ "id": 61940134, "name": "AirPods Pro 3", "suchbegriff": "AirPods Pro 3", "url": "https://www.galaxus.ch/de/s1/product/...-61940134", "wunschpreis": 180 }
```

Die `id` ist die Zahl am Ende des Galaxus-Links, `wunschpreis` ist optional.

## Sofort prüfen
Im Repo unter "Actions" → "Galaxus Preise prüfen" → "Run workflow".
