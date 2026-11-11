// Galaxus Preis-Tracker: fragt die Preise der Merkliste über den öffentlichen
// Galaxus-MCP-Server ab, speichert den Verlauf und schreibt fällige Meldungen
// nach meldungen.md (daraus erstellt der GitHub-Workflow ein Issue = E-Mail).
import { readFile, writeFile, rm } from "node:fs/promises";

const MCP_URL = "https://mcp.galaxus.ch/";
const MERKLISTE = "merkliste.json";
const VERLAUF = "preisverlauf.json";
const MELDUNGEN = "meldungen.md";
const UEBERSICHT = "README.md";

let sessionId = null;
let rpcId = 0;

async function rpc(method, params, isNotification = false) {
  const msg = { jsonrpc: "2.0", method, params };
  if (!isNotification) msg.id = ++rpcId;
  const headers = {
    "Content-Type": "application/json",
    Accept: "application/json, text/event-stream",
    "MCP-Protocol-Version": "2025-06-18",
  };
  if (sessionId) headers["Mcp-Session-Id"] = sessionId;
  const res = await fetch(MCP_URL, { method: "POST", headers, body: JSON.stringify(msg) });
  if (!res.ok && res.status !== 202) throw new Error(`${method}: HTTP ${res.status}`);
  sessionId = res.headers.get("mcp-session-id") ?? sessionId;
  if (isNotification) return null;
  const text = await res.text();
  // Antwort kommt als JSON oder als Server-Sent-Events ("data: {...}")
  const json = text.trimStart().startsWith("{")
    ? JSON.parse(text)
    : JSON.parse(text.split("\n").filter((l) => l.startsWith("data:")).map((l) => l.slice(5)).join(""));
  if (json.error) throw new Error(`${method}: ${json.error.message}`);
  return json.result;
}

async function sucheProdukte(query) {
  const result = await rpc("tools/call", {
    name: "search_products",
    arguments: { query, language: "de", first: 30, agentInfo: "Galaxus Preis-Tracker (GitHub Actions)" },
  });
  const text = result.content?.find((c) => c.type === "text")?.text ?? "{}";
  return JSON.parse(text).products ?? [];
}

const chf = (n) => `CHF ${Number(n).toFixed(2)}`;
const jetzt = () =>
  new Date().toLocaleString("sv-SE", { timeZone: "Europe/Zurich" }).slice(0, 16);

// Übersichtsseite (README.md), die GitHub auf der Startseite des Repos anzeigt
function uebersicht(merkliste, verlauf) {
  const zeilen = [
    "# Galaxus Preis-Tracker",
    "",
    `Zuletzt geprüft: **${jetzt()}** · Prüfung täglich 09:00 und 18:00 · [Anleitung](LIESMICH.md)`,
    "",
    "| Produkt | Aktuell | Vorher | Tiefstpreis | Höchstpreis | Wunschpreis |",
    "|---|---:|---:|---:|---:|---:|",
  ];
  const kurven = [];
  for (const p of merkliste.produkte) {
    const preise = verlauf[p.id]?.preise ?? [];
    if (!preise.length) {
      zeilen.push(`| [${p.name}](${p.url}) | – | – | – | – | ${p.wunschpreis ? chf(p.wunschpreis) : "–"} |`);
      continue;
    }
    const werte = preise.map((e) => e.preis);
    const aktuell = werte.at(-1);
    const vorher = werte.length > 1 ? werte.at(-2) : null;
    const pfeil = vorher == null || aktuell === vorher ? "" : aktuell < vorher ? " 🟢" : " 🔴";
    const tiefst = Math.min(...werte);
    zeilen.push(
      `| [${p.name}](${p.url}) | **${chf(aktuell)}**${pfeil} | ${vorher != null ? chf(vorher) : "–"} | ${chf(tiefst)}${aktuell === tiefst ? " ⭐" : ""} | ${chf(Math.max(...werte))} | ${p.wunschpreis ? chf(p.wunschpreis) : "–"} |`,
    );

    // Pro Tag den letzten Preis, höchstens 60 Tage, damit die Kurve lesbar bleibt
    const proTag = new Map();
    for (const e of preise) proTag.set(e.datum.slice(0, 10), e.preis);
    const tage = [...proTag].slice(-60);
    const min = Math.min(...tage.map(([, v]) => v));
    const max = Math.max(...tage.map(([, v]) => v));
    const rand = Math.max(1, (max - min) * 0.2);
    kurven.push(
      `### ${p.name}`,
      "",
      "```mermaid",
      "xychart-beta",
      `  x-axis [${tage.map(([d]) => `"${d.slice(8, 10)}.${d.slice(5, 7)}."`).join(", ")}]`,
      `  y-axis "CHF" ${Math.max(0, Math.floor(min - rand))} --> ${Math.ceil(max + rand)}`,
      `  line [${tage.map(([, v]) => v).join(", ")}]`,
      "```",
      "",
    );
  }
  zeilen.push("", "🟢 günstiger als zuletzt · 🔴 teurer als zuletzt · ⭐ aktuell Tiefstpreis", "");
  if (kurven.length) zeilen.push("## Preisverlauf", "", ...kurven);
  return zeilen.join("\n");
}

async function main() {
  const merkliste = JSON.parse(await readFile(MERKLISTE, "utf8"));
  let verlauf = {};
  try { verlauf = JSON.parse(await readFile(VERLAUF, "utf8")); } catch {}
  await rm(MELDUNGEN, { force: true });

  await rpc("initialize", {
    protocolVersion: "2025-06-18",
    capabilities: {},
    clientInfo: { name: "galaxus-preis-tracker", version: "1.0" },
  });
  await rpc("notifications/initialized", {}, true);

  const meldungen = [];
  for (const p of merkliste.produkte) {
    let treffer = (await sucheProdukte(p.suchbegriff || p.name)).find((x) => x.id === p.id);
    if (!treffer && p.name && p.name !== p.suchbegriff) {
      treffer = (await sucheProdukte(p.name)).find((x) => x.id === p.id);
    }
    const preis = treffer?.priceIfAvailable?.amountInclusive;
    if (preis == null) {
      console.log(`- ${p.name}: nicht gefunden oder kein Preis`);
      continue;
    }

    const eintraege = (verlauf[p.id] ??= { name: p.name, preise: [] }).preise;
    const letzter = eintraege.at(-1)?.preis;
    const tiefst = eintraege.length ? Math.min(...eintraege.map((e) => e.preis)) : null;
    eintraege.push({ datum: jetzt(), preis });

    const gruende = [];
    if (letzter != null && preis < letzter) gruende.push(`günstiger als zuletzt (${chf(letzter)})`);
    if (tiefst != null && preis < tiefst) gruende.push(`neuer Tiefstpreis (bisher ${chf(tiefst)})`);
    if (p.wunschpreis && preis <= p.wunschpreis && !(letzter != null && letzter <= p.wunschpreis)) {
      gruende.push(`Wunschpreis ${chf(p.wunschpreis)} erreicht`);
    }

    console.log(`- ${p.name}: ${chf(preis)}${letzter != null ? ` (vorher ${chf(letzter)})` : ""}${gruende.length ? " -> MELDUNG" : ""}`);
    if (gruende.length) {
      meldungen.push(`### ${p.name}: jetzt ${chf(preis)}\n${gruende.map((g) => `- ${g}`).join("\n")}\n\n${p.url}`);
    }
  }

  await writeFile(VERLAUF, JSON.stringify(verlauf, null, 2) + "\n");
  await writeFile(UEBERSICHT, uebersicht(merkliste, verlauf));
  if (meldungen.length) {
    await writeFile(MELDUNGEN, meldungen.join("\n\n") + "\n");
    console.log(`${meldungen.length} Meldung(en) geschrieben.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
