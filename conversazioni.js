// Le chat delle clienti col bot, e in cima una conversazione di prova che
// parla solo dentro il gestionale: serve a farsi un'idea del tono e delle
// disponibilità proposte senza passare da WhatsApp.
//
// Qui è una tab e non più un pannello: è un posto dove la titolare torna, e
// una chat dentro una finestrella sopra l'agenda non si legge.
//
// Fino a ieri era una vetrina: si vedeva quello che il bot diceva e si poteva
// solo metterlo in pausa, poi bisognava prendere il telefono. Adesso da qui si
// risponde davvero. Il messaggio non parte dal browser — parte dalla edge
// function wa-send, che è l'unica a conoscere il token del centro — e fuori
// dalle 24 ore, dove WhatsApp lascia passare solo un testo già approvato, al
// posto del campo compare il dialog dei template.

import {
  sb, app, stato, esc, erroreBox, avvisoBox, pannello, SUPABASE_URL, SUPABASE_KEY,
} from "./core.js?v=19";

// La riga della prova esiste anche prima che esista la conversazione: senza,
// il posto dove provare il bot non si troverebbe finché non ci si è scritto.
const PROVA_FINTA = { id: null, prova: true, nome: "Prova il bot", stato: "bot" };

// Il menu dell'intestazione. In archivio è un numero e non una parola perché
// l'ordine È l'informazione: si parte da "non c'è ancora niente" e si arriva
// alla fine della strada. Riscrivere le etichette qui non tocca i dati.
const FASI = [
  "Nessun appuntamento",
  "Appuntamento fissato",
  "Presentata",
  "Acquisita",
  "Non presentata",
];

// "Rispondo io" sono le chat che la titolare si è presa in carico: non c'è una
// colonna che assegna le conversazioni alle persone, e finché il centro è lei
// sola quella distinzione non servirebbe a niente.
const FILTRI = [
  { id: "", nome: "Tutte" },
  { id: "mie", nome: "Rispondo io", conta: "mie" },
  { id: "bot", nome: "✦ Bot" },
  { id: "attesa", nome: "In attesa", conta: "attesa" },
];

function quandoBreve(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const adesso = new Date();
  const stessoGiorno = d.toDateString() === adesso.toDateString();
  return stessoGiorno
    ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

function quandoLungo(iso) {
  if (!iso) return "";
  return new Date(iso).toLocaleString("it-IT",
    { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

// L'attesa si legge di sfuggita, mentre si scorre l'elenco: una cifra e una
// lettera. I minuti finché contano, poi le ore, poi i giorni — "180m" non dice
// niente a nessuno, "3h" sì.
function attesaBreve(min) {
  if (min == null) return "";
  if (min < 60) return `${Math.max(0, Math.round(min))}m`;
  if (min < 1440) return `${Math.floor(min / 60)}h`;
  return `${Math.floor(min / 1440)}g`;
}

// Il colore della pastiglia dice se c'è da correre prima ancora del numero.
function tempraAttesa(min) {
  if (min == null) return "";
  if (min < 15) return "calma";
  if (min < 60) return "tiepida";
  return "calda";
}

// Iniziali su una tinta ricavata dal nome: due chat diverse prendono due colori
// diversi senza che nessuno li scelga, e la stessa chat si ripresenta sempre
// col suo. È quello che permette di ritrovare una riga senza leggerla.
function iniziali(nome) {
  const parole = String(nome || "").replace(/[^\p{L}\s]/gu, " ")
    .trim().split(/\s+/).filter(Boolean);
  if (!parole.length) return "☎";   // chat senza nome: c'è solo un numero
  return (parole[0][0] + (parole[1] ? parole[1][0] : "")).toUpperCase();
}

function tinta(nome) {
  let somma = 0;
  const s = String(nome || "");
  for (let i = 0; i < s.length; i++) somma = (somma * 31 + s.charCodeAt(i)) % 360;
  return `background:hsl(${somma}, 52%, 90%);color:hsl(${somma}, 42%, 34%)`;
}

// La prova non prende una tinta a caso: è oro come la scintilla che la marca
// dappertutto, e così si distingue dalle chat vere a colpo d'occhio.
function avatar(voce) {
  if (voce && voce.prova) return `<span class="wa-avatar prova">✦</span>`;
  const nome = voce ? voce.nome : "";
  return `<span class="wa-avatar" style="${tinta(nome)}">${esc(iniziali(nome))}</span>`;
}

// <input type="datetime-local"> parla in ora locale e senza fuso, l'archivio in
// ISO con la Z: la conversione va fatta in tutti e due i versi, altrimenti un
// appuntamento salvato per le 15 riappare alle 13.
function perCampo(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}` +
         `T${p(d.getHours())}:${p(d.getMinutes())}`;
}

export function mostraConversazioni() {
  app.innerHTML = `<div class="wa-schermo" id="wa-schermo">
                     <p class="loading">Carico le conversazioni…</p>
                   </div>`;
  const box = document.getElementById("wa-schermo");

  let lista = [];
  let apertaId = null;
  let voce = null;          // la riga della chat aperta, tenuta a parte: vedi ricarica()
  let aperta = null;        // messaggi + stato + finestra della chat aperta
  let cerca = "";
  let filtro = "";
  let conteggi = { mie: 0, attesa: 0 };
  let inviando = false;
  let vuoiFocus = false;    // rimettere il cursore nel campo dopo un invio
  let vediElenco = false;   // solo su schermo stretto: è tornata indietro a mano
  let battito = null;
  let attesaCerca = null;
  let templateCache = null;
  let templateEsclusi = 0;  // approvati da Meta ma che non sappiamo comporre qui
  let primoGiro = true;     // una chat si apre da sola solo appena arrivate

  // Un avviso non è un errore: il messaggio è partito davvero, solo non siamo
  // riusciti a scriverlo nel thread. Deve restare a schermo finché non si fa
  // qualcos'altro — se lo cancellasse il battito da 15 secondi, chi si è girato
  // un attimo tornerebbe, non vedrebbe il messaggio nella chat, e lo rimanderebbe.
  let avvisoPendente = "";

  // Una bozza per chat, non una sola: si comincia a scrivere a una cliente, si
  // va a leggere cosa aveva detto un'altra, e tornando indietro la frase è
  // ancora lì. Con una variabile sola se la porterebbe dietro nella chat
  // sbagliata, che è peggio che perderla.
  const bozze = new Map();
  const chiave = (c) => (c && c.prova ? "prova" : (c && c.id) || "");

  ricarica();
  // Se arriva un messaggio mentre la sezione è aperta deve comparire da solo:
  // una chat che si aggiorna solo ricaricando la pagina non sembra viva.
  battito = setInterval(() => { if (!inviando) ricarica(true); }, 15000);

  // ------------------------------------------------------------- letture

  async function ricarica(silenzioso = false) {
    const { data, error } = await sb.rpc("crm_wa_conversazioni", {
      p_centro: stato.centro.id,
      p_cerca: cerca.trim() || null,
      p_filtro: filtro || null,
    });
    if (error || !data?.ok) {
      if (silenzioso) return;
      box.innerHTML = erroreBox(error?.message || data?.errore || "Non disponibile");
      return;
    }
    lista = data.conversazioni || [];

    // La prova sta in cima e c'è sempre — ma solo nell'elenco intero: con una
    // ricerca o un filtro addosso l'elenco deve rispondere alla domanda che gli
    // è stata fatta, non aggiungerci una riga che nessuno ha chiesto.
    if (!cerca.trim() && !filtro) {
      if (!lista.some((c) => c.prova)) lista.unshift({ ...PROVA_FINTA });
      else lista.sort((a, b) => (b.prova ? 1 : 0) - (a.prova ? 1 : 0));
      // I pallini dei filtri si contano qui e solo qui: con un filtro addosso
      // il database manda la sua fetta e basta, e chiedergli anche gli altri
      // numeri sarebbe un secondo viaggio per due cifre. Restano quelli
      // dell'ultima volta che l'elenco era intero, che è quasi sempre adesso.
      conteggi = {
        mie: lista.filter((c) => !c.prova && c.stato === "umano").length,
        attesa: lista.filter((c) => !c.prova && c.attesa_min != null).length,
      };
    }

    // La prima chat si apre da sola solo appena entrate, per non trovarsi
    // davanti mezza pagina vuota. Dopo no: cambiare filtro o cercare qualcosa
    // non deve spostare la conversazione che si sta leggendo.
    if (primoGiro) { apertaId = lista[0]?.id ?? null; primoGiro = false; }
    // Stesso motivo se la ricerca l'ha nascosta dall'elenco: chi cerca un'altra
    // cliente non stava anche chiedendo di chiudere quello che aveva davanti.
    const trovata = lista.find((c) => (c.id ?? null) === apertaId);
    if (trovata) voce = trovata;
    else if (!apertaId) voce = lista.find((c) => c.prova) || voce;

    if (apertaId) await caricaThread(apertaId, true);
    disegna();
  }

  async function caricaThread(id, silenzioso = false) {
    const { data, error } = await sb.rpc("crm_wa_messaggi", { p_conversation: id });
    if (error || !data?.ok) {
      aperta = { errore: error?.message || data?.errore || "Non disponibile", messaggi: [] };
      return;
    }
    aperta = data;
    if (!silenzioso) disegna();
  }

  // Le edge function si chiamano tutte allo stesso modo: la chiave pubblica per
  // farsi aprire la porta, la sessione della titolare come credenziale vera. Il
  // token del centro non passa mai di qui — lo legge la edge, che gira come
  // service_role e non ha un browser addosso.
  async function chiama(funzione, corpo, extra = {}) {
    const { data: { session: sess } } = await sb.auth.getSession();
    const res = await fetch(`${SUPABASE_URL}/functions/v1/${funzione}`, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        apikey: SUPABASE_KEY,
        authorization: `Bearer ${sess.access_token}`,
        ...extra,
      },
      body: JSON.stringify(corpo),
    });
    return await res.json().catch(() => ({}));
  }

  // ------------------------------------------------------------- disegno

  function bolla(m) {
    const uscita = m.da !== "in";
    // Una spunta sola, non due. Sappiamo che il messaggio è partito da qui, non
    // che sia arrivato: le ricevute di Meta non le registriamo ancora, e due
    // spunte direbbero una cosa che non ci ha detto nessuno.
    const coda = [
      m.tipo === "template" ? "template" : "",
      esc(quandoBreve(m.quando)),
      uscita ? (m.dal_telefono ? "dal telefono ✓" : "✓") : "",
    ].filter(Boolean).join(" · ");

    return `<div class="wa-riga ${uscita ? "out" : "in"}">` +
      (uscita && m.ai ? `<span class="wa-scintilla" title="Scritto dal bot">✦</span>` : "") +
      `<div class="wa-bolla ${uscita ? "out" : "in"}">${esc(m.testo)}` +
      `<span class="wa-ora">${coda}</span></div></div>`;
  }

  function disegna(messaggio = "") {
    const sel = voce;
    const inProva = !!sel?.prova;

    // Il battito ridisegna tutto ogni quindici secondi. Quello che sta
    // scrivendo — nel campo e nella ricerca — dove ha il cursore e fin dove era
    // arrivata a leggere sono cose sue, e vanno riportate dentro: altrimenti si
    // ritrova la frase troncata a metà e la chat riavvolta in fondo.
    const attivo = document.activeElement;
    const fuoco = attivo && box.contains(attivo) ? attivo.id : "";
    const punto = fuoco && attivo.selectionStart != null
      ? [attivo.selectionStart, attivo.selectionEnd] : null;
    const zonaVecchia = box.querySelector("#wa-messaggi");
    const inFondo = !zonaVecchia ||
      zonaVecchia.scrollHeight - zonaVecchia.scrollTop - zonaVecchia.clientHeight < 60;

    const finestra = inProva || !!aperta?.finestra_aperta;

    box.innerHTML = `
      ${messaggio ? erroreBox(messaggio) : ""}
      ${avvisoPendente ? avvisoBox(avvisoPendente) : ""}
      <div class="wa-corpo ${!vediElenco && (apertaId || inProva) ? "apri-thread" : ""}">
        <aside class="wa-lista">
          <div class="wa-lista-testa">
            <input id="wa-cerca" class="wa-cerca" type="search" autocomplete="off"
                   placeholder="Cerca un nome o un numero">
            <div class="wa-filtri">
              ${FILTRI.map((f) => {
                const n = f.conta ? conteggi[f.conta] : 0;
                return `<button class="wa-pil ${filtro === f.id ? "attiva" : ""}"
                                data-filtro="${f.id}">${esc(f.nome)}${
                  f.conta && n ? `<span class="wa-pallino">${n}</span>` : ""}</button>`;
              }).join("")}
            </div>
          </div>

          <div class="wa-voci">
            ${lista.length ? lista.map((c) => `
              <button class="wa-voce ${(c.id ?? null) === apertaId ? "attiva" : ""} ${c.prova ? "prova" : ""}"
                      data-id="${c.id ?? ""}">
                ${avatar(c)}
                <span class="wa-voce-corpo">
                  <span class="wa-voce-testa">
                    <strong>${esc(c.nome)}</strong>
                    <span class="wa-quando">${c.prova ? "prova" : esc(quandoBreve(c.quando))}</span>
                  </span>
                  <span class="wa-ultimo">${c.ultimo
                    ? (c.ultimo_da === "out" ? "✓ " : "") + esc(String(c.ultimo).slice(0, 90))
                    : "<em>Scrivi qui per provare il bot</em>"}</span>
                  <span class="wa-segni">
                    ${c.stato === "umano" && !c.prova ? `<span class="wa-tag">rispondi tu</span>` : ""}
                    ${c.fase ? `<span class="wa-tag fase">${esc(FASI[c.fase] || "")}</span>` : ""}
                    ${!c.prova && c.attesa_min != null
                      ? `<span class="wa-attesa ${tempraAttesa(c.attesa_min)}">${esc(attesaBreve(c.attesa_min))}</span>`
                      : ""}
                  </span>
                </span>
              </button>`).join("")
              : `<p class="wa-vuoto">${cerca.trim() || filtro
                   ? "Nessuna chat con questi filtri."
                   : "Nessuna conversazione."}</p>`}
          </div>
        </aside>

        <section class="wa-thread">
          ${sel ? `
            <div class="wa-thread-testa">
              <button class="wa-indietro" title="Torna all'elenco">‹</button>
              ${avatar(sel)}
              <span class="wa-chi">
                <strong>${esc(sel.nome)}</strong>
                ${sel.prova ? `<span class="wa-tel">solo dentro il gestionale</span>`
                            : `<span class="wa-tel">+${esc(sel.telefono || "")}</span>`}
              </span>
              ${sel.prova ? `
                <button class="btn-mini" id="wa-azzera">Ricomincia</button>
              ` : `
                <select class="wa-fase" id="wa-fase" title="${sel.appuntamento_at
                  ? `Appuntamento ${esc(quandoLungo(sel.appuntamento_at))}`
                  : "Stato dell'appuntamento"}">
                  ${FASI.map((f, i) => `<option value="${i}" ${
                    Number(sel.fase || 0) === i ? "selected" : ""}>${esc(f)}</option>`).join("")}
                </select>
                <button class="btn-mini" id="wa-passa">
                  ${aperta?.stato === "umano" ? "Riattiva il bot" : "Rispondo io"}
                </button>
                ${sel.attesa_min != null
                  ? `<span class="wa-attesa ${tempraAttesa(sel.attesa_min)}"
                           title="Aspetta una risposta da ${esc(attesaBreve(sel.attesa_min))}">${
                      esc(attesaBreve(sel.attesa_min))}</span>`
                  : ""}
                <button class="wa-info" id="wa-info" title="Scheda della cliente">i</button>`}
            </div>

            ${sel.prova ? `<p class="wa-nota">Questa chat vive solo qui dentro: il bot risponde
                            come farebbe su WhatsApp, usando davvero la tua agenda.</p>` : ""}
            ${aperta?.stato === "umano" && !sel.prova
              ? `<p class="wa-nota">Il bot è in pausa su questa chat: rispondi tu, da qui o dal telefono.</p>` : ""}

            <div class="wa-messaggi" id="wa-messaggi">
              ${aperta?.errore ? erroreBox(aperta.errore) : ""}
              ${(aperta?.messaggi || []).map(bolla).join("")}
              ${!aperta?.messaggi?.length && !aperta?.errore
                ? `<p class="wa-vuoto">${sel.prova ? "Scrivi come farebbe una cliente." : "Nessun messaggio."}</p>` : ""}
            </div>

            ${finestra ? `
              <form class="wa-scrivi" id="wa-form">
                ${sel.prova ? "" : `<button type="button" class="btn-mini" id="wa-template">Template</button>`}
                <input id="wa-testo" autocomplete="off"
                       placeholder="${sel.prova ? "Ciao, vorrei prenotare…" : "Scrivi un messaggio…"}">
                <button class="btn" type="submit">Invia</button>
              </form>
            ` : `
              <div class="wa-chiusa">
                <p class="wa-chiusa-nota">La chat si è chiusa dopo 24 ore senza risposta della
                  cliente. Manda un template per stimolare una risposta.</p>
                <div class="wa-chiusa-riga">
                  <input class="wa-chiuso" disabled placeholder="Qui non si può più scrivere a mano">
                  <button class="btn-mini" id="wa-riprogramma">Riprogramma</button>
                  <button class="btn" id="wa-template">Template</button>
                </div>
              </div>`}
          ` : `<p class="wa-vuoto">Nessuna conversazione.</p>`}
        </section>
      </div>`;

    const campo = box.querySelector("#wa-testo");
    if (campo) {
      campo.value = bozze.get(chiave(sel)) ?? "";
      campo.oninput = () => bozze.set(chiave(sel), campo.value);
    }
    const campoCerca = box.querySelector("#wa-cerca");
    if (campoCerca) campoCerca.value = cerca;

    const daRimettere = fuoco ? box.querySelector(`#${fuoco}`) : null;
    if (daRimettere) {
      daRimettere.focus();
      if (punto && daRimettere.setSelectionRange) {
        try { daRimettere.setSelectionRange(punto[0], punto[1]); } catch { /* campi senza cursore */ }
      }
    } else if (vuoiFocus && campo) campo.focus();
    vuoiFocus = false;

    const zona = box.querySelector("#wa-messaggi");
    // In fondo solo se ci era già: se stava rileggendo una cosa di ieri, il
    // battito non deve strapparle via la pagina da sotto gli occhi.
    if (zona && inFondo) zona.scrollTop = zona.scrollHeight;

    // Gli handler si riattaccano a ogni disegno con l'assegnazione diretta:
    // l'HTML è appena stato riscritto, quindi non se ne accumulano.
    box.querySelectorAll(".wa-voce").forEach((b) => {
      b.onclick = async () => {
        apertaId = b.dataset.id || null;
        voce = lista.find((c) => (c.id ?? null) === apertaId) || null;
        aperta = apertaId ? null : { messaggi: [] };
        vediElenco = false;
        if (apertaId) await caricaThread(apertaId, true);
        // Il cursore va nel campo solo nella prova, dove aprire vuol dire
        // scrivere. Su una chat vera si apre per leggere, e su un telefono la
        // tastiera che salta su da sola si mangia metà dei messaggi.
        vuoiFocus = b.classList.contains("prova");
        disegna();
      };
    });

    const indietro = box.querySelector(".wa-indietro");
    if (indietro) indietro.onclick = () => {
      // Il ritorno all'elenco è uno stato, non solo una classe tolta al volo:
      // al battito dopo il disegno la rimetterebbe e il thread si riaprirebbe
      // da solo, sotto le dita di chi stava scorrendo l'elenco.
      vediElenco = true;
      box.querySelector(".wa-corpo").classList.remove("apri-thread");
    };

    if (campoCerca) campoCerca.oninput = () => {
      cerca = campoCerca.value;
      clearTimeout(attesaCerca);
      // Un giro al database per ogni tasto è uno spreco e una lista che
      // sfarfalla: si aspetta che abbia smesso di scrivere.
      attesaCerca = setTimeout(() => ricarica(), 300);
    };

    box.querySelectorAll(".wa-pil").forEach((b) => {
      b.onclick = () => { filtro = b.dataset.filtro || ""; ricarica(); };
    });

    const passa = box.querySelector("#wa-passa");
    if (passa) passa.onclick = async () => {
      const nuovo = aperta?.stato === "umano" ? "bot" : "umano";
      passa.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_chat_stato", {
        p_conversation: apertaId, p_stato: nuovo,
      });
      if (error || !data?.ok) return disegna(error?.message || data?.errore || "Non riuscito");
      await ricarica(true);
    };

    const fase = box.querySelector("#wa-fase");
    if (fase) fase.onchange = async () => {
      const scelta = Number(fase.value);
      fase.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_scheda", {
        p_conversation: apertaId, p_offerta: null,
        p_fase: scelta, p_appuntamento: null,
      });
      if (error || !data?.ok) return disegna(error?.message || data?.errore || "Non riuscito");
      await ricarica(true);
    };

    const azzera = box.querySelector("#wa-azzera");
    if (azzera) azzera.onclick = async () => {
      azzera.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_prova_azzera", { p_centro: stato.centro.id });
      if (error || !data?.ok) return disegna(error?.message || data?.errore || "Non riuscito");
      aperta = { messaggi: [], stato: "bot" };
      await ricarica(true);
    };

    const info = box.querySelector("#wa-info");
    if (info) info.onclick = () => dialogoDettagli();

    // "Riprogramma" è la scheda aperta sull'appuntamento: la data sta lì, e un
    // secondo posto per scrivere la stessa cosa sarebbe un posto in cui
    // scriverla diversa.
    const riprogramma = box.querySelector("#wa-riprogramma");
    if (riprogramma) riprogramma.onclick = () => dialogoDettagli();

    const template = box.querySelector("#wa-template");
    if (template) template.onclick = () => dialogoTemplate();

    const form = box.querySelector("#wa-form");
    if (form) form.onsubmit = (e) => { e.preventDefault(); invia(); };
  }

  // -------------------------------------------------------------- invio

  async function invia() {
    const sel = voce;
    const campo = box.querySelector("#wa-testo");
    const testo = (campo?.value ?? "").trim();
    if (!testo || inviando) return;
    inviando = true;
    campo.value = "";
    bozze.set(chiave(sel), "");
    // L'avviso del giro prima ha esaurito il suo compito: riguardava un
    // messaggio che ormai è stato letto, e lasciarlo lì confonderebbe questo.
    avvisoPendente = "";

    // Si mostra subito quello che è stato scritto: l'invio passa da Meta, e
    // qualche secondo di silenzio su una chat sembra un guasto. Nella prova la
    // titolare fa la cliente, quindi la sua riga è in entrata e sotto compaiono
    // i puntini del bot che pensa; su una chat vera è un messaggio in uscita.
    const zona = box.querySelector("#wa-messaggi");
    zona.querySelector(".wa-vuoto")?.remove();
    zona.insertAdjacentHTML("beforeend", sel?.prova
      ? `<div class="wa-riga in"><div class="wa-bolla in">${esc(testo)}</div></div>
         <div class="wa-riga out"><div class="wa-bolla out attesa" id="wa-attesa">
           <span></span><span></span><span></span></div></div>`
      // Niente a capo dentro la bolla: il testo va a capo come l'ha scritto lei
      // (pre-wrap), e un'andata a capo del sorgente diventerebbe una riga vuota.
      : `<div class="wa-riga out"><div class="wa-bolla out">${esc(testo)}` +
        `<span class="wa-ora">in partenza…</span></div></div>`);
    zona.scrollTop = zona.scrollHeight;

    try {
      // La prova non passa da wa-send: lì non c'è niente da mandare a WhatsApp,
      // serve che risponda il bot, e il bot vive dentro wa-inbound.
      const esito = sel?.prova
        ? await chiama("wa-inbound", { centro_id: stato.centro.id, testo }, { "x-prova": "1" })
        : await chiama("wa-send", { conversation_id: apertaId, testo });
      inviando = false;
      if (!esito?.ok) {
        if (sel?.prova && esito?.conversation_id) apertaId = esito.conversation_id;
        // Se non è partito, quello che aveva scritto torna nel campo: farlo
        // sparire insieme all'errore vorrebbe dire riscriverlo a memoria.
        bozze.set(chiave(sel), testo);
        return disegna(esito?.errore || "Il messaggio non è partito");
      }
      if (sel?.prova) apertaId = esito.conversation_id ?? apertaId;
      // Meta l'ha preso ma la scrittura nel thread è fallita: il messaggio è
      // partito davvero. Se non lo dicessimo, lei non lo vedrebbe comparire e
      // lo riscriverebbe — e la cliente se lo ritroverebbe due volte.
      if (esito.avviso) avvisoPendente = String(esito.avviso);
      vuoiFocus = true;
      await ricarica(true);
    } catch (e) {
      inviando = false;
      bozze.set(chiave(sel), testo);
      disegna(String(e.message || e));
    }
  }

  // ---------------------------------------------------------- i template

  // I template non si scrivono qui: sono già approvati da Meta e l'operatrice
  // riempie solo i buchi. L'elenco arriva dalla WABA del centro attraverso
  // wa-templates, così è sempre quello vero e non una copia da tenere allineata
  // a mano — ma vale la pena chiederlo una volta sola per visita: fra un invio
  // e l'altro l'elenco approvato non cambia.
  async function leggiTemplate(conversazione) {
    if (templateCache) return templateCache;
    // Si manda la conversazione, non il centro: WABA e token si ricavano da lì,
    // ed è l'unica strada che verifica anche che questa chat appartenga davvero
    // a un centro di cui è titolare. Il centro viaggia solo come riscontro.
    const esito = await chiama("wa-templates", {
      conversation_id: conversazione, centro_id: stato.centro.id,
    });
    if (!esito?.ok) throw new Error(esito?.errore || "Non riesco a leggere i template");
    // Quanti ne abbiamo scartati perché non sappiamo comporli qui: senza questo
    // numero, un elenco vuoto direbbe "non ne hai" a un centro che ne ha quattro,
    // e la manderebbe a crearne altri che finirebbero scartati uguale.
    templateEsclusi = Number(esito.esclusi || 0);
    templateCache = (esito.template || []).map((t) => ({
      ...t,
      variabili: (t.variabili || []).map((v) => ({
        indice: Number(v.indice),
        // I template creati con l'editor nuovo di Meta hanno segnaposto col
        // nome ({{nome_cliente}}) invece del numero. Perdere il nome qui vuol
        // dire spedirli posizionali, e Meta li rifiuta.
        nome: v.nome ? String(v.nome) : null,
        etichetta: String(v.etichetta || ""),
        esempio: String(v.esempio || ""),
      })),
    }));
    return templateCache;
  }

  async function dialogoTemplate() {
    const conversazione = apertaId;
    const chi = voce?.nome || "";
    const { box: scheda, chiudi } = pannello();
    scheda.classList.add("wa-scheda-larga");
    scheda.innerHTML = `<h2>Invio template</h2><p class="loading">Chiedo a Meta l'elenco…</p>`;

    let elenco;
    try {
      elenco = await leggiTemplate(conversazione);
    } catch (e) {
      if (!scheda.isConnected) return;
      scheda.innerHTML = `<h2>Invio template</h2>${erroreBox(String(e.message || e))}`;
      return;
    }
    // Il velo si chiude toccando fuori: dopo l'attesa può non esserci più, e
    // scrivere dentro una scheda staccata dalla pagina non si vede.
    if (!scheda.isConnected) return;

    let scelto = null;
    const valori = new Map();   // indice della variabile -> quello che ha scritto
    let mandando = false;

    disegnaDialogo();

    function pieno() {
      return !!scelto && scelto.variabili.every((v) => (valori.get(v.indice) || "").trim());
    }

    // Un posto solo dove si riempiono i buchi, perché l'anteprima e il testo
    // che finirà nel thread devono per forza dire la stessa cosa. Meta usa due
    // forme di segnaposto: {{1}} posizionale e {{nome_cliente}} col nome, e
    // guardando solo la prima i template nuovi resterebbero con i buchi in vista.
    function sostituisci(corpo, avvolgi) {
      return String(corpo || "").replace(/\{\{\s*([A-Za-z0-9_]+)\s*\}\}/g, (intero, chiave) => {
        const v = scelto.variabili.find((x) =>
          (x.nome ? x.nome === chiave : String(x.indice) === chiave));
        if (!v) return intero;
        return avvolgi((valori.get(v.indice) || "").trim() || v.esempio || chiave);
      });
    }

    function corpoBolla() {
      // Prima si mette al sicuro il testo che arriva da Meta, poi ci si
      // infilano i valori messi al sicuro a loro volta: al contrario, un nome
      // con dentro un < smonterebbe l'anteprima insieme alla scheda.
      const dentro = sostituisci(esc(scelto.corpo || ""),
        (s) => `<span class="wa-var">${esc(s)}</span>`);
      return dentro + `<span class="wa-ora">${esc(quandoBreve(new Date().toISOString()))} ✓</span>`;
    }

    // Quello che la cliente leggerà davvero. Va spedito insieme all'invio: senza,
    // nel thread resterebbe scritto il nome tecnico del template, e chi rilegge
    // la chat un'ora dopo non saprebbe cosa le è stato mandato.
    function corpoTesto() {
      return sostituisci(scelto.corpo || "", (s) => s);
    }

    function disegnaDialogo(messaggio = "") {
      scheda.innerHTML = `
        <h2>Invio template</h2>
        <p class="quando">A ${esc(chi)}</p>
        ${messaggio ? erroreBox(messaggio) : ""}
        ${elenco.length ? `
          <label class="wa-etichetta">Seleziona template</label>
          <div class="wa-chip-riga">
            ${elenco.map((t, i) => `
              <button class="wa-chip ${scelto === t ? "scelto" : ""}" data-i="${i}">
                ${esc(String(t.nome || "").replace(/_/g, " "))}
                ${t.lingua ? `<span class="wa-chip-lingua">${esc(t.lingua)}</span>` : ""}
              </button>`).join("")}
          </div>
          ${scelto ? `
            <div class="wa-tmpl">
              <div class="wa-tmpl-campi">
                ${scelto.variabili.length ? scelto.variabili.map((v) => `
                  <label class="campo">
                    <span>${esc(v.etichetta || `Variabile ${v.indice}`)}</span>
                    <input data-v="${v.indice}" autocomplete="off"
                           value="${esc(valori.get(v.indice) || "")}"
                           placeholder="${esc(v.esempio || "")}">
                  </label>`).join("")
                  : `<p class="wa-vuoto">Questo template non ha niente da riempire.</p>`}
              </div>
              <div class="wa-tmpl-anteprima">
                <div class="wa-riga out">
                  <div class="wa-bolla out" id="wa-tmpl-bolla">${corpoBolla()}</div>
                </div>
              </div>
            </div>
          ` : `<p class="wa-vuoto">Scegli qui sopra il messaggio da mandare.</p>`}
          <div class="wa-tmpl-azioni">
            <button class="btn" id="wa-tmpl-invia" ${pieno() ? "" : "disabled"}>Invia</button>
            <button class="btn-secondario" id="wa-tmpl-annulla">Annulla</button>
          </div>
        ` : avvisoBox(templateEsclusi
              ? `Questo centro ha ${templateEsclusi} template approvati da Meta, ma nessuno
                 che si possa comporre da qui: hanno un'immagine in testa o un bottone con
                 dentro un pezzo variabile. Per mandarli serve WhatsApp Manager.`
              : `Questo centro non ha ancora nessun template approvato da Meta.
                 Si creano dal Business Manager, e vanno approvati prima di poterli mandare.`) +
            `<div class="wa-tmpl-azioni">
               <button class="btn-secondario" id="wa-tmpl-annulla">Chiudi</button>
             </div>`}`;

      scheda.querySelectorAll(".wa-chip").forEach((b) => {
        b.onclick = () => {
          scelto = elenco[Number(b.dataset.i)];
          valori.clear();
          disegnaDialogo();
        };
      });

      const bolla = scheda.querySelector("#wa-tmpl-bolla");
      const invia = scheda.querySelector("#wa-tmpl-invia");
      scheda.querySelectorAll(".wa-tmpl-campi input").forEach((inp) => {
        // A ogni tasto si riscrive solo l'anteprima e si riconta se è piena:
        // ridisegnare tutta la scheda porterebbe via il cursore dal campo a
        // metà parola, che è il modo più veloce per far smettere di scrivere.
        inp.oninput = () => {
          valori.set(Number(inp.dataset.v), inp.value);
          if (bolla) bolla.innerHTML = corpoBolla();
          if (invia) invia.disabled = !pieno();
        };
      });

      const annulla = scheda.querySelector("#wa-tmpl-annulla");
      if (annulla) annulla.onclick = chiudi;

      if (invia) invia.onclick = async () => {
        if (!pieno() || mandando) return;
        mandando = true;
        invia.disabled = true;
        invia.textContent = "Invio…";
        // Va azzerato QUI e non solo in invia(): in una chat oltre le 24 ore il
        // campo di scrittura non esiste, il template è l'unica cosa che si può
        // mandare, e un avviso rimasto acceso non avrebbe nessun'altra strada
        // per spegnersi — se lo ritroverebbe addosso a ogni chat che apre.
        avvisoPendente = "";
        const esito = await chiama("wa-send", {
          conversation_id: conversazione,
          template: scelto.nome,
          lingua: scelto.lingua,
          testo: corpoTesto(),
          // Chi ha il nome viaggia come oggetto: per quei template Meta guarda
          // il nome e non la posizione, e una stringa secca si prenderebbe un
          // rifiuto che parla di "numero di variabili sbagliato".
          variabili: scelto.variabili.map((v) => {
            const valore = (valori.get(v.indice) || "").trim();
            return v.nome ? { nome: v.nome, valore } : valore;
          }),
        });
        mandando = false;
        if (!esito?.ok) return disegnaDialogo(esito?.errore || "Il template non è partito");
        chiudi();
        if (esito.avviso) avvisoPendente = String(esito.avviso);
        await ricarica(true);
      };
    }
  }

  // ------------------------------------------------------- la scheda (i)

  async function dialogoDettagli() {
    const conversazione = apertaId;
    if (!conversazione) return;
    const { box: scheda, chiudi } = pannello();
    scheda.innerHTML = `<p class="loading">Carico la scheda…</p>`;

    const { data, error } = await sb.rpc("crm_wa_dettagli", { p_conversation: conversazione });
    if (!scheda.isConnected) return;
    if (error || !data?.ok) {
      scheda.innerHTML = `<h2>Scheda</h2>${erroreBox(error?.message || data?.errore || "Non disponibile")}`;
      return;
    }

    let note = data.note || [];
    disegnaScheda();

    function disegnaScheda(messaggio = "") {
      scheda.innerHTML = `
        <h2>${esc(data.nome || "")}</h2>
        <p class="quando">+${esc(data.telefono || "")}${
          data.campagna ? ` · arrivata da ${esc(data.campagna)}` : ""}</p>
        ${messaggio ? erroreBox(messaggio) : ""}

        <label class="campo">
          <span>Servizio in trattativa</span>
          <input id="wa-d-offerta" autocomplete="off" value="${esc(data.offerta || "")}"
                 placeholder="Es. percorso corpo">
        </label>
        <label class="campo">
          <span>A che punto siamo</span>
          <select id="wa-d-fase">
            ${FASI.map((f, i) => `<option value="${i}" ${
              Number(data.fase || 0) === i ? "selected" : ""}>${esc(f)}</option>`).join("")}
          </select>
        </label>
        <label class="campo">
          <span>Appuntamento</span>
          <input type="datetime-local" id="wa-d-quando" value="${esc(perCampo(data.appuntamento_at))}">
        </label>
        <button class="btn" id="wa-d-salva">Salva</button>

        <h3 class="wa-titoletto">Note</h3>
        <div class="wa-note">
          ${note.length ? note.map((n) => `
            <div class="wa-nota-riga">
              <p>${esc(n.testo)}</p>
              <span class="wa-quando">${esc(quandoLungo(n.quando))}</span>
            </div>`).join("")
            : `<p class="wa-vuoto">Nessuna nota.</p>`}
        </div>
        <label class="campo">
          <span>Aggiungi una nota</span>
          <textarea id="wa-d-nota" rows="2" placeholder="Quello che è meglio ricordarsi"></textarea>
        </label>
        <button class="btn-mini" id="wa-d-aggiungi">Aggiungi</button>`;

      const salva = scheda.querySelector("#wa-d-salva");
      salva.onclick = async () => {
        const quando = scheda.querySelector("#wa-d-quando").value;
        salva.disabled = true;
        salva.textContent = "Salvo…";
        const { data: esito, error: err } = await sb.rpc("crm_wa_scheda", {
          p_conversation: conversazione,
          p_offerta: scheda.querySelector("#wa-d-offerta").value.trim(),
          p_fase: Number(scheda.querySelector("#wa-d-fase").value),
          // La data vuota vuol dire "non l'ho toccata" e non "cancellala": di
          // là quello che arriva nullo viene lasciato com'è, quindi un
          // appuntamento si sposta cambiandolo, non svuotando il campo.
          p_appuntamento: quando ? new Date(quando).toISOString() : null,
        });
        if (err || !esito?.ok) {
          salva.disabled = false;
          salva.textContent = "Salva";
          return disegnaScheda(err?.message || esito?.errore || "Non riuscito");
        }
        chiudi();
        // L'intestazione della chat mostra le stesse cose: se non si rilegge,
        // il menu resta indietro rispetto a quello che è appena stato scritto.
        await ricarica(true);
      };

      const aggiungi = scheda.querySelector("#wa-d-aggiungi");
      aggiungi.onclick = async () => {
        const campo = scheda.querySelector("#wa-d-nota");
        const testo = campo.value.trim();
        if (!testo) return;
        aggiungi.disabled = true;
        const { data: esito, error: err } = await sb.rpc("crm_wa_nota", {
          p_conversation: conversazione, p_testo: testo,
        });
        aggiungi.disabled = false;
        if (err || !esito?.ok) return disegnaScheda(err?.message || esito?.errore || "Non riuscito");
        note = esito.note || note;
        disegnaScheda();
      };
    }
  }

  // Uscendo dalla tab il battito va spento, e con lui la ricerca in attesa:
  // altrimenti continuerebbero a chiedere messaggi mentre si guarda l'agenda.
  return () => { clearInterval(battito); clearTimeout(attesaCerca); };
}
