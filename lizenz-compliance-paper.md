# Anforderungs- und Umsetzungspapier

## npm-Paket zur automatisierten Lizenz-Compliance-Prüfung verschachtelter Dependencies

**Arbeitstitel:** `license-guard` (Name vor Veröffentlichung auf Verfügbarkeit prüfen, siehe Abschnitt 9.1)
**Version des Papiers:** 1.0
**Datum:** 15. Juli 2026

---

## 1. Problemstellung und Zielsetzung

### 1.1 Problem

JavaScript-Projekte enthalten über ihre direkten Abhängigkeiten hinaus hunderte bis tausende transitive (verschachtelte) Dependencies. Jede davon steht unter einer eigenen Lizenz. Für kommerzielle Software sind bestimmte Lizenzen (insbesondere Copyleft-Lizenzen wie GPL-3.0 oder AGPL-3.0) rechtlich problematisch, da sie unter Umständen die Offenlegung des eigenen Quellcodes verlangen. Die manuelle Prüfung dieser Lizenzlage ist extrem zeitaufwendig und fehleranfällig. Bestehende Tools (z. B. `license-checker`) sind veraltet, bieten keine Policy-Logik und sind nicht für die Integration in moderne CI/CD-Pipelines konzipiert.

### 1.2 Ziel

Ein leichtgewichtiges, modernes CLI-Tool als npm-Paket, das:

1. den vollständigen Abhängigkeitsbaum eines Projekts analysiert,
2. die Lizenz jedes Pakets zuverlässig ermittelt,
3. diese gegen eine vom Nutzer definierte Policy (Allow-/Deny-Liste) prüft,
4. maschinen- und menschenlesbare Reports erzeugt,
5. sich über Exit-Codes nahtlos in CI-Pipelines integrieren lässt.

### 1.3 Nicht-Ziele (bewusste Abgrenzung für Version 1.0)

- Keine Rechtsberatung: Das Tool klassifiziert Lizenzen, bewertet aber keine juristischen Einzelfälle.
- Keine Unterstützung anderer Ökosysteme (PyPI, Maven, Cargo) in v1.
- Kein gehostetes Dashboard/SaaS in v1 (mögliche spätere Monetarisierung, siehe Abschnitt 10).
- Keine automatische "Reparatur" (Austausch problematischer Pakete).

---

## 2. Funktionale Anforderungen

| ID | Anforderung | Priorität |
|----|-------------|-----------|
| F-01 | Das Tool parst `package-lock.json` (lockfileVersion 2 und 3) und ermittelt daraus den vollständigen Dependency-Baum inkl. transitiver Abhängigkeiten. | Muss |
| F-02 | Für jedes Paket wird die Lizenz aus dem `license`-Feld der jeweiligen `package.json` in `node_modules` gelesen. | Muss |
| F-03 | Fehlt das `license`-Feld oder ist es ungültig, greift eine Fallback-Heuristik: Suche nach `LICENSE`-, `LICENCE`-, `COPYING`-Dateien und Erkennung des Lizenztexts per Mustervergleich. | Muss |
| F-04 | Alle erkannten Lizenzen werden auf gültige SPDX-Identifier normalisiert (z. B. "Apache 2.0" → "Apache-2.0"). | Muss |
| F-05 | SPDX-Lizenzausdrücke mit Operatoren (`MIT OR Apache-2.0`, `(GPL-2.0 AND MIT)`) werden korrekt geparst und ausgewertet. | Muss |
| F-06 | Der Nutzer definiert eine Policy in einer Konfigurationsdatei (`.licenseguardrc.json`): `allow`-Liste, `deny`-Liste, optionale Paket-Ausnahmen (`overrides`). | Muss |
| F-07 | Bei Verstoß gegen die Policy beendet sich das Tool mit Exit-Code 1 (CI-tauglich); ohne Verstoß mit Exit-Code 0. | Muss |
| F-08 | Report-Ausgabe als: farbige Terminal-Tabelle (Standard), JSON (`--json`), CSV (`--csv`), HTML (`--html`). | Muss (Terminal + JSON), Soll (CSV, HTML) |
| F-09 | Unterscheidung zwischen `dependencies` und `devDependencies`; devDependencies können per Flag (`--production`) ausgeschlossen werden. | Muss |
| F-10 | Unterstützung von `pnpm-lock.yaml` und `yarn.lock` (Classic v1 und Berry). | Soll (v1.1+) |
| F-11 | Unterstützung von npm-Workspaces / Monorepos. | Soll (v1.1+) |
| F-12 | Flag `--summary`: aggregierte Übersicht (Anzahl Pakete pro Lizenz) statt vollständiger Liste. | Soll |
| F-13 | Unbekannte/nicht ermittelbare Lizenzen werden als eigene Kategorie `UNKNOWN` ausgewiesen und können per Policy als Fehler oder Warnung behandelt werden. | Muss |
| F-14 | Caching der Ergebnisse (Hash des Lockfiles), damit wiederholte Läufe ohne Änderungen schnell sind. | Kann |

### 2.1 Beispiel-Konfiguration

```json
{
  "allow": ["MIT", "ISC", "Apache-2.0", "BSD-2-Clause", "BSD-3-Clause"],
  "deny": ["GPL-3.0-only", "GPL-3.0-or-later", "AGPL-3.0-only", "AGPL-3.0-or-later"],
  "unknownLicense": "error",
  "overrides": {
    "some-internal-package": "ignore"
  },
  "production": true
}
```

### 2.2 Beispiel-Aufrufe

```bash
npx license-guard                       # Standard-Prüfung mit Terminal-Report
npx license-guard --json > report.json  # JSON-Export
npx license-guard --production          # Nur Produktions-Dependencies
npx license-guard --summary             # Aggregierte Übersicht
npx license-guard init                  # Erzeugt eine Beispiel-Config
```

---

## 3. Nicht-funktionale Anforderungen

| ID | Anforderung |
|----|-------------|
| NF-01 | **Performance:** Analyse eines Projekts mit 1.500 Paketen in unter 5 Sekunden (ohne Netzwerkzugriffe). |
| NF-02 | **Offline-Fähigkeit:** Keine Netzwerkzugriffe zur Laufzeit; alle Daten stammen aus dem lokalen Projekt. Wichtig für Firmen mit restriktiven Proxys. |
| NF-03 | **Minimale eigene Dependencies:** Maximal 5 Runtime-Dependencies. Ein Compliance-Tool mit riesigem eigenen Dependency-Baum wäre unglaubwürdig. |
| NF-04 | **Node-Kompatibilität:** Node.js ≥ 18 (LTS), deklariert über das `engines`-Feld. |
| NF-05 | **Cross-Platform:** Lauffähig unter Linux, macOS und Windows (Pfad-Handling mit `path.join`, keine Shell-spezifischen Befehle). |
| NF-06 | **TypeScript:** Implementierung in TypeScript, Auslieferung mit Type-Definitionen (`.d.ts`), Dual-Build ESM + CommonJS. |
| NF-07 | **Deterministische Ergebnisse:** Gleicher Input → identischer Output (sortierte Ausgabe, keine Zufallsreihenfolge). |
| NF-08 | **Testabdeckung:** Mindestens 80 % für die Kernmodule (Parser, Lizenz-Erkennung, Policy-Engine). |

---

## 4. Architektur

### 4.1 Modulübersicht

```
license-guard/
├── src/
│   ├── cli.ts               # Einstiegspunkt, Argument-Parsing, Exit-Codes
│   ├── config/
│   │   └── loader.ts        # Lädt und validiert .licenseguardrc.json
│   ├── lockfile/
│   │   ├── types.ts         # Gemeinsames internes Baum-Format (WICHTIG!)
│   │   ├── npm.ts           # Parser für package-lock.json v2/v3
│   │   ├── pnpm.ts          # Parser für pnpm-lock.yaml (v1.1)
│   │   └── yarn.ts          # Parser für yarn.lock (v1.1)
│   ├── license/
│   │   ├── extractor.ts     # Liest license-Feld aus node_modules
│   │   ├── heuristics.ts    # Fallback: LICENSE-Dateien erkennen
│   │   ├── spdx.ts          # Normalisierung + Ausdrucks-Parser
│   │   └── corrections.ts   # Bekannte Fehl-Deklarationen (kuratierte Liste)
│   ├── policy/
│   │   └── engine.ts        # Allow/Deny-Auswertung, Overrides
│   ├── report/
│   │   ├── terminal.ts      # Farbige Tabelle
│   │   ├── json.ts
│   │   ├── csv.ts
│   │   └── html.ts
│   └── index.ts             # Programmatische API (für Nutzung als Library)
├── test/
│   ├── fixtures/            # Echte Lockfiles verschiedener Versionen als Testdaten
│   └── ...
├── package.json
├── tsconfig.json
└── README.md
```

### 4.2 Zentrale Designentscheidung: internes Baum-Format

Der wichtigste Architektur-Baustein ist ein **normalisiertes internes Datenformat**, in das alle Lockfile-Parser übersetzen:

```typescript
interface ResolvedPackage {
  name: string;
  version: string;
  path: string;              // Pfad in node_modules
  dev: boolean;              // devDependency?
  optional: boolean;
  declaredLicense: string | null;   // aus package.json
  detectedLicense: string | null;   // aus Heuristik
  finalLicense: string;             // normalisierter SPDX-Ausdruck oder "UNKNOWN"
  licenseSource: "declared" | "detected" | "override" | "unknown";
}
```

Dadurch bleiben Policy-Engine und Reporter vollständig unabhängig vom Paketmanager. Neue Lockfile-Formate erfordern nur einen neuen Parser, sonst nichts.

### 4.3 Verarbeitungspipeline

```
Lockfile lesen → Baum normalisieren → Lizenzen extrahieren →
SPDX normalisieren → Policy anwenden → Report generieren → Exit-Code
```

### 4.4 Empfohlene Runtime-Dependencies

| Paket | Zweck | Begründung |
|-------|-------|------------|
| `spdx-expression-parse` | Parsen von SPDX-Ausdrücken (`MIT OR GPL-2.0`) | De-facto-Standard, winzig |
| `spdx-license-ids` | Liste gültiger SPDX-Identifier | Offizielle Datenquelle |
| `spdx-correct` | Korrektur häufiger Schreibfehler ("Apache 2" → "Apache-2.0") | Spart eigene Heuristik |
| `picocolors` | Terminal-Farben | Kleinste verfügbare Lösung |
| `yaml` | pnpm-lock.yaml parsen (erst ab v1.1) | Nur wenn pnpm-Support kommt |

Argument-Parsing kann mit dem in Node 18+ eingebauten `util.parseArgs` erfolgen – spart eine Dependency.

---

## 5. Fehlerquellen und Risiken (mit Gegenmaßnahmen)

Dies ist der kritischste Abschnitt. Die folgenden Probleme entscheiden darüber, ob das Tool in der Praxis vertrauenswürdig ist.

### 5.1 Lockfile-Parsing (hohes Risiko)

| Problem | Beschreibung | Gegenmaßnahme |
|---------|--------------|---------------|
| Format-Varianten | `package-lock.json` existiert in lockfileVersion 1, 2 und 3 mit unterschiedlicher Struktur (`dependencies` vs. `packages`). | v1 explizit ablehnen mit klarer Fehlermeldung ("Bitte npm ≥ 7 verwenden"); v2/v3 über das `packages`-Objekt parsen, das in beiden vorhanden ist. |
| Fehlendes Lockfile | Projekt wurde nie installiert oder nutzt anderen Paketmanager. | Erkennung aller drei Lockfile-Typen; klare Fehlermeldung mit Handlungsanweisung. |
| Lockfile ≠ node_modules | Lockfile aktualisiert, aber `npm install` nicht ausgeführt → Lizenzdaten fehlen auf der Platte. | Konsistenz-Check: Existiert der Pfad aus dem Lockfile in `node_modules`? Wenn nicht → Warnung "Bitte npm install ausführen". |
| Workspaces/Monorepos | `node_modules` liegt im Root, Pakete verweisen aufeinander per `link:`. | In v1 dokumentiert nicht unterstützen (klare Fehlermeldung), in v1.1 sauber lösen. Halbherziger Support wäre gefährlicher als keiner. |
| Aliase | `npm install foo@npm:bar` erzeugt Einträge, bei denen Name im Baum ≠ tatsächliches Paket. | Das `resolved`-/`name`-Feld im packages-Objekt nutzen, nicht den Pfad-Schlüssel. |

### 5.2 Lizenz-Erkennung (mittleres bis hohes Risiko)

| Problem | Beschreibung | Gegenmaßnahme |
|---------|--------------|---------------|
| Fehlendes `license`-Feld | Ältere oder schlampig gepflegte Pakete deklarieren keine Lizenz. | Heuristik über LICENSE-Dateien; wenn auch das scheitert → ehrlich als `UNKNOWN` ausweisen, niemals raten. |
| Veraltete Formate | `"license": {"type": "MIT", "url": "..."}` (Objekt-Form) oder `"licenses": [...]` (Array, deprecated). | Beide Altformate explizit unterstützen und normalisieren. |
| Falsche Deklarationen | package.json sagt MIT, LICENSE-Datei enthält GPL. | Wenn deklarierte und erkannte Lizenz abweichen → Warnung im Report mit beiden Werten. Kuratierte Korrektur-Liste (`corrections.ts`) für bekannte Fälle. |
| Nicht-SPDX-Angaben | "BSD", "Apache", "Public Domain", "WTFPL-Varianten". | `spdx-correct` einsetzen; nicht Korrigierbares als `UNKNOWN` mit Original-String im Report. |
| Komplexe Ausdrücke | `(MIT OR GPL-3.0)` – Dual-Licensing. | Policy-Regel: Ein OR-Ausdruck gilt als erlaubt, wenn **mindestens eine** Alternative erlaubt ist. Ein AND-Ausdruck nur, wenn **alle** Teile erlaubt sind. Dieses Verhalten explizit dokumentieren. |
| Lizenztext-Erkennung unzuverlässig | Fuzzy-Matching von Lizenztexten kann falsch klassifizieren. | Nur exakte, hochkonfidente Muster verwenden (z. B. charakteristische Kopfzeilen der MIT/Apache/GPL-Texte); im Zweifel `UNKNOWN`. Ein falsches "MIT" ist schlimmer als ein ehrliches "UNKNOWN". |

### 5.3 Policy-Engine

| Problem | Beschreibung | Gegenmaßnahme |
|---------|--------------|---------------|
| Konflikt Allow vs. Deny | Lizenz steht in beiden Listen. | Validierung beim Config-Laden: Überschneidung → sofortiger Abbruch mit Fehlermeldung. |
| Lizenz in keiner Liste | Weder erlaubt noch verboten. | Konfigurierbares Default-Verhalten (`unlistedLicense: "warn" | "error" | "allow"`), Standard: `warn`. |
| Tippfehler in der Config | Nutzer schreibt "GPL3" statt "GPL-3.0-only". | Config-Einträge selbst durch `spdx-correct` validieren; bei unbekannten Einträgen Abbruch mit Vorschlag ("Meintest du GPL-3.0-only?"). |
| Missbrauch von Overrides | Overrides könnten Verstöße dauerhaft verschleiern. | Overrides erscheinen immer sichtbar im Report ("3 Pakete per Override ignoriert"). |

### 5.4 Betrieb und Umgebung

| Problem | Beschreibung | Gegenmaßnahme |
|---------|--------------|---------------|
| Windows-Pfade | Backslashes, Pfadlängen-Limit. | Konsequent `node:path` verwenden; CI-Tests auf Windows (GitHub Actions Matrix). |
| Riesige Projekte | 5.000+ Pakete, Speicherverbrauch. | Streaming ist unnötig komplex; stattdessen: keine Duplikate im Speicher halten (Map nach `name@version`), Benchmark-Test in CI. |
| Symlinks | `npm link`, pnpm-Store nutzt Symlinks massiv. | `fs.realpath` beim Lesen; Zyklen-Erkennung beim Baum-Traversieren. |
| Kaputte package.json | Ungültiges JSON in einer Dependency. | try/catch pro Paket; Fehler sammeln und am Ende als Warnung ausgeben, niemals den Gesamtlauf abbrechen. |

### 5.5 Rechtliches und Vertrauen (nicht unterschätzen)

- **Haftungsausschluss:** README und Report müssen klar sagen, dass das Tool keine Rechtsberatung ersetzt und Ergebnisse ohne Gewähr sind. Formulierung wie: "Dieses Tool liefert technische Hinweise zur Lizenzlage. Für rechtsverbindliche Aussagen konsultieren Sie eine Rechtsberatung."
- **Eigene Lizenz:** Das Tool selbst unter MIT oder Apache-2.0 veröffentlichen. Ein Compliance-Tool unter GPL wäre für die Zielgruppe (kommerzielle Nutzer) abschreckend.
- **Supply-Chain-Vertrauen:** npm-Veröffentlichung mit `--provenance` (verknüpft das Paket kryptografisch mit dem GitHub-Repo und Build). Für ein Sicherheits-/Compliance-Tool ist das Pflicht, nicht Kür.

---

## 6. Teststrategie

1. **Unit-Tests** (Vitest): SPDX-Normalisierung, Policy-Auswertung (inkl. OR/AND-Ausdrücke), Config-Validierung. Jede Zeile der Policy-Engine muss getestet sein – hier entstehen die peinlichsten Bugs.
2. **Fixture-Tests:** Echte, eingefrorene Lockfiles (npm v2, npm v3, kleines Projekt, großes Projekt, Projekt mit Aliassen) als Testdaten im Repo. Erwartete Ausgabe als Snapshot.
3. **Integrationstests:** Temporäres Testprojekt erzeugen, echtes `npm install` in CI, dann Tool dagegen laufen lassen.
4. **Selbsttest ("Dogfooding"):** Das Tool prüft in der eigenen CI seine eigenen Dependencies. Perfekte Demo und Regressionsschutz zugleich.
5. **Cross-Platform-CI:** GitHub-Actions-Matrix mit ubuntu-latest, windows-latest, macos-latest × Node 18/20/22.
6. **Negativtests:** Kaputtes Lockfile, fehlendes node_modules, ungültige Config, leeres Projekt – alle müssen saubere, verständliche Fehlermeldungen liefern.

---

## 7. Working Tree: Alle Schritte bis zur Veröffentlichung

### Phase 0 — Vorbereitung (ca. 1 Tag)

- [ ] Paketname auf npmjs.com auf Verfügbarkeit prüfen (auch ähnliche Namen wegen Verwechslungsgefahr, siehe 9.1)
- [ ] GitHub-Repository anlegen (public)
- [ ] npm-Account anlegen, **2FA aktivieren** (ab August 2026 werden npm-Tokens, die 2FA umgehen, für Account-Änderungen eingeschränkt; ab Januar 2027 auch fürs direkte Publishing — das Setup also gleich zukunftssicher machen)
- [ ] Lizenz für das eigene Paket wählen (Empfehlung: MIT) und LICENSE-Datei anlegen

### Phase 1 — Projektgerüst (ca. 1 Tag)

- [ ] `package.json` mit korrekten Feldern: `name`, `version` (0.1.0), `type: "module"`, `bin`, `exports` (ESM + CJS + types), `files`, `engines: { "node": ">=18" }`, `license`, `repository`, `keywords`
- [ ] TypeScript einrichten (ein `tsconfig.json`, strict mode)
- [ ] Build-Tool: `tsup` (Zero-Config, erzeugt ESM + CJS + d.ts in einem Schritt)
- [ ] Linter/Formatter: Biome (ein Tool statt ESLint+Prettier)
- [ ] Vitest einrichten
- [ ] Grundstruktur laut Abschnitt 4.1 anlegen

### Phase 2 — Kernfunktionalität (ca. 1–2 Wochen)

- [ ] Internes Baum-Format (`types.ts`) definieren — **zuerst**, alles andere hängt davon ab
- [ ] npm-Lockfile-Parser (v2/v3) implementieren + Fixture-Tests
- [ ] Konsistenz-Check Lockfile ↔ node_modules
- [ ] Lizenz-Extraktor (license-Feld inkl. Alt-Formate) + Tests
- [ ] SPDX-Normalisierung und Ausdrucks-Parser integrieren + Tests
- [ ] Fallback-Heuristik (LICENSE-Dateien) + Tests
- [ ] Config-Loader mit Validierung (inkl. Tippfehler-Erkennung) + Tests
- [ ] Policy-Engine (Allow/Deny, OR/AND-Logik, Overrides, unlisted-Verhalten) + Tests
- [ ] Terminal-Reporter (Tabelle, Farben, Zusammenfassung)
- [ ] JSON-Reporter
- [ ] CLI-Verdrahtung: Argumente, Exit-Codes, `init`-Befehl
- [ ] Fehlerbehandlung: alle Negativfälle aus Abschnitt 5 mit verständlichen Meldungen

### Phase 3 — Qualitätssicherung (ca. 3–5 Tage)

- [ ] Testabdeckung ≥ 80 % der Kernmodule verifizieren
- [ ] GitHub Actions: Lint + Test + Build auf 3 Betriebssystemen × 3 Node-Versionen
- [ ] Selbsttest in CI (Tool prüft eigene Dependencies)
- [ ] Benchmark mit einem großen realen Projekt (z. B. frisches Next.js-Projekt klonen und prüfen)
- [ ] Lokaler End-to-End-Test: `npm pack`, das erzeugte Tarball in einem fremden Testprojekt installieren, CLI dort ausführen (fängt Fehler in `files`/`bin`/`exports`, die man sonst erst nach dem Publish bemerkt)

### Phase 4 — Dokumentation (ca. 2–3 Tage)

- [ ] README: Problem, Installation, Quickstart (ein Befehl!), Config-Referenz, CI-Beispiel (GitHub Actions Snippet), FAQ
- [ ] Haftungsausschluss ("keine Rechtsberatung") prominent im README und im Report-Footer
- [ ] CHANGELOG.md anlegen (Keep-a-Changelog-Format)
- [ ] CONTRIBUTING.md (auch minimal), Issue-Templates
- [ ] Aussagekräftige `keywords` in package.json für npm-Suche (license, compliance, spdx, audit, ci)

### Phase 5 — Veröffentlichung (1 Tag)

- [ ] Version auf 0.1.0 setzen (bewusst nicht 1.0.0 — signalisiert ehrlich den Reifegrad)
- [ ] `npm publish --provenance --access public` (idealerweise aus GitHub Actions heraus, mit Trusted Publishing statt langlebiger Tokens)
- [ ] Provenance-Badge auf der npm-Seite verifizieren
- [ ] Git-Tag + GitHub-Release mit Changelog
- [ ] Installation aus der Registry in einem sauberen Projekt gegentesten

### Phase 6 — Nach der Veröffentlichung (laufend)

- [ ] Bekanntmachung: Show-HN-Post, r/javascript, dev.to-Artikel ("Wie ich Lizenz-Compliance in npm-Projekten automatisiert habe"), deutschsprachige Communities
- [ ] GitHub Action als eigenes, separates Mini-Projekt anbieten (`uses: dein-name/license-guard-action@v1`) — massiver Adoptions-Hebel
- [ ] Issues zügig beantworten (die ersten Wochen entscheiden über den Ruf)
- [ ] Dependabot/Renovate fürs eigene Repo aktivieren
- [ ] Roadmap v1.1: pnpm- und yarn-Support, Workspaces, HTML-Report

---

## 8. Definition of Done (Release-Kriterien für 0.1.0)

Das Paket darf erst veröffentlicht werden, wenn:

1. Alle Muss-Anforderungen (F-01 bis F-09, F-13) implementiert und getestet sind.
2. Die CI auf allen drei Betriebssystemen grün ist.
3. Der Selbsttest (Dogfooding) in CI läuft.
4. Der `npm pack`-End-to-End-Test erfolgreich war.
5. README mit Quickstart und Haftungsausschluss vollständig ist.
6. Jeder dokumentierte Fehlerfall eine verständliche Meldung erzeugt (kein roher Stacktrace für erwartbare Fehler).

---

## 9. Weitere wichtige Punkte

### 9.1 Namenswahl

- Vor jeglicher Arbeit: Verfügbarkeit auf npmjs.com prüfen (`npm view <name>` — Fehler 404 bedeutet frei).
- Auch **ähnliche Namen** prüfen: Namesquatting/Typosquatting ist im Compliance-Umfeld ein bekanntes Angriffsmuster; ein Name, der einem bestehenden Tool zu ähnlich ist, schadet dem Vertrauen und kann von npm moderiert werden.
- Scoped Name (`@deinname/license-guard`) als Fallback, falls der Wunschname vergeben ist. Nachteil: schlechter auffindbar.

### 9.2 Versionierung und Stabilität

- Strikt SemVer. Besonders wichtig: Änderungen am **JSON-Report-Format** und am **Exit-Code-Verhalten** sind Breaking Changes, weil CI-Pipelines davon abhängen.
- Das JSON-Format ab der ersten Version mit einem `schemaVersion`-Feld versehen — das erlaubt spätere Erweiterungen ohne Rätselraten bei den Nutzern.

### 9.3 Programmatische API

Von Anfang an eine kleine, saubere API exportieren (`import { analyze } from "license-guard"`), nicht nur die CLI. Gründe: Andere Tools (Build-Systeme, Dashboards) können das Paket einbetten — das vervielfacht die Reichweite und ist die Basis für spätere Monetarisierung.

### 9.4 Eigene Supply-Chain-Hygiene

Ein Compliance-Tool wird an seinen eigenen Standards gemessen:

- Minimale Dependencies (NF-03), regelmäßiges `npm audit`.
- Lockfile committen, Dependabot aktiv.
- Publishing nur über CI mit Provenance, keine langlebigen npm-Tokens auf Entwicklerrechnern.
- 2FA auf npm- und GitHub-Account.

### 9.5 Abgrenzung zur Konkurrenz (im README kommunizieren)

| Bestehendes Tool | Schwäche | Dein Vorteil |
|------------------|----------|--------------|
| `license-checker` | Kaum gepflegt, keine Policy, kein SPDX-Ausdrucks-Support | Aktiv, Policy-Engine, moderne CLI |
| `licensee` (GitHub) | Ruby-basiert, nicht npm-nativ | Reines npm-Tooling, ein `npx`-Befehl |
| Snyk / FOSSA | Kommerziell, schwergewichtig, Cloud-Pflicht | Kostenlos, offline, in Sekunden eingerichtet |

### 9.6 Häufigster strategischer Fehler (vermeiden!)

Zu viel auf einmal wollen. Die Versuchung wird groß sein, sofort pnpm, Yarn, Monorepos und HTML-Reports zu bauen. Ein Tool, das **nur npm** unterstützt, dies aber **fehlerfrei und mit exzellenten Fehlermeldungen**, schlägt jedes Tool, das alles halb kann. Vertrauen ist bei einem Compliance-Tool das einzige Kapital — ein einziger prominenter False-Negative-Bug ("Tool hat GPL-Paket übersehen") kann das Projekt beenden.

---

## 10. Ausblick: Monetarisierung (nach erfolgreicher v1)

1. **Open-Core:** CLI bleibt für immer kostenlos; bezahltes Angebot darüber: gehostetes Dashboard mit Verlauf über Zeit, organisationsweite Policies über viele Repos, automatische PR-Kommentare, SBOM-Export (CycloneDX/SPDX-Format — von Compliance-Abteilungen zunehmend gefordert).
2. **GitHub Marketplace Action** mit kostenpflichtigem Tier für private Orgs.
3. **Support-Verträge** für Firmen, die das Tool in regulierten Umgebungen einsetzen.

Voraussetzung für alles: erst Vertrauen und Verbreitung über das kostenlose Tool aufbauen. Monetarisierung vor Adoption funktioniert in diesem Segment nicht.

---

*Hinweis: Dieses Papier beschreibt die technische Umsetzung eines Analyse-Tools. Es stellt keine Rechtsberatung dar; für verbindliche lizenzrechtliche Bewertungen ist juristische Beratung erforderlich.*
