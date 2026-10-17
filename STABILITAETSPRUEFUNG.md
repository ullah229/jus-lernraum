# JUS Lernraum – Stabilitätsprüfung vom 16.10.2026

## Ergebnis und Umfang

Erster technischer Prüfdurchlauf auf Basis von Version 19. Keine vollständige
Produktionsfreigabe und kein unabhängiges Sicherheitsaudit. Alle Datenversuche
laufen in einer isolierten Miniflare-Datenbank mit Testdateien, nicht auf Echtdaten.

39 Backendtests und 7 Domänentests erfolgreich. TypeScript-Prüfung erfolgreich.
Der Produktionsbuild ist zusätzlich vor Veröffentlichung erforderlich.

## Behobene Fehler

1. Fehlten die Originalbytes einer Datei, während ihr Datenbankeintrag noch im
   Papierkorb lag, meldete der Import einer aktiven Sicherung Erfolg. Die Datei
   blieb dennoch unsichtbar (Download 404). Der Import repariert jetzt die Bytes
   am vorhandenen Speicherpfad und reaktiviert den Eintrag, wenn die Sicherung ihn
   als aktiv enthält. Eine zwischenzeitlich geänderte Löschmarkierung wird nicht
   überschrieben. Ein erneuter Import erzeugt keinen doppelten Dateieintrag.
2. Sicherungen mit Lehrkräfteprofilen, aber ohne Schüler-/Unterrichtsdatensätze,
   wurden mit Erfolg beantwortet, ohne die Profile zu speichern. Der Import
   verarbeitet jetzt auch diesen Fall. Neue Profile bleiben deaktiviert und
   erhalten keine Benutzerbindung aus der Sicherung.

Beide Fehler wurden zunächst durch fehlschlagende Regressionstests reproduziert.

## Nachgewiesene Prüfungen

| Bereich | Automatisierter Nachweis |
| --- | --- |
| Berechtigungen | Anonyme und nicht eingeladene Benutzer abgewiesen; fremde Schreib-Origin abgewiesen; Lehrkräfte ohne Zugriff auf Sicherungen und Schülerrechnungen |
| Unterricht | Eigene Zuordnungen, Versionskonflikte, parallele Terminbuchungen, Gruppentermine, Korrekturen abgeschlossener Stunden |
| Finanzen | Teilzahlungen, Guthaben, Überzahlungen, parallele Zahlungszuordnung, Rechnungs- und Honorarsperren |
| Dateisicherung | Originalbytes exportieren, Prüfsummen prüfen, gelöschte und fehlende Dateien wiederherstellen |
| Notfallimport | In isolierter Testdatenbank alle aktiven Datensätze entfernt und importiert; fachliche Inhalte vollständig verglichen; Rechnungs- und Honoraransprüche wieder aufgebaut; Kontostände unverändert |
| Team | Entzug von Zuordnungen, Deaktivierung, persönliche Einladungen und deaktivierte wiederhergestellte Profile |
| Zeit und Kalender | Berliner Zeitumstellungen, Serien, manuelle ICS-Dateien |

## Noch offen vor einer umfassenden Produktionsfreigabe

- Browserabnahme mit Inhaber und drei echten Lehrkraftkonten, auf Smartphone und
  Desktop. Das verfügbare Arbeitsumfeld bietet derzeit keinen unterstützten
  Browser-Prüfweg. Layout und vollständige Klickabläufe sind daher nicht verifiziert.
- Wiederherstellungsübung einer tatsächlich heruntergeladenen Vollsicherung in
  einer getrennten Staging-Umgebung. Die bisherigen Nachweise verwenden Testdaten.
- Last- und Größenprüfung: Der Import hat derzeit eine Grenze von 2.000
  Datensätzen und 8 MB JSON. Der Export erzwingt keine entsprechende Datensatzgrenze.
  Vor Überschreiten muss ein größerer Import unterstützt und getestet werden.
- Papierkorbgrenzen dokumentieren oder ausbauen: Der Datensatzimport lässt bereits
  in der Sicherung gelöschte Datensätze aus. Eine Vollsicherung enthält diese zwar,
  stellt aber nicht den gesamten Papierkorb identisch wieder her. Dateien brauchen
  beim Import einen aktiven zugehörigen Schüler.
- Teilabbrüche des Dateiimports sind nicht atomar; bereits importierte Einträge
  bleiben bestehen. Erneutes Einspielen ist vorgesehen. Während der Wiederherstellung
  keine parallelen Änderungen vornehmen; Rennen zwischen Dateipurging und
  Objektwiederherstellung sind nicht umfassend abgedeckt.
- Betriebliches Monitoring und Benachrichtigung bei Fehlern sowie ein geübter
  Wiederanlaufplan sind noch nicht nachgewiesen. Tägliche Snapshots entstehen
  beim ersten Schreibzugriff, nicht durch einen unabhängigen Zeitplan.
- Datenschutz und fachliche/rechtliche Rechnungsanforderungen sind nicht durch
  diese technischen Tests geprüft.

## Manuelle Abnahme für den Pilotbetrieb

Mit eindeutig benannten Testschülern und kleinen Testdateien durchführen.
Keine Testrechnungen in die laufende echte Rechnungsnummerierung einschleusen;
Abrechnungsproben gehören in eine getrennte Testumgebung.

1. Als Inhaber und als jede Lehrkraft getrennt anmelden. Sichtbare Schüler und
   Termine mit den tatsächlichen Zuordnungen vergleichen.
2. Als Lehrkraft Termin anlegen, verschieben und als ICS herunterladen. Einen
   bereits begonnenen Testtermin abschließen und anschließend Notizen korrigieren.
3. Gruppenunterricht mit unterschiedlicher Anwesenheit prüfen.
4. Hausaufgabe mit Material und Lösung erstellen; beide Dateien herunterladen.
5. Smartphone: Kalender, Dialoge, Tastatur und lange Namen prüfen; zusätzlich
   Hell- und Dunkelmodus prüfen. Fehlermeldungen müssen sichtbar bleiben.
6. Eine vollständige Sicherung herunterladen und geschützt aufbewahren; den
   Wiederherstellungsversuch ausschließlich in getrennter Testumgebung durchführen.
7. Auffälligkeiten mit Rolle, Zeitpunkt, Schritten und Screenshot dokumentieren.

## Wiederholbare technische Befehle

```sh
node --test tests/backend.test.mjs
node --experimental-strip-types --test tests/domain.test.mjs
node node_modules/typescript/bin/tsc --noEmit
```

Build und Veröffentlichung erfolgen über den bestehenden Sites-Workflow.
Bei Änderungen an Finanz- oder Zugriffslogik müssen die Backendtests erneut laufen.
