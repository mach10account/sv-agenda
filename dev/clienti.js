// La rubrica del centro: l'elenco dei clienti con ricerca, filtri salvabili
// come liste, creazione e modifica in pannello, eliminazione (chi ha
// appuntamenti in agenda o una chat WhatsApp non si tocca) e CSV nei due versi.
// I clienti nascevano solo dentro il modale appuntamento dell'agenda; da qui
// si vedono e si governano tutti.

import { sb, app, stato, esc, pagina, erroreBox, avvisoBox, pannello } from "./core.js?v=23";

// Cosa si sta guardando: sopravvive al cambio sezione (come `giorno` in
// agenda), si azzera solo ricaricando il sito.
const vista = {
  segmento: null,                          // id della lista attiva; null = tutti
  cerca: "",
  filtri: [],                              // [{campo, cond, v1, v2}] — lo stesso jsonb che va alla RPC
  ordine: { campo: "nome", verso: "asc" },
  pagina: 1,
  perPagina: 25,
};

let segmenti = [];                         // liste salvate del centro
let righe = [];                            // pagina corrente di clienti
let totale = 0;
const selezionati = new Set();             // id spuntati; si svuota a ogni cambio di insieme

// I codici errore arrivano macchina-leggibili dalle RPC; i testi stanno qui.
const ERRORI = {
  non_autorizzato:      "Non hai accesso a questo centro.",
  nome_mancante:        "Il nome è obbligatorio.",
  telefono_mancante:    "Il telefono è obbligatorio.",
  telefono_non_valido:  "Il numero di telefono non è valido: solo cifre, es. 393331234567.",
  telefono_duplicato:   "Esiste già un contatto con questo numero di telefono.",
  cliente_inesistente:  "Questo contatto non esiste più.",
  segmento_inesistente: "Questa lista non esiste più.",
  righe_non_valide:     "Il contenuto del file non è leggibile.",
  troppe_righe:         "Troppe righe in una volta: dividi il file.",
};
const testoErrore = (data, error, altrimenti) =>
  ERRORI[data?.errore] || data?.errore || error?.message || altrimenti;

// Campi filtrabili e loro condizioni: la stessa lista chiusa che il database
// accetta (crm.clienti_condizione) — un campo aggiunto qui senza SQL non
// filtrerebbe niente.
const CAMPI = {
  nome:                { testo: "Nome",                tipo: "text",   cond: ["contiene", "uguale"] },
  telefono:            { testo: "Telefono",            tipo: "text",   cond: ["contiene", "uguale"] },
  creato:              { testo: "Data di creazione",   tipo: "date",   cond: ["il", "prima", "dopo", "tra"] },
  n_appuntamenti:      { testo: "N. appuntamenti",     tipo: "number", cond: ["uguale", "almeno", "al_piu", "tra"] },
  ultimo_appuntamento: { testo: "Ultimo appuntamento", tipo: "date",   cond: ["il", "prima", "dopo", "tra"] },
};
const NOMI_COND = {
  contiene: "contiene", uguale: "uguale a", il: "il", prima: "prima del",
  dopo: "dopo il", tra: "tra", almeno: "almeno", al_piu: "al più",
};

const dataIt = (g) => {
  if (!g) return "—";
  const [a, m, gg] = String(g).split("-");
  return gg && m && a ? `${gg}/${m}/${a}` : esc(g);
};

function chiediClienti(extra = {}) {
  return sb.rpc("crm_clienti", {
    p_centro: stato.centro.id,
    p_cerca: vista.cerca || null,
    p_filtri: vista.filtri,
    p_ordine: vista.ordine,
    p_pagina: extra.pagina ?? vista.pagina,
    p_per_pagina: extra.perPagina ?? vista.perPagina,
  });
}

// ------------------------------------------------------------------ ingresso

export function mostraClienti() {
  // route() non fa entrare chi non ha centro, ma la guardia costa una riga.
  if (!stato.centro) { location.replace("#/"); return; }

  app.innerHTML = pagina(`<h1>Clienti</h1><p class="sub">Caricamento…</p>`);
  const box = app.querySelector(".pagina");
  carica(box);
}

async function carica(box) {
  const [segRes, cliRes] = await Promise.all([
    sb.rpc("crm_segmenti", { p_centro: stato.centro.id }),
    chiediClienti(),
  ]);
  if (!box.isConnected) return;            // nel frattempo si è cambiata sezione

  if (cliRes.error || !cliRes.data?.ok) {
    // Tipicamente: sql/clienti.sql non ancora eseguito. Meglio il messaggio
    // vero di una pagina bianca.
    box.innerHTML = `<h1>Clienti</h1>` +
      erroreBox(testoErrore(cliRes.data, cliRes.error, "Non riesco a caricare i clienti."));
    return;
  }
  segmenti = segRes.data || [];            // senza liste la rubrica vive lo stesso
  righe = cliRes.data.clienti || [];
  totale = cliRes.data.totale || 0;
  disegna(box);
}

// Richiede la pagina corrente e ridisegna. `tutto` rifà l'intera sezione;
// senza, si riscrivono solo tabella, paginazione e pillole — è la via della
// ricerca, che non può perdere il focus dell'input a ogni battuta.
async function aggiorna(box, { tutto = false } = {}) {
  const { data, error } = await chiediClienti();
  if (!box.isConnected) return;
  if (error || !data?.ok) {
    mostraEsito(box, erroreBox(testoErrore(data, error, "Non riesco a caricare i clienti.")));
    return;
  }
  righe = data.clienti || [];
  totale = data.totale || 0;

  // Eliminando le ultime righe dell'ultima pagina si resterebbe su una pagina
  // vuota oltre la fine: si rientra sull'ultima vera.
  const ultima = Math.max(1, Math.ceil(totale / vista.perPagina));
  if (!righe.length && totale && vista.pagina > ultima) {
    vista.pagina = ultima;
    return aggiorna(box, { tutto });
  }

  if (tutto) { disegna(box); return; }
  box.querySelector(".cli-tabella-scroll").innerHTML = htmlTabella();
  box.querySelector(".cli-pag").innerHTML = htmlPaginazione();
  box.querySelector(".cli-attivi").innerHTML = htmlFiltriAttivi();
  agganciaCorpo(box);
  aggiornaSelezione(box);
}

// ------------------------------------------------------------------- disegno

function disegna(box) {
  box.innerHTML = `
    <h1>Clienti</h1>
    <p class="sub">La rubrica del centro: cerca, filtra, importa ed esporta i tuoi contatti.</p>
    <div class="cli-layout">
      <aside class="cli-liste">${htmlListe()}</aside>
      <section class="cli-corpo">
        <div class="cli-toolbar">${htmlToolbar()}</div>
        <div class="cli-esito"></div>
        <div class="cli-attivi">${htmlFiltriAttivi()}</div>
        <div class="cli-tabella-scroll">${htmlTabella()}</div>
        <div class="cli-pag">${htmlPaginazione()}</div>
      </section>
    </div>`;
  aggancia(box);
}

function htmlListe() {
  return `
    <button class="cli-lista ${vista.segmento === null ? "attiva" : ""}" data-seg="">Tutti i contatti</button>
    ${segmenti.map((s) => `
      <span class="cli-lista-riga">
        <button class="cli-lista ${vista.segmento === s.id ? "attiva" : ""}"
                data-seg="${esc(s.id)}">${esc(s.nome)}</button>
        <button class="cli-lista-x" data-del-seg="${esc(s.id)}"
                aria-label="Elimina la lista ${esc(s.nome)}">×</button>
      </span>`).join("")}
    ${segmenti.length ? "" : `<p class="sub small">Non ci sono liste da mostrare.</p>`}`;
}

function htmlToolbar() {
  const n = vista.filtri.length;
  return `
    <input id="cli-cerca" class="cli-cerca" type="search" placeholder="Cerca"
           value="${esc(vista.cerca)}" aria-label="Cerca per nome o telefono" autocomplete="off">
    <button id="cli-filtri" class="btn-chiaro">Filtri${n ? ` (${n})` : ""}</button>
    <button id="cli-opzioni" class="btn-chiaro">Opzioni</button>
    <button id="cli-crea" class="btn">Crea contatto</button>
    <button id="cli-del-sel" class="btn-chiaro pericolo" ${selezionati.size ? "" : "hidden"}>
      Elimina selezionati (${selezionati.size})</button>`;
}

function htmlFiltriAttivi() {
  if (!vista.filtri.length) return "";
  return vista.filtri.map((f) => `
      <span class="cli-pillola">${esc(CAMPI[f.campo]?.testo || f.campo)}
        ${esc(NOMI_COND[f.cond] || f.cond)} ${esc(f.v1 ?? "")}${f.cond === "tra" ? ` e ${esc(f.v2 ?? "")}` : ""}</span>`).join("")
    + `<button id="cli-azzera" class="btn-mini">Azzera</button>`;
}

function htmlTabella() {
  const freccia = (campo) =>
    vista.ordine.campo === campo ? (vista.ordine.verso === "asc" ? " ▲" : " ▼") : "";
  const th = (campo, testo) => `<th data-ordina="${campo}">${testo}${freccia(campo)}</th>`;
  const tuttiSpuntati = righe.length > 0 && righe.every((c) => selezionati.has(c.id));

  return `
    <table class="cli-tabella">
      <thead><tr>
        <th class="cli-col-check"><input type="checkbox" id="cli-tutti"
            ${tuttiSpuntati ? "checked" : ""} aria-label="Seleziona la pagina"></th>
        ${th("nome", "Nome completo")}
        ${th("telefono", "Telefono")}
        <th class="cli-col-sec">Email</th>
        ${th("n_appuntamenti", "Appuntamenti")}
        ${th("ultimo_appuntamento", "Ultimo appuntamento")}
        <th></th>
      </tr></thead>
      <tbody>
        ${righe.length ? righe.map((c) => `
          <tr>
            <td class="cli-col-check"><input type="checkbox" class="cli-spunta"
                data-id="${esc(c.id)}" ${selezionati.has(c.id) ? "checked" : ""}
                aria-label="Seleziona ${esc(c.nome)} ${esc(c.cognome || "")}"></td>
            <td>${esc(c.nome)} ${esc(c.cognome || "")}</td>
            <td>${c.telefono ? `<a href="tel:${esc(c.telefono)}">${esc(c.telefono)}</a>` : "—"}</td>
            <td class="cli-col-sec">${c.email ? `<a href="mailto:${esc(c.email)}">${esc(c.email)}</a>` : "—"}</td>
            <td>${esc(c.n_appuntamenti)}</td>
            <td>${dataIt(c.ultimo_appuntamento)}</td>
            <td class="cli-azioni">
              <button class="btn-mini" data-modifica="${esc(c.id)}" aria-label="Modifica">✎</button>
              <button class="btn-mini pericolo" data-elimina="${esc(c.id)}" aria-label="Elimina">✕</button>
            </td>
          </tr>`).join("")
        : `<tr><td colspan="7" class="vuoto">Nessun contatto da mostrare.</td></tr>`}
      </tbody>
    </table>`;
}

function htmlPaginazione() {
  if (!totale) return "";
  const da = (vista.pagina - 1) * vista.perPagina + 1;
  const a = Math.min(vista.pagina * vista.perPagina, totale);
  const ultima = Math.max(1, Math.ceil(totale / vista.perPagina));
  return `
    <button class="btn-mini" id="cli-prec" ${vista.pagina <= 1 ? "disabled" : ""}
            aria-label="Pagina precedente">‹</button>
    <span>${da}–${a} di ${totale}</span>
    <button class="btn-mini" id="cli-succ" ${vista.pagina >= ultima ? "disabled" : ""}
            aria-label="Pagina successiva">›</button>`;
}

function mostraEsito(box, html) {
  const zona = box.querySelector(".cli-esito");
  if (zona) zona.innerHTML = html;
}

// ------------------------------------------------------------------ handler

function aggancia(box) {
  // Barra delle liste: si sceglie una lista o se ne butta una.
  box.querySelectorAll("[data-seg]").forEach((b) => {
    b.onclick = () => {
      const id = b.dataset.seg || null;
      vista.segmento = id;
      const s = segmenti.find((x) => x.id === id);
      vista.filtri = s ? structuredClone(s.filtri || []) : [];
      vista.pagina = 1;
      selezionati.clear();
      aggiorna(box, { tutto: true });
    };
  });
  box.querySelectorAll("[data-del-seg]").forEach((b) => {
    b.onclick = () => {
      const s = segmenti.find((x) => x.id === b.dataset.delSeg);
      if (s) confermaEliminaSegmento(box, s);
    };
  });

  // Ricerca con respiro: si chiede al database quando si smette di battere.
  const cerca = box.querySelector("#cli-cerca");
  let attesa;
  cerca.oninput = () => {
    clearTimeout(attesa);
    attesa = setTimeout(() => {
      if (!box.isConnected) return;
      vista.cerca = cerca.value.trim();
      vista.pagina = 1;
      selezionati.clear();
      aggiorna(box);
    }, 300);
  };

  box.querySelector("#cli-filtri").onclick = () => apriFiltri(box);
  box.querySelector("#cli-opzioni").onclick = () => apriOpzioni(box);
  box.querySelector("#cli-crea").onclick = () => apriContatto(box, null);
  box.querySelector("#cli-del-sel").onclick = () => {
    if (selezionati.size) confermaElimina(box, [...selezionati]);
  };

  agganciaCorpo(box);
}

// Gli handler di tabella e paginazione stanno a parte: aggiorna() riscrive
// solo quei pezzi e deve poterli riagganciare senza toccare la toolbar.
function agganciaCorpo(box) {
  box.querySelectorAll("[data-ordina]").forEach((t) => {
    t.onclick = () => {
      const campo = t.dataset.ordina;
      vista.ordine = {
        campo,
        verso: vista.ordine.campo === campo && vista.ordine.verso === "asc" ? "desc" : "asc",
      };
      vista.pagina = 1;
      aggiorna(box);
    };
  });

  const tutti = box.querySelector("#cli-tutti");
  if (tutti) tutti.onchange = () => {
    righe.forEach((c) => tutti.checked ? selezionati.add(c.id) : selezionati.delete(c.id));
    box.querySelectorAll(".cli-spunta").forEach((s) => { s.checked = tutti.checked; });
    aggiornaSelezione(box);
  };
  box.querySelectorAll(".cli-spunta").forEach((s) => {
    s.onchange = () => {
      s.checked ? selezionati.add(s.dataset.id) : selezionati.delete(s.dataset.id);
      aggiornaSelezione(box);
    };
  });

  box.querySelectorAll("[data-modifica]").forEach((b) => {
    b.onclick = () => {
      const c = righe.find((x) => x.id === b.dataset.modifica);
      if (c) apriContatto(box, c);
    };
  });
  box.querySelectorAll("[data-elimina]").forEach((b) => {
    b.onclick = () => {
      const c = righe.find((x) => x.id === b.dataset.elimina);
      if (c) confermaElimina(box, [c.id], `${c.nome} ${c.cognome || ""}`.trim());
    };
  });

  const azzera = box.querySelector("#cli-azzera");
  if (azzera) azzera.onclick = () => {
    vista.filtri = [];
    vista.segmento = null;
    vista.pagina = 1;
    selezionati.clear();
    aggiorna(box, { tutto: true });
  };

  const prec = box.querySelector("#cli-prec");
  const succ = box.querySelector("#cli-succ");
  if (prec) prec.onclick = () => { vista.pagina--; aggiorna(box); };
  if (succ) succ.onclick = () => { vista.pagina++; aggiorna(box); };
}

// Il bottone "Elimina selezionati" e la spunta di testata seguono la
// selezione senza ridisegnare la toolbar: l'input di ricerca non va toccato.
function aggiornaSelezione(box) {
  const b = box.querySelector("#cli-del-sel");
  if (b) {
    b.hidden = !selezionati.size;
    b.textContent = `Elimina selezionati (${selezionati.size})`;
  }
  const tutti = box.querySelector("#cli-tutti");
  if (tutti) tutti.checked = righe.length > 0 && righe.every((c) => selezionati.has(c.id));
}

// -------------------------------------------------------- crea / modifica

function apriContatto(box, cliente) {
  const { box: scheda, chiudi } = pannello();
  scheda.innerHTML = `
    <h2>${cliente ? "Modifica contatto" : "Crea contatto"}</h2>
    <div class="campo"><label for="cli-f-nome">Nome</label>
      <input id="cli-f-nome" value="${esc(cliente?.nome || "")}" autocomplete="off"></div>
    <div class="campo"><label for="cli-f-cognome">Cognome</label>
      <input id="cli-f-cognome" value="${esc(cliente?.cognome || "")}" autocomplete="off"></div>
    <div class="campo"><label for="cli-f-tel">Telefono</label>
      <input id="cli-f-tel" inputmode="tel" value="${esc(cliente?.telefono || "")}" autocomplete="off">
      <span class="sub small">Solo cifre con prefisso internazionale, es. 393331234567.</span></div>
    <div class="campo"><label for="cli-f-email">Email (facoltativa)</label>
      <input id="cli-f-email" type="email" value="${esc(cliente?.email || "")}" autocomplete="off"></div>
    <div id="cli-f-err"></div>
    <div class="scheda-azioni cli-azioni-scheda">
      <button class="btn-chiaro" id="cli-f-chiudi">Chiudi</button>
      <button class="btn" id="cli-f-salva">Salva</button>
    </div>`;
  const el = (id) => scheda.querySelector("#" + id);
  el("cli-f-chiudi").onclick = chiudi;

  el("cli-f-salva").onclick = async () => {
    const err = el("cli-f-err");
    err.innerHTML = "";
    const nome = el("cli-f-nome").value.trim();
    // Spazi, trattini, punti e parentesi si tolgono da soli: la titolare
    // incolla il numero come ce l'ha, non come lo vuole il database.
    const tel = el("cli-f-tel").value.replace(/[\s.\-()+/]/g, "");
    if (!nome) return void (err.innerHTML = erroreBox(ERRORI.nome_mancante));
    if (!tel) return void (err.innerHTML = erroreBox(ERRORI.telefono_mancante));
    if (!/^\d{6,15}$/.test(tel)) return void (err.innerHTML = erroreBox(ERRORI.telefono_non_valido));

    const salva = el("cli-f-salva");
    salva.disabled = true;
    salva.textContent = "Salvo…";
    const { data, error } = await sb.rpc("crm_clienti_salva", {
      p_centro: stato.centro.id,
      p_nome: nome,
      p_cognome: el("cli-f-cognome").value.trim() || null,
      p_telefono: tel,
      p_email: el("cli-f-email").value.trim() || null,
      p_id: cliente?.id ?? null,
    });
    if (error || !data?.ok) {
      err.innerHTML = erroreBox(testoErrore(data, error, "Non sono riuscito a salvare il contatto."));
      salva.disabled = false;
      salva.textContent = "Salva";
      return;
    }
    chiudi();
    aggiorna(box, { tutto: true });
  };

  el("cli-f-nome").focus();
}

// ------------------------------------------------------------- eliminazione

function confermaElimina(box, ids, etichetta) {
  const { box: scheda, chiudi } = pannello();
  scheda.innerHTML = `
    <h2>${ids.length === 1 ? "Eliminare questo contatto?" : `Eliminare ${ids.length} contatti?`}</h2>
    <p class="sub">${etichetta ? esc(etichetta) + ". " : ""}L'operazione non si può annullare.
      I contatti con appuntamenti in agenda o una conversazione WhatsApp non verranno eliminati.</p>
    <div id="cli-e-err"></div>
    <div class="scheda-azioni cli-azioni-scheda">
      <button class="btn-chiaro" id="cli-e-no">Annulla</button>
      <button class="btn pericolo" id="cli-e-si">Elimina</button>
    </div>`;
  const el = (id) => scheda.querySelector("#" + id);
  el("cli-e-no").onclick = chiudi;

  el("cli-e-si").onclick = async () => {
    const si = el("cli-e-si");
    si.disabled = true;
    si.textContent = "Elimino…";
    const { data, error } = await sb.rpc("crm_clienti_elimina", {
      p_centro: stato.centro.id, p_ids: ids,
    });
    if (error || !data?.ok) {
      el("cli-e-err").innerHTML = erroreBox(testoErrore(data, error, "Non sono riuscito a eliminare."));
      si.disabled = false;
      si.textContent = "Elimina";
      return;
    }
    ids.forEach((id) => selezionati.delete(id));
    chiudi();
    await aggiorna(box, { tutto: true });

    const bloccati = (data.bloccati || []).length;
    if (bloccati === ids.length) {
      mostraEsito(box, erroreBox(ids.length === 1
        ? "Impossibile eliminare: il contatto ha appuntamenti in agenda o una conversazione WhatsApp."
        : "Nessun contatto eliminato: hanno tutti appuntamenti in agenda o una conversazione WhatsApp."));
    } else if (bloccati) {
      mostraEsito(box, avvisoBox(
        `Eliminati ${data.eliminati}. ${bloccati} non eliminati: hanno appuntamenti o conversazioni.`));
    }
  };
}

function confermaEliminaSegmento(box, seg) {
  const { box: scheda, chiudi } = pannello();
  scheda.innerHTML = `
    <h2>Elimina lista</h2>
    <p class="sub">Eliminare la lista “${esc(seg.nome)}”? I contatti restano:
      sparisce solo il filtro salvato.</p>
    <div id="cli-ls-err"></div>
    <div class="scheda-azioni cli-azioni-scheda">
      <button class="btn-chiaro" id="cli-ls-no">Annulla</button>
      <button class="btn pericolo" id="cli-ls-si">Elimina</button>
    </div>`;
  const el = (id) => scheda.querySelector("#" + id);
  el("cli-ls-no").onclick = chiudi;

  el("cli-ls-si").onclick = async () => {
    const { data, error } = await sb.rpc("crm_segmenti_elimina", {
      p_centro: stato.centro.id, p_id: seg.id,
    });
    if (error || !data?.ok) {
      el("cli-ls-err").innerHTML = erroreBox(testoErrore(data, error, "Non sono riuscito a eliminare la lista."));
      return;
    }
    segmenti = segmenti.filter((s) => s.id !== seg.id);
    if (vista.segmento === seg.id) {
      vista.segmento = null;
      vista.filtri = [];
      vista.pagina = 1;
    }
    chiudi();
    aggiorna(box, { tutto: true });
  };
}

// ------------------------------------------------------------------- filtri

function apriFiltri(box) {
  const p = pannello();
  p.box.classList.add("scheda-larga");

  const rigaVuota = () => ({ campo: "nome", cond: "contiene", v1: "", v2: "" });
  const bozza = vista.filtri.length ? structuredClone(vista.filtri) : [rigaVuota()];

  const leggi = (r) => ({
    campo: r.querySelector(".cli-f-campo").value,
    cond: r.querySelector(".cli-f-cond").value,
    v1: r.querySelector(".cli-f-v1").value,
    v2: r.querySelector(".cli-f-v2")?.value ?? "",
  });
  // Righe incomplete non filtrano: si scartano senza fare rumore.
  const validi = () => bozza
    .map((f) => ({ campo: f.campo, cond: f.cond,
                   v1: String(f.v1 ?? "").trim(), v2: String(f.v2 ?? "").trim() }))
    .filter((f) => CAMPI[f.campo] && f.v1 !== "" && (f.cond !== "tra" || f.v2 !== ""));

  const htmlRiga = (f, i) => {
    const campo = CAMPI[f.campo] ? f.campo : "nome";
    const def = CAMPI[campo];
    const cond = def.cond.includes(f.cond) ? f.cond : def.cond[0];
    return `
      <div class="cli-filtro" data-i="${i}">
        <select class="cli-f-campo" aria-label="Campo">${Object.entries(CAMPI).map(([k, v]) =>
          `<option value="${k}" ${k === campo ? "selected" : ""}>${v.testo}</option>`).join("")}</select>
        <select class="cli-f-cond" aria-label="Condizione">${def.cond.map((c) =>
          `<option value="${c}" ${c === cond ? "selected" : ""}>${NOMI_COND[c]}</option>`).join("")}</select>
        <input class="cli-f-v1" type="${def.tipo}" value="${esc(f.v1 ?? "")}" aria-label="Valore">
        ${cond === "tra" ? `<span class="cli-f-e">e</span>
          <input class="cli-f-v2" type="${def.tipo}" value="${esc(f.v2 ?? "")}" aria-label="Secondo valore">` : ""}
        <button class="btn-mini cli-f-x" aria-label="Togli questo filtro">×</button>
      </div>`;
  };

  const disegnaModale = () => {
    p.box.innerHTML = `
      <h2>Filtri</h2>
      <p class="sub small">Le condizioni si sommano: un contatto compare se le rispetta tutte.</p>
      <div class="cli-fl-righe">${bozza.map(htmlRiga).join("")}</div>
      <button class="btn-mini" id="cli-fl-piu">+ Aggiungi filtro</button>
      <div id="cli-fl-err"></div>
      <div class="scheda-azioni cli-azioni-scheda">
        <button class="btn-chiaro" id="cli-fl-azzera">Azzera</button>
        <button class="btn-chiaro" id="cli-fl-salva">Salva segmento</button>
        <button class="btn" id="cli-fl-applica">Applica</button>
      </div>`;

    p.box.querySelectorAll(".cli-filtro").forEach((r) => {
      const i = Number(r.dataset.i);
      // Cambiando campo si riparte: condizioni e valori del campo di prima
      // non vogliono dire niente per quello nuovo.
      r.querySelector(".cli-f-campo").onchange = (e) => {
        bozza[i] = { campo: e.target.value, cond: CAMPI[e.target.value].cond[0], v1: "", v2: "" };
        disegnaModale();
      };
      // Cambiando condizione può comparire o sparire il secondo valore.
      r.querySelector(".cli-f-cond").onchange = () => {
        bozza[i] = leggi(r);
        disegnaModale();
      };
      r.querySelector(".cli-f-v1").oninput = (e) => { bozza[i].v1 = e.target.value; };
      const v2 = r.querySelector(".cli-f-v2");
      if (v2) v2.oninput = (e) => { bozza[i].v2 = e.target.value; };
      r.querySelector(".cli-f-x").onclick = () => {
        bozza.splice(i, 1);
        if (!bozza.length) bozza.push(rigaVuota());
        disegnaModale();
      };
    });

    p.box.querySelector("#cli-fl-piu").onclick = () => {
      bozza.push(rigaVuota());
      disegnaModale();
    };

    p.box.querySelector("#cli-fl-azzera").onclick = () => {
      vista.filtri = [];
      vista.segmento = null;
      vista.pagina = 1;
      selezionati.clear();
      p.chiudi();
      aggiorna(box, { tutto: true });
    };

    p.box.querySelector("#cli-fl-applica").onclick = () => {
      const nuovi = validi();
      vista.filtri = nuovi;
      vista.pagina = 1;
      selezionati.clear();
      // Se i filtri non sono più quelli della lista scelta, la lista non è
      // più quella: si torna su "Tutti i contatti" filtrati a mano.
      const attivo = segmenti.find((s) => s.id === vista.segmento);
      if (!attivo || JSON.stringify(attivo.filtri || []) !== JSON.stringify(nuovi)) {
        vista.segmento = null;
      }
      p.chiudi();
      aggiorna(box, { tutto: true });
    };

    p.box.querySelector("#cli-fl-salva").onclick = () => {
      const nuovi = validi();
      if (!nuovi.length) {
        p.box.querySelector("#cli-fl-err").innerHTML =
          erroreBox("Aggiungi almeno un filtro completo prima di salvare.");
        return;
      }
      apriSalvaSegmento(box, nuovi, p.chiudi);
    };
  };

  disegnaModale();
}

function apriSalvaSegmento(box, filtri, chiudiFiltri) {
  const { box: scheda, chiudi } = pannello();
  scheda.innerHTML = `
    <h2>Salva segmento</h2>
    <div class="campo"><label for="cli-s-nome">Nome segmento</label>
      <input id="cli-s-nome" maxlength="80" autocomplete="off"></div>
    <div id="cli-s-err"></div>
    <div class="scheda-azioni cli-azioni-scheda">
      <button class="btn-chiaro" id="cli-s-no">Annulla</button>
      <button class="btn" id="cli-s-si">Salva</button>
    </div>`;
  const el = (id) => scheda.querySelector("#" + id);
  el("cli-s-no").onclick = chiudi;

  el("cli-s-si").onclick = async () => {
    const nome = el("cli-s-nome").value.trim();
    if (!nome) {
      el("cli-s-err").innerHTML = erroreBox("Dai un nome al segmento.");
      return;
    }
    const { data, error } = await sb.rpc("crm_segmenti_salva", {
      p_centro: stato.centro.id, p_nome: nome, p_filtri: filtri,
    });
    if (error || !data?.ok) {
      el("cli-s-err").innerHTML = erroreBox(testoErrore(data, error, "Non sono riuscito a salvare il segmento."));
      return;
    }
    segmenti.push({ id: data.id, nome, filtri: structuredClone(filtri) });
    segmenti.sort((a, b) => a.nome.localeCompare(b.nome));
    vista.segmento = data.id;
    vista.filtri = structuredClone(filtri);
    vista.pagina = 1;
    selezionati.clear();
    chiudi();
    chiudiFiltri();
    aggiorna(box, { tutto: true });
  };

  el("cli-s-nome").focus();
}

// ------------------------------------------------------------------ opzioni

function apriOpzioni(box) {
  const { box: scheda, chiudi } = pannello();
  scheda.innerHTML = `
    <h2>Opzioni</h2>
    <button class="btn-wide btn-chiaro" id="cli-op-imp">Importa contatti (CSV)</button>
    <button class="btn-wide btn-chiaro" id="cli-op-exp">Esporta in CSV</button>
    <div id="cli-op-err"></div>`;
  scheda.querySelector("#cli-op-imp").onclick = () => {
    chiudi();
    apriImport(box);
  };
  scheda.querySelector("#cli-op-exp").onclick = async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Preparo…";
    const errore = await esportaCSV();
    if (errore) {
      e.target.disabled = false;
      e.target.textContent = "Esporta in CSV";
      scheda.querySelector("#cli-op-err").innerHTML = erroreBox(errore);
      return;
    }
    chiudi();
  };
}

// -------------------------------------------------------------------- export

// L'export rispetta ricerca e filtri del momento: quello che si vede è
// quello che si scarica. Punto e virgola e BOM perché il file deve aprirsi
// in colonne, con gli accenti giusti, nell'Excel italiano di una titolare.
async function esportaCSV() {
  const { data, error } = await chiediClienti({ pagina: 1, perPagina: 10000 });
  if (error || !data?.ok) return testoErrore(data, error, "Non sono riuscito a esportare.");

  const q = (v) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  const csv = "\uFEFF" + [
    ["nome", "cognome", "telefono", "email", "creato", "appuntamenti", "ultimo_appuntamento"],
    ...(data.clienti || []).map((c) =>
      [c.nome, c.cognome, c.telefono, c.email, c.creato, c.n_appuntamenti, c.ultimo_appuntamento]),
  ].map((r) => r.map(q).join(";")).join("\r\n");

  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv;charset=utf-8" }));
  const a = Object.assign(document.createElement("a"), { href: url, download: "clienti.csv" });
  a.click();
  URL.revokeObjectURL(url);
  return null;
}

// -------------------------------------------------------------------- import

function apriImport(box) {
  const { box: scheda, chiudi } = pannello();
  scheda.innerHTML = `
    <h2>Carica CSV</h2>
    <p class="sub">Scegli il file CSV con i contatti da importare. Colonne: nome, cognome,
      telefono, email — separate da virgola o punto e virgola, con o senza riga di
      intestazione. I numeri già in rubrica si saltano, niente viene sovrascritto.</p>
    <input type="file" id="cli-i-file" accept=".csv,text/csv">
    <div id="cli-i-anteprima"></div>
    <div id="cli-i-err"></div>
    <div class="scheda-azioni cli-azioni-scheda">
      <button class="btn-chiaro" id="cli-i-chiudi">Chiudi</button>
      <button class="btn" id="cli-i-vai" disabled>Importa contatti</button>
    </div>`;
  const el = (id) => scheda.querySelector("#" + id);
  el("cli-i-chiudi").onclick = chiudi;

  let valide = [];

  el("cli-i-file").onchange = async (e) => {
    el("cli-i-err").innerHTML = "";
    el("cli-i-anteprima").innerHTML = "";
    el("cli-i-vai").disabled = true;
    valide = [];
    const file = e.target.files?.[0];
    if (!file) return;

    let contatti;
    try {
      contatti = mappaRighe(analizzaCSV(await file.text()));
    } catch {
      el("cli-i-err").innerHTML = erroreBox("Carica un file CSV valido.");
      return;
    }
    valide = contatti.filter((c) => c.nome !== "" && /^\d{6,15}$/.test(c.telefono));
    const scartate = contatti.length - valide.length;
    if (!valide.length) {
      el("cli-i-err").innerHTML = erroreBox(contatti.length
        ? "Nessuna riga utilizzabile: serve almeno nome e un telefono di sole cifre."
        : "Il file è vuoto.");
      return;
    }
    el("cli-i-anteprima").innerHTML = avvisoBox(
      `${valide.length} contatti pronti` +
      (scartate ? `, ${scartate} righe scartate (senza nome o con telefono non valido)` : "") + ".");
    el("cli-i-vai").disabled = false;
  };

  el("cli-i-vai").onclick = async () => {
    const vai = el("cli-i-vai");
    vai.disabled = true;
    vai.textContent = "Importo…";
    el("cli-i-err").innerHTML = "";

    // A blocchi da 500: un file grosso non deve diventare una chiamata grossa.
    let importati = 0, saltati = 0;
    for (let i = 0; i < valide.length; i += 500) {
      const { data, error } = await sb.rpc("crm_clienti_importa", {
        p_centro: stato.centro.id, p_righe: valide.slice(i, i + 500),
      });
      if (error || !data?.ok) {
        el("cli-i-err").innerHTML = erroreBox("Importazione fallita! " +
          testoErrore(data, error, "Riprova."));
        vai.textContent = "Importa contatti";
        vai.disabled = false;
        return;
      }
      importati += data.importati;
      saltati += data.saltati;
      vai.textContent = `Importo… ${Math.min(i + 500, valide.length)}/${valide.length}`;
    }

    el("cli-i-anteprima").innerHTML = avvisoBox(
      `Importazione completata! ${importati} importati` +
      (saltati ? `, ${saltati} saltati (già presenti)` : "") + ".");
    vai.hidden = true;
    aggiorna(box, { tutto: true });
  };
}

// Un CSV non è "split sulla virgola": i campi possono stare fra virgolette,
// con dentro virgole, a capo e virgolette raddoppiate. Macchina a stati,
// niente librerie — come tutto il resto del sito.
function analizzaCSV(testo) {
  testo = testo.replace(/^\uFEFF/, "");    // il BOM che Excel mette in testa
  const sep = rilevaSeparatore(testo);
  const matrice = [];
  let campo = "", riga = [], traVirgolette = false;
  for (let i = 0; i < testo.length; i++) {
    const c = testo[i];
    if (traVirgolette) {
      if (c === '"' && testo[i + 1] === '"') { campo += '"'; i++; }
      else if (c === '"') traVirgolette = false;
      else campo += c;
    } else if (c === '"') traVirgolette = true;
    else if (c === sep) { riga.push(campo); campo = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && testo[i + 1] === "\n") i++;
      riga.push(campo);
      matrice.push(riga);
      campo = "";
      riga = [];
    } else campo += c;
  }
  if (campo !== "" || riga.length) { riga.push(campo); matrice.push(riga); }
  return matrice;
}

// Il separatore si conta sulla prima riga, fuori dalle virgolette: l'Excel
// italiano salva col punto e virgola, tutto il resto del mondo con la virgola.
function rilevaSeparatore(testo) {
  const fine = testo.indexOf("\n");
  const riga = fine < 0 ? testo : testo.slice(0, fine);
  let traVirgolette = false, virgole = 0, punti = 0;
  for (const c of riga) {
    if (c === '"') traVirgolette = !traVirgolette;
    else if (!traVirgolette && c === ",") virgole++;
    else if (!traVirgolette && c === ";") punti++;
  }
  return punti > virgole ? ";" : ",";
}

// Con la riga di intestazione le colonne si trovano per nome, in qualsiasi
// ordine; senza, si assume nome, cognome, telefono, email. "cognome" contiene
// "nome", quindi si cerca prima lui.
function mappaRighe(matrice) {
  const piene = matrice.filter((r) => r.some((c) => c && c.trim() !== ""));
  if (!piene.length) return [];

  let righe = piene;
  let idx = { nome: 0, cognome: 1, telefono: 2, email: 3 };

  const testa = piene[0].map((c) => c.toLowerCase().trim());
  const intestata = testa.some((c) =>
    c.includes("nome") || c.includes("telefono") || c.includes("phone") || c.includes("name"));
  if (intestata) {
    const iCognome = testa.findIndex((c) => c.includes("cognome") || c.includes("last"));
    idx = {
      cognome: iCognome,
      nome: testa.findIndex((c, i) => i !== iCognome &&
        (c.includes("nome") || c.includes("first") || c === "name")),
      telefono: testa.findIndex((c) =>
        c.includes("telefono") || c.includes("phone") || c.includes("cellulare") || c === "tel"),
      email: testa.findIndex((c) => c.includes("email") || c.includes("mail")),
    };
    righe = piene.slice(1);
  }

  const cella = (r, i) => (i >= 0 && r[i] != null ? String(r[i]).trim() : "");
  return righe.map((r) => ({
    nome: cella(r, idx.nome),
    cognome: cella(r, idx.cognome),
    telefono: cella(r, idx.telefono).replace(/\D/g, ""),
    email: cella(r, idx.email),
  }));
}
