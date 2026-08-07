// Il listino del centro: i servizi che in agenda si prenotano, qui si
// governano. La schermata ricalca il catalogo di Pipelean: card con la
// barretta del colore dell'agenda, nome, durata e prezzo; sotto, in tono
// spento, i servizi archiviati. Un servizio non si elimina mai — ha
// appuntamenti passati che lo nominano — si archivia, e si può riattivare.

import { sb, app, stato, esc, pagina, erroreBox, pannello } from "./core.js?v=29";

// La ricerca sopravvive al cambio sezione, come `vista` nella rubrica: chi
// stava cercando "manicure" e passa dall'agenda ritrova la griglia filtrata.
let cerca = "";
let servizi = [];                          // tutti, anche gli archiviati

// I codici errore arrivano macchina-leggibili dalle RPC; i testi stanno qui.
const ERRORI = {
  non_autorizzato:     "Solo la titolare può modificare i servizi.",
  nome_mancante:       "Il titolo è obbligatorio.",
  durata_non_valida:   "Scegli una durata.",
  prezzo_non_valido:   "Il prezzo non può essere negativo.",
  servizio_inesistente: "Questo servizio non esiste più.",
  descrizione_troppo_lunga: "La descrizione può arrivare a 2048 caratteri.",
};
const testoErrore = (data, error, altrimenti) =>
  ERRORI[data?.errore] || data?.errore || error?.message || altrimenti;

// Le stesse durate del modale appuntamento dell'agenda: un servizio con una
// durata che l'agenda non offre partirebbe già disallineato.
const DURATE = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

// Colori fra cui scegliere, pensati per distinguersi da lontano nella griglia
// dell'agenda. Il primo è il viola che l'agenda usa già come ripiego.
const COLORI = ["#6B4E9B", "#d6497f", "#d9a441", "#3b6fb5", "#2e9bb0",
                "#2f8f6b", "#7a8a3a", "#d96a41", "#b0413e", "#8a7a72"];

// "1h 30m", "2h", "45m": come la scrive Pipelean, comoda da leggere di corsa.
const durataUmana = (min) => {
  const h = Math.floor(min / 60), m = min % 60;
  return h > 0 && m > 0 ? `${h}h ${m}m` : h > 0 ? `${h}h` : `${m}m`;
};

// Prezzo all'italiana: intero se è tondo, virgola se non lo è. Zero si mostra
// lo stesso — un listino con buchi sembra rotto, "0€" dice "gratuito".
const prezzoUmano = (p) => {
  const n = Number(p || 0);
  return (Number.isInteger(n) ? String(n) : n.toFixed(2).replace(".", ",")) + "€";
};

// ------------------------------------------------------------------ ingresso

export function mostraServizi() {
  // route() non fa entrare chi non è titolare, ma la guardia costa una riga.
  if (stato.centro?.ruolo !== "titolare") { location.replace("#/"); return; }

  app.innerHTML = pagina(`<h1>Servizi</h1><p class="sub">Caricamento…</p>`);
  const box = app.querySelector(".pagina");
  carica(box);
}

async function carica(box) {
  const { data, error } = await sb.rpc("crm_servizi", { p_centro: stato.centro.id });
  if (!box.isConnected) return;            // nel frattempo si è cambiata sezione

  if (error || !data?.ok) {
    // Tipicamente: sql/servizi.sql non ancora eseguito. Meglio il messaggio
    // vero di una pagina bianca.
    box.innerHTML = `<h1>Servizi</h1>` +
      erroreBox(testoErrore(data, error, "Non riesco a caricare i servizi."));
    return;
  }
  servizi = data.servizi || [];
  disegna(box);
}

// ------------------------------------------------------------------- disegno

function disegna(box) {
  box.innerHTML = `
    <h1>Servizi</h1>
    <p class="sub">Il listino del centro: quello che le clienti prenotano in agenda.</p>
    <div class="srv-toolbar">
      <input id="srv-cerca" class="srv-cerca" type="search" placeholder="Cerca per nome Servizio"
             value="${esc(cerca)}" aria-label="Cerca per nome Servizio" autocomplete="off">
      <button id="srv-crea" class="btn">Aggiungi</button>
    </div>
    <div class="srv-esito"></div>
    <div class="srv-corpo">${htmlGriglie()}</div>`;

  // La ricerca è locale: i servizi sono decine, non migliaia, e sono già
  // tutti qui — chiedere al database a ogni battuta sarebbe solo attesa.
  const campo = box.querySelector("#srv-cerca");
  campo.oninput = () => {
    cerca = campo.value.trim();
    box.querySelector(".srv-corpo").innerHTML = htmlGriglie();
    agganciaCard(box);
  };

  box.querySelector("#srv-crea").onclick = () => apriServizio(box, null);
  agganciaCard(box);
}

function htmlGriglie() {
  const filtro = cerca.toLowerCase();
  const visibili = servizi.filter((s) => s.nome.toLowerCase().includes(filtro));
  const attivi = visibili.filter((s) => !s.archiviato);
  const archiviati = visibili.filter((s) => s.archiviato);

  const card = (s) => `
    <button class="srv-card ${s.archiviato ? "spenta" : ""}" data-id="${esc(s.id)}">
      <span class="srv-colore" style="background:${esc(s.colore || COLORI[0])}"></span>
      <span class="srv-info">
        <span class="srv-nome">${esc(s.nome)}</span>
        <span class="srv-durata">Durata: ${durataUmana(s.durata)}</span>
      </span>
      <span class="srv-prezzo">${prezzoUmano(s.prezzo)}</span>
    </button>`;

  return `
    ${attivi.length
      ? `<div class="srv-griglia">${attivi.map(card).join("")}</div>`
      : `<p class="vuoto">${servizi.length
           ? "Nessun servizio corrisponde alla ricerca."
           : "Non c'è ancora nessun servizio: comincia da “Aggiungi”."}</p>`}
    ${archiviati.length ? `
      <h2 class="srv-titolo-archiviati">Archiviati</h2>
      <div class="srv-griglia">${archiviati.map(card).join("")}</div>` : ""}`;
}

function agganciaCard(box) {
  box.querySelectorAll(".srv-card").forEach((c) => {
    c.onclick = () => {
      const s = servizi.find((x) => x.id === c.dataset.id);
      if (s) apriServizio(box, s);
    };
  });
}

function mostraEsito(box, html) {
  const zona = box.querySelector(".srv-esito");
  if (zona) zona.innerHTML = html;
}

// L'agenda legge i trattamenti dallo stato condiviso caricato all'ingresso:
// dopo ogni modifica va riallineato a mano, o il modale appuntamento
// proporrebbe il listino di prima fino al prossimo ricaricamento.
function allineaAnagrafiche() {
  if (!stato.anagrafiche) return;
  stato.anagrafiche.trattamenti = servizi
    .filter((s) => !s.archiviato)
    .map(({ id, nome, durata, prezzo, colore, descrizione }) =>
      ({ id, nome, durata, prezzo, colore, descrizione }))
    .sort((a, b) => a.nome.localeCompare(b.nome));
}

// -------------------------------------------------------- crea / modifica

function apriServizio(box, servizio) {
  const { box: scheda, chiudi } = pannello();
  const colore0 = servizio?.colore || COLORI[0];

  scheda.innerHTML = `
    <h2>${servizio ? "Modifica servizio" : "Nuovo servizio"}</h2>
    <div class="campo"><label for="srv-f-nome">Titolo</label>
      <input id="srv-f-nome" maxlength="120" value="${esc(servizio?.nome || "")}"
             placeholder="Pulizia viso" autocomplete="off"></div>
    <div class="campo"><label for="srv-f-descr">Descrizione</label>
      <p class="srv-descr-aiuto">La receptionist WhatsApp risponde in base a queste
         informazioni: cos'è il servizio, per chi è indicato, che benefici ha.</p>
      <textarea id="srv-f-descr" maxlength="2048" rows="4"
                placeholder="Una pulizia profonda del viso indicata per…">${esc(servizio?.descrizione || "")}</textarea></div>
    <div class="campo"><label for="srv-f-durata">Durata</label>
      <select id="srv-f-durata">
        ${DURATE.map((d) => `<option value="${d}" ${d === (servizio?.durata ?? 60) ? "selected" : ""}>
           ${durataUmana(d)}</option>`).join("")}
      </select></div>
    <div class="campo"><label for="srv-f-prezzo">Prezzo (€)</label>
      <input id="srv-f-prezzo" type="number" min="0" step="0.01" inputmode="decimal"
             value="${servizio?.prezzo ?? ""}" placeholder="0 = gratuito" autocomplete="off"></div>
    <div class="campo"><label>Colore in agenda</label>
      <div class="srv-colori">
        ${COLORI.map((c) => `
          <button type="button" class="srv-swatch ${c === colore0 ? "scelto" : ""}"
                  data-colore="${c}" style="background:${c}" aria-label="Colore ${c}"
                  ${c === colore0 ? 'aria-pressed="true"' : ""}></button>`).join("")}
      </div></div>
    <div id="srv-f-err"></div>
    <div class="scheda-azioni srv-azioni-scheda">
      ${servizio ? `<button class="btn-chiaro ${servizio.archiviato ? "" : "pericolo"}" id="srv-f-arch">
         ${servizio.archiviato ? "Riattiva" : "Archivia"}</button>` : ""}
      <button class="btn-chiaro" id="srv-f-chiudi">Chiudi</button>
      <button class="btn" id="srv-f-salva">Salva</button>
    </div>`;

  const el = (id) => scheda.querySelector("#" + id);
  el("srv-f-chiudi").onclick = chiudi;

  let colore = colore0;
  scheda.querySelectorAll(".srv-swatch").forEach((sw) => {
    sw.onclick = () => {
      colore = sw.dataset.colore;
      scheda.querySelectorAll(".srv-swatch").forEach((x) => {
        x.classList.toggle("scelto", x === sw);
        x.toggleAttribute("aria-pressed", x === sw);
      });
    };
  });

  el("srv-f-salva").onclick = async () => {
    const err = el("srv-f-err");
    err.innerHTML = "";
    const nome = el("srv-f-nome").value.trim();
    const prezzo = el("srv-f-prezzo").value === "" ? 0 : Number(el("srv-f-prezzo").value);
    // Stringa vuota, non null: per la RPC null vuol dire "non toccare" (è
    // quello che manda un frontend vecchio in cache), la vuota svuota davvero.
    const descrizione = el("srv-f-descr").value.trim();
    if (!nome) return void (err.innerHTML = erroreBox(ERRORI.nome_mancante));
    if (!(prezzo >= 0)) return void (err.innerHTML = erroreBox(ERRORI.prezzo_non_valido));

    const salva = el("srv-f-salva");
    salva.disabled = true;
    salva.textContent = "Salvo…";
    const { data, error } = await sb.rpc("crm_servizi_salva", {
      p_centro: stato.centro.id,
      p_nome: nome,
      p_durata: Number(el("srv-f-durata").value),
      p_prezzo: prezzo,
      p_colore: colore,
      p_descrizione: descrizione,
      p_id: servizio?.id ?? null,
    });
    if (error || !data?.ok) {
      err.innerHTML = erroreBox(testoErrore(data, error, "Non sono riuscito a salvare il servizio."));
      salva.disabled = false;
      salva.textContent = "Salva";
      return;
    }
    chiudi();
    // La lista si aggiorna in casa, senza richiedere tutto: quello che il
    // database ha accettato è quello che si è appena scritto.
    if (servizio) Object.assign(servizio, { nome, durata: Number(el("srv-f-durata").value), prezzo, colore,
                                            descrizione: descrizione || null });
    else servizi.push({ id: data.id, nome, durata: Number(el("srv-f-durata").value),
                        prezzo, colore, descrizione: descrizione || null, archiviato: false });
    servizi.sort((a, b) => a.nome.localeCompare(b.nome));
    allineaAnagrafiche();
    if (!box.isConnected) return;
    box.querySelector(".srv-corpo").innerHTML = htmlGriglie();
    agganciaCard(box);
  };

  const arch = el("srv-f-arch");
  if (arch) arch.onclick = async () => {
    arch.disabled = true;
    const { data, error } = await sb.rpc("crm_servizi_archivia", {
      p_centro: stato.centro.id,
      p_id: servizio.id,
      p_archivia: !servizio.archiviato,
    });
    if (error || !data?.ok) {
      el("srv-f-err").innerHTML = erroreBox(testoErrore(data, error, "Non sono riuscito."));
      arch.disabled = false;
      return;
    }
    servizio.archiviato = !servizio.archiviato;
    allineaAnagrafiche();
    chiudi();
    if (!box.isConnected) return;
    box.querySelector(".srv-corpo").innerHTML = htmlGriglie();
    agganciaCard(box);
    mostraEsito(box, `<div class="notice">${servizio.archiviato
      ? "Servizio archiviato: non è più prenotabile in agenda."
      : "Servizio riattivato: torna prenotabile in agenda."}</div>`);
  };

  el("srv-f-nome").focus();
}
