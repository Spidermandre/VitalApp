# VitalApp · Diario Vitale

Parametri, abitudini e umore in una scheda al giorno. Webapp installabile (PWA), senza dipendenze né build: apri `index.html` o servi la cartella con un qualsiasi server statico (es. GitHub Pages).

- **Parametri**: pressione (classificazione ESH), battito a riposo, sonno, attività. La glicemia è stata rimossa.
- **Attività**: obiettivo di 60 minuti il lunedì, mercoledì, giovedì e venerdì; gli altri giorni sono liberi.
- **Umore e abitudini** facoltativi; grafico di andamento su 7/14/30 giorni.
- **Privacy**: i dati restano nel `localStorage` del dispositivo.
- Non fa diagnosi.

## Cartella Clinica

Sezione per i referti di laboratorio (sangue, urine, altro):

- carichi il PDF o le foto del referto (salvati sul dispositivo, in IndexedDB) e inserisci i valori a mano, oppure li fai leggere a Claude;
- per ogni parametro: ultimo valore, fascia di riferimento, grafico nel tempo, variazione dal referto precedente e una tendenza lineare con stima a 6 mesi (da 3 referti in su);
- **Analisi di Claude**: legge tutti i referti insieme ai dati del diario e scrive una sintesi con cosa tenere d'occhio, andamenti e domande per il medico.

Le funzioni AI usano la chiave API Anthropic dell'utente (Impostazioni AI), salvata solo sul dispositivo. Il modello predefinito è Claude Opus 5.5. Quando si usano, referti e dati del diario vengono inviati ad Anthropic. La libreria ufficiale `@anthropic-ai/sdk` è inclusa in `vendor/` (licenza in `vendor/anthropic-sdk-LICENSE`).

## Sincronizzazione con lo smartwatch FitPolo iDW28 / VeryFit

VeryFit non espone API pubbliche e il watch parla un protocollo Bluetooth proprietario, quindi una webapp non può leggerlo direttamente. Dal pulsante **⌚ Smartwatch** ci sono tre vie:

1. **Importa file**: CSV, JSON o Apple Health `export.xml` (esportati da Salute/VeryFit o da app come Health Sync). Colonne riconosciute: data, battito, sonno, attività, sistolica, diastolica. Si aggiornano solo i campi presenti; più righe nello stesso giorno vengono aggregate (battito = minimo, sonno e attività = somma). Sonno > 24 viene letto come minuti.
2. **Incolla testo** negli stessi formati.
3. **Bluetooth** (Web Bluetooth, Chrome/Edge): legge il battito se il watch espone il servizio standard Heart Rate. Non garantito per l'iDW28 (spesso è visibile solo a VeryFit).

È disponibile anche l'esportazione CSV del diario.

## Pubblicazione

Su GitHub: *Settings → Pages → Deploy from branch* e scegli il branch. Il Web Bluetooth e il service worker richiedono HTTPS (Pages lo fornisce).
