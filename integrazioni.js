// Integrazioni del centro: per ora il collegamento di WhatsApp Business.
//
// Era un pannello a comparsa, adesso è una voce della barra con la sua rotta.
// Non perché ci si torni spesso — è ancora una cosa che la titolare fa una
// volta — ma perché una voce di navigazione dev'essere un link: passando da
// route() si spegne quello che la sezione precedente aveva lasciato acceso, e
// non resta un modale orfano di cui nessuno sa niente. Stessa strada già fatta
// dalle conversazioni.

import { sb, app, stato, esc, SUPABASE_URL, SUPABASE_KEY, erroreBox, pagina } from "./core.js?v=15";


// Collegamento del WhatsApp del centro. Il giro passa da Meta: la titolare
// autorizza nella finestra di Facebook, noi riceviamo un codice usa e getta e
// lo consegniamo subito alla edge function wa-connect, che è l'unica a
// conoscere il segreto dell'app. Nel browser non transita nessuna credenziale.
//
// Modalità Coexistence: il numero resta sull'app del telefono. La titolare
// continua a rispondere come ha sempre fatto, e quando lo fa il bot tace.

let fbPronto = null;   // promessa risolta quando l'SDK di Facebook è caricato
let messaggioPendente = "";   // esito arrivato mentre la titolare era altrove

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

  if (statoRes.error || !wa?.ok) {
    box.innerHTML = `<h1>Integrazioni</h1>
      ${erroreBox(statoRes.error?.message || wa?.errore || "Non disponibile")}`;
    return;
  }

  disegna(messaggioPendente);
  messaggioPendente = "";

  // Il collegamento va a termine anche se nel frattempo si è cambiata sezione:
  // la finestra di Facebook non blocca la barra come faceva il velo del
  // pannello. E un esito non è una lettura che si può perdere in silenzio — il
  // numero risulterebbe collegato senza che nessuno lo dica, o un errore
  // sparirebbe — quindi si torna su Integrazioni e si rilegge lo stato vero.
  function mostraEsito(messaggio = "") {
    if (location.hash !== "#/integrazioni") {
      messaggioPendente = messaggio;
      location.hash = "#/integrazioni";
      return;
    }
    if (box.isConnected) return disegna(messaggio);
    // Già tornata a mano su Integrazioni: quella pagina ha letto lo stato prima
    // che il collegamento finisse, va riletto da capo.
    messaggioPendente = messaggio;
    return mostraIntegrazioni();
  }

  function disegna(messaggio = "") {
    const collegato = wa.stato === "collegato";
    box.innerHTML = `
      <h1>Integrazioni</h1>
      ${messaggio ? erroreBox(messaggio) : ""}
      ${wa.errore ? erroreBox(wa.errore) : ""}
      <div class="integrazione">
        <div class="integrazione-testa">
          <strong>WhatsApp Business</strong>
          <span class="badge-stato ${collegato ? "on" : "off"}">${collegato ? "Collegato" : "Non collegato"}</span>
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
          <button class="btn-secondario" id="wa-scollega">Scollega</button>
        ` : `
          <button class="btn" id="wa-collega" ${cfg?.pronto ? "" : "disabled"}>
            Collega WhatsApp Business
          </button>
          ${cfg?.pronto ? "" : `<p class="sub">Collegamento non ancora attivo: stiamo completando la verifica con Meta.</p>`}
        `}
      </div>`;

    const bottone = box.querySelector("#wa-collega");
    if (bottone) bottone.onclick = () => collega(bottone);

    const interruttore = box.querySelector("#wa-bot");
    if (interruttore) interruttore.onchange = async () => {
      const attivo = interruttore.checked;
      interruttore.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_bot", { p_centro: stato.centro.id, p_attivo: attivo });
      interruttore.disabled = false;
      if (error || !data?.ok) {
        interruttore.checked = !attivo;
        return disegna(error?.message || data?.errore || "Non riuscito");
      }
      wa.bot_attivo = attivo;
    };

    const scollega = box.querySelector("#wa-scollega");
    if (scollega) scollega.onclick = async () => {
      scollega.disabled = true;
      scollega.textContent = "Scollego…";
      const { data, error } = await sb.rpc("crm_wa_scollega", { p_centro: stato.centro.id });
      if (error || !data?.ok) {
        scollega.disabled = false;
        scollega.textContent = "Scollega";
        return disegna(error?.message || data?.errore || "Non riuscito");
      }
      wa.stato = "non_collegato";
      wa.numero = null;
      wa.errore = null;
      disegna();
    };
  }

  async function collega(bottone) {
    bottone.disabled = true;
    bottone.textContent = "Apro Facebook…";
    try {
      await caricaFacebookSDK(cfg.app_id, cfg.graph_version || "v23.0");
      ultimaWaba = null;
      ultimaModalita = "cloud";
      const code = await avviaSignup(cfg.config_id);
      if (!code) {
        bottone.disabled = false;
        bottone.textContent = "Collega WhatsApp Business";
        // Chi ha cambiato sezione ha abbandonato il giro: riportarla indietro
        // per dirle "annullato" sarebbe peggio del silenzio.
        if (box.isConnected) disegna("Collegamento annullato.");
        return;
      }

      // Il codice scade in una trentina di secondi: si consegna subito.
      bottone.textContent = "Collego…";
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
      const esito = await res.json().catch(() => ({}));
      if (!esito?.ok) {
        bottone.disabled = false;
        bottone.textContent = "Collega WhatsApp Business";
        return mostraEsito(esito?.errore || "Collegamento non riuscito");
      }
      wa.stato = "collegato";
      wa.numero = esito.numero;
      wa.bot_attivo = true;
      wa.errore = null;
      mostraEsito();
    } catch (e) {
      bottone.disabled = false;
      bottone.textContent = "Collega WhatsApp Business";
      mostraEsito(String(e.message || e));
    }
  }
}
