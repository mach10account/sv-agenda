# Guida per chi lavora su questo repo

⚠️ **Questo repo è pubblico e servito da GitHub Pages**: ogni file committato
finisce online su <https://estetista-indipendente.com>. Mai committare segreti,
token, chiavi, numeri di telefono o dati di clienti — nemmeno nei commenti.

## Cos'è

Il sito unico dei centri estetici: agenda, conversazioni WhatsApp, corsi,
assistente AI, integrazioni e profilo. **Statico, nessuna compilazione**:
HTML + moduli ES + CSS serviti così come sono da GitHub Pages
(repo `mach10account/sv-agenda`, branch `main`, radice).

Il backend è Supabase, progetto `hypkwdvvrmakqrowbkqw`:

- il frontend parla **solo con RPC wrapper** (`SECURITY DEFINER`) esposte sullo
  schema `public` — PostgREST non espone gli altri schemi, ed è voluto;
- quello che richiede `service_role` sta nelle **edge function**, mai nel client.

Il README racconta la struttura delle sei voci e del marchio: leggerlo prima
di toccare barra, rotte o logo.

## ⚠️ Congelamento — finché esiste il file `REVISIONE-IN-CORSO`

La **radice del sito è congelata**: è la versione che il revisore Meta
confronta con le istruzioni che ha in mano. Si sviluppa **solo dentro `dev/`**
(pubblicato su `/dev/`). Un hook `pre-push` locale rifiuta i push che toccano
`.js/.html/.css/.png` in radice. La procedura di smontaggio è scritta dentro
`REVISIONE-IN-CORSO`.

## Regole del codice (imparate sbagliando)

- **Versioni `?v=N` ovunque, non solo in `index.html`**: gli import fra moduli
  portano anch'essi `?v=N`. Con versioni diverse il browser carica **due copie
  di `core.js` = due `stato` diversi**, senza nessun errore. Per alzare:

  ```bash
  grep -rl '?v=OLD' . --include='*.js' --include='*.html' | xargs sed -i '' 's/?v=OLD/?v=NEW/g'
  ```

- **CDN con versione pinnata** (jsDelivr, mai `@2` mobile): una build monca di
  esm.sh ha già rotto il sito una volta. Sintomo: "Caricamento…" eterno senza
  errori. Diagnosi: `performance.getEntriesByType('resource')` in console.

- **Rotta non spettante → `location.replace('#/…')`**, mai un'assegnazione a
  `location.hash`: intrappolerebbe il tasto indietro.

- **Ordine delle media query**: la regola a 820px deve stare **prima** di
  quella a 620px nel foglio — stessa specificità, vince l'ultima scritta.

- `--barra-w` / `--barra-alta-h` dicono quanto spazio la barra ruba al
  contenuto; in ogni modalità una delle due vale 0. La vecchia `--barra-h`
  **non esiste più**: se ricompare in un calc, dà 62px plausibili e sbagliati.

- `agenda.js` misura il **bordo basso di `.testata`**, non la topbar: è il
  pixel in cui comincia la griglia, in tutte e due le modalità della barra.
  C'è un listener `resize` che rimisura.

- **Logo: due `<img>` + CSS, non `<picture>`** — il browser sceglie la sorgente
  di `<picture>` una volta sola e non la riscambia al resize; un tablet ruotato
  si terrebbe l'immagine sbagliata. E `.titolo-marchio[hidden]{display:none}`
  deve restare esplicita: il suo `display:flex` batterebbe `[hidden]` e il nome
  comparirebbe due volte.

## Recupero password — non "semplificare"

Il link lo costruisce l'edge function `recovery-link` e passa **sempre** dalla
pagina di rimbalzo `mach10account.github.io/sv-academy/` (repo `sv-academy`):
un indirizzo `github.io` sopravvive ai cambi di dominio, così anche i link
mandati mesi fa continuano ad arrivare. Il token si verifica **in pagina** con
`verifyOtp` — è per questo che l'anteprima di WhatsApp non consuma il link.

## Assistente AI

L'edge function chiama Anthropic via HTTP con un modello che ragiona:
`content[0]` della risposta può essere un blocco `thinking` — il testo va
preso filtrando `type === 'text'`, mai con `content[0].text`.

## Dominio e Pages

- `CNAME` = `estetista-indipendente.com`; DNS su GoDaddy (4 record A GitHub
  Pages + CNAME `www`). Per un eventuale trasloco futuro: **prima il DNS, poi
  il push del CNAME** — invertirli lascia senza nessuno dei due domini.
- Le impostazioni dell'app Meta (domini, URI OAuth, privacy policy URL →
  `privacy.html` di questo repo) si aggiornano **a mano dal pannello**: le
  modifiche via Graph API sono disabilitate per l'app.

## Convenzioni

- **Tutto in italiano**: UI, commenti, commit. I messaggi di commit raccontano
  la modifica in una riga di linguaggio semplice (vedi `git log`).
- Anteprima locale: un server statico qualsiasi, ad esempio
  `python3 -m http.server` — l'app è tutta client-side.
