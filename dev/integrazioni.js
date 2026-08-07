// Integrazioni del centro: per ora il collegamento di WhatsApp Business.
//
// Era un pannello a comparsa, adesso è una voce della barra con la sua rotta.
// Non perché ci si torni spesso — è ancora una cosa che la titolare fa una
// volta — ma perché una voce di navigazione dev'essere un link: passando da
// route() si spegne quello che la sezione precedente aveva lasciato acceso, e
// non resta un modale orfano di cui nessuno sa niente. Stessa strada già fatta
// dalle conversazioni.
//
// La regola che regge tutto il file: chi è collegato lo dice il database, non
// la risposta di wa-connect. Quella risposta è comoda quando arriva, ma è una
// notizia di passaggio; il database è il posto dove wa-connect scrive sia il
// buon esito sia il guasto, ed è l'unico che sa la verità anche quando la
// risposta tarda, si perde o arriva dopo che la titolare ha già cambiato
// pagina. Per questo dopo il giro su Meta non si ritocca niente a mano: si
// rilegge e si ridisegna da capo.

import { sb, app, stato, esc, SUPABASE_URL, SUPABASE_KEY, avvisoBox, erroreBox, pagina, pannello } from "./core.js?v=24";


// Collegamento del WhatsApp del centro. Il giro passa da Meta: la titolare
// autorizza nella finestra di Facebook, noi riceviamo un codice usa e getta e
// lo consegniamo subito alla edge function wa-connect, che è l'unica a
// conoscere il segreto dell'app. Nel browser non transita nessuna credenziale.
//
// Modalità Coexistence: il numero resta sull'app del telefono. La titolare
// continua a rispondere come ha sempre fatto, e quando lo fa il bot tace.

let fbPronto = null;      // promessa risolta quando l'SDK di Facebook è caricato
let esitoPendente = null; // {testo, avviso} arrivato mentre la titolare era altrove

// Quanto si sta ad aspettare wa-connect prima di andare a vedere da soli come è
// finita. Non è un limite di tempo per il collegamento — quello continua per
// conto suo dall'altra parte — è il limite oltre il quale questa pagina smette
// di stare ferma a fissare una risposta che potrebbe non arrivare mai.
const ATTESA_CONNESSIONE = 20000;

// WhatsApp Manager di Meta: da lì si cambiano nome, foto e orari del profilo,
// cose che noi non replichiamo e che non ha senso duplicare.
//
// L'indirizzo va detto per intero. Prima si apriva quello generico, convinti
// che "Meta riconosce da sola di quale account si tratta dall'accesso della
// titolare": non lo fa. Senza parametri apre il portfolio predefinito di chi ha
// fatto l'accesso, che è quello giusto solo se ne ha uno solo — con due o più,
// la titolare si trova davanti l'account di qualcun altro suo e giura che il
// bottone è rotto. Aveva ragione.
//
//   asset_id    quale WABA aprire
//   business_id in quale portfolio cercarla; senza, Meta la cerca nel
//               predefinito e se non abita lì non la mostra
//
// business_id può mancare (Graph muto al momento del collegamento): in quel
// caso si manda comunque asset_id, che porta a destinazione ogni volta che la
// WABA sta nel portfolio predefinito. Il link nudo resta solo se manca pure la
// WABA, cioè per un centro non collegato — dove questo bottone non si vede.
const WA_MANAGER = "https://business.facebook.com/latest/whatsapp_manager/overview/";

function linkManager(waba, business) {
  if (!waba) return WA_MANAGER;
  const q = new URLSearchParams({ asset_id: waba });
  if (business) q.set("business_id", business);
  return `${WA_MANAGER}?${q}`;
}

const ritardo = (ms) => new Promise((risolvi) => setTimeout(() => risolvi(null), ms));

// "4 agosto 2026 alle 15:32". La data per esteso e non "04/08/26": qui si legge
// una volta sola e la forma parlata si capisce senza contare le barre.
function quando(iso) {
  if (!iso) return "—";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "—";
  return d.toLocaleDateString("it-IT", { day: "numeric", month: "long", year: "numeric" })
    + " alle " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
}

function caricaFacebookSDK(appId, version) {
  if (fbPronto) return fbPronto;
  fbPronto = new Promise((risolvi, rifiuta) => {
    window.fbAsyncInit = () => {
      FB.init({ appId, autoLogAppEvents: true, xfbml: true, version });
      risolvi();
    };
    const s = document.createElement("script");
    s.src = "https://connect.facebook.net/en_US/sdk.js";
    s.async = true;
    s.defer = true;
    s.crossOrigin = "anonymous";
    s.onerror = () => rifiuta(new Error("Non riesco a caricare Facebook"));
    document.head.appendChild(s);
  });
  return fbPronto;
}

// Meta comunica l'esito del giro con un postMessage: lì dentro c'è l'id
// dell'account WhatsApp, che il callback del login da solo non ci darebbe.
// L'onboarding dall'app del telefono chiude con un evento diverso da quello
// standard, ma in entrambi i casi quello che ci serve è il waba_id.
let ultimaWaba = null;
let ultimaModalita = "cloud";
window.addEventListener("message", (ev) => {
  if (!String(ev.origin).endsWith("facebook.com")) return;
  try {
    const d = JSON.parse(ev.data);
    if (d.type !== "WA_EMBEDDED_SIGNUP") return;
    if (d.data?.waba_id) ultimaWaba = d.data.waba_id;
    if (d.event === "FINISH_WHATSAPP_BUSINESS_APP_ONBOARDING") ultimaModalita = "coexistence";
  } catch { /* messaggi non nostri */ }
});

function avviaSignup(configId) {
  return new Promise((risolvi) => {
    FB.login((res) => risolvi(res?.authResponse?.code ?? null), {
      config_id: configId,
      response_type: "code",
      override_default_response_type: true,
      extras: {
        setup: {},
        // Variante Coexistence: al posto della scelta dell'account API, Meta
        // propone di collegare il WhatsApp Business che il centro usa già sul
        // telefono (numero + conferma dentro l'app). Senza questo parametro
        // comparirebbe solo "crea un account", che non è ciò che vogliamo far
        // fare alle titolari.
        featureType: "whatsapp_business_app_onboarding",
        // Meta richiede il "session logging" per la Coexistence: è questo che
        // accende i postMessage WA_EMBEDDED_SIGNUP, compreso l'evento di fine
        // onboarding da app. Senza, il flusso ricade su quello standard.
        sessionInfoVersion: "3",
      },
    });
  });
}

// Rimonta la sezione da capo, rileggendo il database, e le lascia in mano un
// messaggio da mostrare. È l'UNICA strada per aggiornare la scheda dopo il giro
// su Meta.
//
// Prima si ritoccava a mano l'oggetto letto all'apertura della pagina e si
// ridisegnava: ma quell'oggetto, il contenitore e la funzione che disegna sono
// tre riferimenti congelati nella chiamata di mostraIntegrazioni() che ha
// avviato il giro, e il giro dura più della pagina che l'ha avviato. Al ritorno
// dal popup si finiva per ritoccare e ridipingere roba che non era più a
// schermo, mentre la pagina vera continuava a mostrare la fotografia scattata
// prima — badge "Non collegato" e bottone fermo su "Collego…" — perché nessuno
// andava più a chiedere al database com'era finita davvero.
async function aggiorna(testo = "", avviso = false) {
  esitoPendente = testo ? { testo, avviso } : null;
  // Chi nel frattempo è andata altrove va riportata qui: un esito non è una
  // lettura che si può perdere in silenzio — il numero risulterebbe collegato
  // senza che nessuno lo dica, o un errore sparirebbe. Il cambio di rotta fa
  // ripartire mostraIntegrazioni() da route(), che rilegge; se invece siamo già
  // sulla pagina giusta assegnare l'indirizzo non muoverebbe niente, e la
  // rilettura va chiesta a mano.
  if (location.hash !== "#/integrazioni") { location.hash = "#/integrazioni"; return; }
  await mostraIntegrazioni();
}

export async function mostraIntegrazioni() {
  // Cintura oltre alle bretelle: la voce non si disegna e route() rimbalza chi
  // scrive l'indirizzo a mano, ma la difesa vera è dentro il database, che a un
  // non-titolare risponde {ok:false} invece di dare i dati.
  if (stato.centro?.ruolo !== "titolare") { location.hash = "#/"; return; }

  app.innerHTML = pagina(`<h1>Integrazioni</h1><p class="sub">Caricamento…</p>`);
  // Il contenitore si cattura ADESSO, prima delle due attese: se nel frattempo
  // si cambia sezione, box è staccato dal DOM e quello che scriviamo dopo si
  // perde in silenzio invece di comparire sopra la pagina nuova.
  const box = app.querySelector(".pagina");

  const [statoRes, cfgRes] = await Promise.all([
    sb.rpc("crm_wa_stato", { p_centro: stato.centro.id }),
    sb.rpc("crm_wa_config"),
  ]);
  const wa = statoRes.data;
  const cfg = cfgRes.data;

  // Sezione cambiata mentre leggevamo: si esce senza consumare il messaggio, che
  // resta lì per la prossima volta che questa pagina si apre davvero. Scriverlo
  // adesso vorrebbe dire buttarlo dentro un pezzo di pagina che non esiste più.
  if (!box.isConnected) return;

  const arrivato = esitoPendente;
  esitoPendente = null;

  if (statoRes.error || !wa?.ok) {
    box.innerHTML = `<h1>Integrazioni</h1>
      ${erroreBox(statoRes.error?.message || wa?.errore || "Non disponibile")}`;
    return;
  }

  disegna(arrivato);

  function disegna(nota = null) {
    const collegato = wa.stato === "collegato";
    box.innerHTML = `
      <h1>Integrazioni</h1>
      ${nota ? (nota.avviso ? avvisoBox(nota.testo) : erroreBox(nota.testo)) : ""}
      ${wa.errore ? erroreBox(wa.errore) : ""}
      <div class="integrazione">
        <div class="integrazione-testa">
          <strong>WhatsApp Business</strong>
          <span class="badge-stato ${collegato ? "on" : "off"}">${collegato ? "Collegato" : "Non collegato"}</span>
          ${collegato ? `<button class="btn-mini" id="wa-dettagli">Dettagli</button>` : ""}
        </div>
        <p class="sub">${collegato
          ? `Numero ${esc(wa.numero || "collegato")}. Le clienti scrivono come sempre;
             tu continui a rispondere dal telefono quando vuoi.`
          : `Collega il numero WhatsApp del centro: le richieste delle clienti
             finiscono in agenda da sole. Continuerai a usare WhatsApp dal
             telefono come fai adesso.`}</p>
        ${collegato ? `
          <label class="riga-switch">
            <input type="checkbox" id="wa-bot" ${wa.bot_attivo ? "checked" : ""}>
            <span>Risposte automatiche attive</span>
          </label>
        ` : `
          <button class="btn" id="wa-collega" ${cfg?.pronto ? "" : "disabled"}>
            Collega WhatsApp Business
          </button>
          ${cfg?.pronto ? "" : `<p class="sub">Collegamento non ancora attivo: stiamo completando la verifica con Meta.</p>`}
        `}
      </div>`;

    const bottone = box.querySelector("#wa-collega");
    if (bottone) bottone.onclick = () => collega(bottone);

    const dettagli = box.querySelector("#wa-dettagli");
    if (dettagli) dettagli.onclick = apriDettaglio;

    const interruttore = box.querySelector("#wa-bot");
    if (interruttore) interruttore.onchange = async () => {
      const attivo = interruttore.checked;
      interruttore.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_bot", { p_centro: stato.centro.id, p_attivo: attivo });
      interruttore.disabled = false;
      if (error || !data?.ok) {
        interruttore.checked = !attivo;
        return disegna({ testo: error?.message || data?.errore || "Non riuscito", avviso: false });
      }
      // La riga è già andata a posto da sola; questo serve al prossimo disegno,
      // che altrimenti riprenderebbe il valore vecchio e rimetterebbe la
      // levetta dove non è più.
      wa.bot_attivo = attivo;
    };
  }

  // Il dettaglio del collegamento sta in una scheda a comparsa e non nella
  // pagina: fuori resta quello che si guarda ogni giorno — collegato sì o no e
  // le risposte automatiche — e le due cose che si fanno una volta l'anno,
  // andare su Meta e staccare tutto, stanno un dito più in là. Scollega in
  // particolare non deve essere il bottone che si sfiora per sbaglio scorrendo.
  //
  // pannello() appende al body, e route() spazza via i .velo a ogni cambio di
  // rotta: questa scheda si smonta da sola se la titolare tocca la barra.
  function apriDettaglio() {
    const { box: scheda, chiudi } = pannello();
    scheda.innerHTML = `
      <div class="scheda-testa">
        <h2>WhatsApp Business</h2>
        <button class="btn-mini" id="wa-chiudi">Chiudi</button>
      </div>
      <p class="quando">${wa.modalita === "cloud"
        ? `Il numero è passato sulla Cloud API di Meta: le risposte partono da qui.`
        : `Il numero resta sull'app WhatsApp Business del telefono. Quando rispondi
           tu il bot tace, senza che tu debba spegnerlo.`}</p>
      <dl>
        <dt>Numero</dt><dd>${esc(wa.numero || "—")}</dd>
        <dt>Collegato</dt><dd>${esc(quando(wa.collegato_at))}</dd>
        <dt>Risposte</dt><dd>${wa.bot_attivo ? "automatiche attive" : "in pausa"}</dd>
      </dl>
      <div id="wa-esito-scheda"></div>
      <div class="wa-azioni-scheda">
        <button class="btn-secondario" id="wa-manager">Gestisci profilo ↗</button>
        <button class="btn-secondario pericolo" id="wa-scollega">Scollega</button>
      </div>
      <p class="quando">Le conversazioni già ricevute restano dove sono: scollegando,
         smettono soltanto di arrivarne di nuove.</p>`;

    scheda.querySelector("#wa-chiudi").onclick = chiudi;

    // Scheda nuova e non stessa finestra: il giro su Meta è lungo e la titolare
    // deve poter tornare qui senza rifare l'accesso e senza perdere di vista
    // quello che stava facendo.
    scheda.querySelector("#wa-manager").onclick = () =>
      window.open(linkManager(wa.waba_id, wa.business_id), "_blank", "noopener");

    const scollega = scheda.querySelector("#wa-scollega");
    scollega.onclick = async () => {
      scollega.disabled = true;
      scollega.textContent = "Scollego…";
      const { data, error } = await sb.rpc("crm_wa_scollega", { p_centro: stato.centro.id });
      if (error || !data?.ok) {
        scollega.disabled = false;
        scollega.textContent = "Scollega";
        // L'errore si mostra QUI dentro: la pagina sotto è coperta dal velo, e
        // un avviso che compare dove non si vede è come non averlo scritto.
        scheda.querySelector("#wa-esito-scheda").innerHTML =
          erroreBox(error?.message || data?.errore || "Non riuscito");
        return;
      }
      chiudi();
      await aggiorna();
    };
  }

  // Consegna il codice a wa-connect. Torna sempre un oggetto — anche quando la
  // rete cade — così chi aspetta distingue "risposta arrivata, ma negativa" da
  // "risposta non arrivata", che sono due cose diverse da raccontare.
  async function consegna(code) {
    const { data: { session: sess } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-connect`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${sess.access_token}`,
      },
      body: JSON.stringify({
        centro_id: stato.centro.id, code,
        waba_id: ultimaWaba, modalita: ultimaModalita,
      }),
    });
    return await res.json().catch(() => ({}));
  }

  async function collega(bottone) {
    bottone.disabled = true;
    bottone.textContent = "Apro Facebook…";
    try {
      await caricaFacebookSDK(cfg.app_id, cfg.graph_version || "v23.0");
      ultimaWaba = null;
      ultimaModalita = "cloud";
      const code = await avviaSignup(cfg.config_id);
      // Da qui in poi non si tocca più il bottone: ogni strada finisce in
      // aggiorna(), che rifà la sezione da zero e quindi anche il bottone. È
      // proprio il bottone rimesso a posto a mano che, quando una di queste
      // attese non tornava, lasciava a schermo un "Collego…" eterno.
      if (!code) {
        // Unica eccezione al "riportala qui": chi ha cambiato sezione ha
        // abbandonato il giro, e trascinarla indietro per dirle "annullato"
        // sarebbe peggio del silenzio. Niente da salvare, non è successo nulla.
        if (location.hash === "#/integrazioni") await aggiorna("Collegamento annullato.");
        return;
      }

      bottone.textContent = "Collego…";

      // Si aspetta la risposta, ma non all'infinito. Scaduto il tempo NON si
      // annulla la chiamata: dall'altra parte wa-connect sta scambiando il
      // codice con Meta e scrivendo l'esito, e tagliarle la linea sarebbe il
      // modo migliore per lasciare il centro collegato a metà. Si smette solo
      // di aspettarla, e si va a leggere il database, che è dove wa-connect
      // scrive comunque — sia il numero collegato sia il motivo del guasto.
      const chiamata = consegna(code).catch((e) => ({ ok: false, errore: String(e.message || e) }));
      const risposta = await Promise.race([chiamata, ritardo(ATTESA_CONNESSIONE)]);

      if (!risposta) {
        return aggiorna(
          `Meta ci sta mettendo più del solito. Qui sotto c'è quello che risulta
           adesso: se dice ancora "Non collegato", riprova fra un minuto.`, true);
      }
      if (!risposta.ok) return aggiorna(risposta.errore || "Collegamento non riuscito");
      return aggiorna();
    } catch (e) {
      return aggiorna(String(e.message || e));
    }
  }
}
