# VitalApp · Diario Vitale

Parametri, abitudini e umore in una scheda al giorno. Webapp installabile (PWA), senza dipendenze né build: apri `index.html` o servi la cartella con un qualsiasi server statico (es. GitHub Pages).

- **Parametri**: pressione (classificazione ESH), battito a riposo, sonno, attività (150 min/settimana, OMS). La glicemia è stata rimossa.
- **Umore e abitudini** facoltativi; grafico di andamento su 7/14/30 giorni.
- **Privacy**: i dati restano nel `localStorage` del dispositivo.
- Non fa diagnosi.

## Sincronizzazione con lo smartwatch FitPolo iDW28 / VeryFit

VeryFit non espone API pubbliche e il watch parla un protocollo Bluetooth proprietario, quindi una webapp non può leggerlo direttamente. Dal pulsante **⌚ Smartwatch** ci sono tre vie:

1. **Importa file**: CSV, JSON o Apple Health `export.xml` (esportati da Salute/VeryFit o da app come Health Sync). Colonne riconosciute: data, battito, sonno, attività, sistolica, diastolica. Si aggiornano solo i campi presenti; più righe nello stesso giorno vengono aggregate (battito = minimo, sonno e attività = somma). Sonno > 24 viene letto come minuti.
2. **Incolla testo** negli stessi formati.
3. **Bluetooth** (Web Bluetooth, Chrome/Edge): legge il battito se il watch espone il servizio standard Heart Rate. Non garantito per l'iDW28 (spesso è visibile solo a VeryFit).

È disponibile anche l'esportazione CSV del diario.

## Pubblicazione

Su GitHub: *Settings → Pages → Deploy from branch* e scegli il branch. Il Web Bluetooth e il service worker richiedono HTTPS (Pages lo fornisce).
