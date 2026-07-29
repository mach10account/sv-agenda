# SV Agenda

Agenda per centri estetici. Vista giornaliera divisa per cabina, come il
gestionale che il centro apre ogni mattina.

Parte del progetto **SV Platform**: condivide database e accesso con
[SV Academy](https://github.com/mach10account/sv-academy), quindi un centro
entra una volta sola.

## Come è fatto

- **Frontend**: statico, nessuna compilazione. Supabase JS da CDN.
- **Dati**: Supabase, schema `crm`. Tutti i centri stanno nello stesso
  database; a separarli sono le regole di accesso, non tabelle distinte.
- **API**: funzioni in `public` (`crm_agenda_giorno`, `crm_salva_appuntamento`,
  …). Lo schema `crm` non è raggiungibile via API: le tabelle si toccano solo
  attraverso quelle funzioni.

## Le due regole che reggono tutto

**Ogni riga porta il centro a cui appartiene**, e le policy filtrano su quello.
Un utente del centro A non riceve un "non autorizzato" quando chiede i dati del
centro B: riceve il vuoto. Non può dedurne nemmeno l'esistenza.

**Le sovrapposizioni le impedisce il database.** Un vincolo di esclusione su
intervalli temporali rende impossibile avere due appuntamenti sovrapposti sulla
stessa cabina — o sulla stessa operatrice — anche con due tablet che salvano
nello stesso istante. Il frontend non fa nessun controllo: si limita a tradurre
il rifiuto in *"Cabina 1 è già occupata dalle 09:00 alle 10:00"*.

## Orari

Salvati sempre con il fuso (`timestamptz`), mai come testo. La conversione tra
"3 agosto, ore 15:00 nel centro" e l'istante assoluto avviene **nel database**,
non nel browser: un tablet con il fuso impostato male non può creare
appuntamenti all'ora sbagliata.

## File

| file | contenuto |
|---|---|
| `index.html` | struttura di base |
| `app.js` | login, griglia, pannelli, spostamento |
| `styles.css` | stile |

Il numero di versione in coda a `app.js?v=N` va alzato a ogni pubblicazione:
senza, i browser tengono la versione precedente per dieci minuti.

Nel repository non ci sono segreti: la sola chiave presente è quella
publishable di Supabase, protetta lato database dalle policy.
