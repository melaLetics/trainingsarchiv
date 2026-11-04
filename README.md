# Trainingsarchiv

Persönliches Archiv der eigenen Freeletics-Trainings als installierbare Web-App (PWA).

> **Inoffizielles Projekt.** Trainingsarchiv steht in keiner Verbindung zu Freeletics und wird von Freeletics weder angeboten noch unterstützt oder geprüft. „Freeletics“ ist eine Marke ihres Inhabers und wird hier nur verwendet, um zu beschreiben, welche Daten die App liest.

Man lädt einmal den Freeletics-Datenexport, alles Weitere passiert lokal im Browser. Es gibt keinen Server und keine Konten.

## Starten

Voraussetzung: Node.js (ab Version 18). Weitere Abhängigkeiten gibt es nicht.

```
npm start
```

Dann im Browser `http://localhost:8080` öffnen und die ZIP-Datei von Freeletics (`fl_uid_….zip`) direkt auswählen, ohne sie zu entpacken.
Der Dateiname spielt keine Rolle, die App sucht in der ZIP nach der `data.json`. Alternativ geht auch die `data.json` allein.
Service Worker und „App installieren“ funktionieren nur über `localhost` oder `https`, nicht über `file://`.

## Ansichten

- **Überblick**: Gesamtzahlen, Serien, Kalender aller Trainingstage, Trainings pro Jahr, „Vor genau einem Jahr“, Top-Workouts und -Übungen, Wochentag und Uhrzeit
- **Workouts**: alle Workouts mit Suche und Filtern, Detail mit Aufbau, Bestwert-Verlauf, Rundenzeiten und letzten Durchführungen
- **Übungen**: Summen pro Übung, Verlauf pro Jahr, Workouts, in denen die Übung vorkommt
- **Gewichte**: Enthält der Export Übungen mit Gewicht, zeigt die Übungsansicht schwerstes und letztes Gewicht mit Verlauf, und unter „Fortschritt“ erscheint eine Liste dieser Übungen. Ohne Gewichtsangaben im Export bleiben beide Abschnitte ausgeblendet.
- **Verlauf**: Trainingsstunden pro Monat, dazu Körpergewicht, gekochte Mahlzeiten und Kilometer auf derselben Zeitachse

Die Oberfläche gibt es auf Deutsch und Englisch (Schaltfläche DE/EN oben). Beim ersten Start richtet sich die Sprache nach dem Browser, danach wird die Wahl gespeichert.

## Daten

- Eingelesen wird nur die `data.json` aus dem Export. Aus der ZIP wird nur diese eine Datei entpackt (`js/unzip.js`, über `DecompressionStream`), das Archiv wird nicht komplett geladen.
- `js/proc.js` macht daraus ein kompaktes Modell (rund 1,4 MB): Trainings, abgeleitete Workouts, Übungssummen, Gewicht (nur Datum und kg) und Mahlzeiten pro Monat. Profil, Zahlungen und Social-Posts werden nicht übernommen.
- Das Modell liegt in IndexedDB. Die App bittet den Browser um dauerhaften Speicher (`navigator.storage.persist()`).
- **Sicherung herunterladen** speichert das Modell als JSON. Diese Datei lässt sich später wieder laden, z. B. auf einem anderen Gerät.
- Auf dem iPhone die App über *Teilen → Zum Home-Bildschirm* installieren. Sonst löscht Safari die Daten nach 7 Tagen ohne Besuch.

## Veröffentlichen

Der Ordner ist eine statische Website. Er kann so wie er ist auf jeden Static Host (z. B. GitHub Pages, Netlify, Cloudflare Pages); `tools/` und `dist/` werden nicht gebraucht.
Nach Änderungen an App-Dateien in `sw.js` die `VERSION` erhöhen, damit installierte Apps die neue Fassung laden.

## Vorschau als einzelne Datei

```
node tools/build-preview.mjs ../export/data.json
```

Erzeugt `dist/preview.html`, eine einzelne Datei mit allem eingebettet, optional mit Startdaten. Damit lässt sich die App als Claude-Artifact teilen.

## Aufbau

```
index.html              Seite und Grundgerüst
css/app.css             Gestaltung (helles und dunkles Farbschema)
js/i18n.js              Texte auf Deutsch und Englisch
js/proc.js              Export -> Datenmodell (läuft im Browser und in Node)
js/unzip.js             liest eine Datei aus einer ZIP
js/app.js               Ansichten, Diagramme, Speicher, Installation
sw.js                   Service Worker (offline)
manifest.webmanifest    PWA-Manifest
icons/                  App-Icons
tools/serve.mjs         lokaler Webserver
tools/build-preview.mjs Einzeldatei-Vorschau
```

## Hinweise

- Die Einteilung in Kraft, Mobility, Laufen und Rad ist aus den Workout-Namen geschätzt (`category()` in `js/proc.js`).
- Rundendaten (und damit Übungssummen) liefert der Export erst ab 2020.
- Der Aufbau eines Workouts ist die häufigste Variante aller Durchführungen.
