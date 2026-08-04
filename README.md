# Estetista Indipendente

Il sito unico dei centri: agenda, chat delle clienti, corsi e assistente
nello stesso posto. Un centro entra una volta sola.

Prima erano due siti separati (SV Agenda e SV Academy) sullo stesso database
e con lo stesso accesso: il centro doveva ricordarsi due indirizzi. Adesso
sono quattro tab della stessa barra.

## Le tab

| tab | chi la vede | cosa contiene |
|---|---|---|
| Agenda | chi è collegato a un centro | la giornata divisa per operatrice o per cabina, più settimana e mese |
| Conversazioni | solo la titolare | le chat WhatsApp delle clienti col bot, e una chat di prova |
| Corsi | chi ha almeno un corso attivo | catalogo, lezioni, video |
| Assistente | chi ha almeno un corso attivo | la chat sui contenuti dei corsi |

Le tab non vengono nascoste dopo essere state disegnate: si disegnano solo
quelle a cui quella persona ha davvero accesso. Chi apre una rotta che non gli
spetta atterra sulla sua prima tab, non su un errore.

Integrazioni, cambio password e uscita stanno nel menu in alto a destra.

## Il marchio

Il logo è `logo.png`, ed è lui a dare i colori a tutto il resto: il rosa della
scritta (`--rosa`), l'oro del filetto (`--oro`), il nero della sagoma
(`--ink`). Da qui la barra in alto è **bianca** e non scura: il logo ha lo
sfondo bianco e su una fascia colorata si vedrebbe il rettangolo.

Se il file manca, al suo posto compare il nome scritto: meglio di un riquadro
rotto in cima alla pagina.

## Come è fatto

- **Frontend**: statico, nessuna compilazione. Supabase JS da CDN.
- **Dati**: Supabase, schemi `crm` (agenda, clienti, WhatsApp) e `academy`
  (corsi, lezioni, progressi). Nessuno dei due è raggiungibile via API: si
  passa solo dalle funzioni in `public` (`crm_agenda_giorno`,
  `academy_my_catalog`, …).
- **Video**: Bunny Stream. L'URL del player lo emette la edge function
  `lesson-video` dopo aver verificato l'iscrizione, firmato e con scadenza a
  30 minuti. L'email di chi guarda è sovrapposta al player.
- **Assistente**: edge function `academy-chat`, risposte in streaming.

## Le due regole che reggono l'agenda

**Ogni riga porta il centro a cui appartiene**, e le policy filtrano su quello.
Un utente del centro A non riceve un "non autorizzato" quando chiede i dati del
centro B: riceve il vuoto. Non può dedurne nemmeno l'esistenza.

**Le sovrapposizioni le impedisce il database.** Un vincolo di esclusione su
intervalli temporali rende impossibile avere due appuntamenti sovrapposti sulla
stessa cabina — o sulla stessa operatrice — anche con due tablet che salvano
nello stesso istante. Il frontend non fa nessun controllo: si limita a tradurre
il rifiuto in *"Cabina 1 è già occupata dalle 09:00 alle 10:00"*.

Gli orari sono salvati sempre con il fuso (`timestamptz`), mai come testo. La
conversione tra "3 agosto, ore 15:00 nel centro" e l'istante assoluto avviene
**nel database**, non nel browser: un tablet con il fuso impostato male non può
creare appuntamenti all'ora sbagliata.

## File

| file | contenuto |
|---|---|
| `index.html` | barra, tab, contenitore |
| `app.js` | accesso, tab, menu, rotte |
| `core.js` | collegamento a Supabase e stato condiviso |
| `agenda.js` | griglia, pannelli, spostamento |
| `conversazioni.js` | chat delle clienti e prova del bot |
| `academy.js` | catalogo, lezioni, player |
| `assistente.js` | chat sui contenuti dei corsi |
| `integrazioni.js` | collegamento di WhatsApp Business |
| `styles.css` | stile |

## Pubblicare

I browser tengono i file per dieci minuti: senza cambiare il numero di
versione i centri continuerebbero a usare quella precedente. Il numero compare
in `index.html` **e in cima a ogni import**, e va alzato dappertutto insieme —
se `app.js` è nuovo e `agenda.js` è vecchio, i due lavorano su due `stato`
diversi. Un comando solo:

```bash
grep -rl '?v=14' . --include='*.js' --include='*.html' | xargs sed -i '' 's/?v=14/?v=15/g'
```

Il vecchio indirizzo dell'Academy (`mach10account.github.io/sv-academy`) è
diventato una pagina di rimbalzo che porta qui conservando la parte dopo il #:
i link a lezioni e i recuperi password già mandati continuano a funzionare.

Nel repository non ci sono segreti: la sola chiave presente è quella
publishable di Supabase, protetta lato database dalle policy.
