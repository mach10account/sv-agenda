import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Stesso progetto dell'Academy: il centro entra una volta e trova corsi e agenda.
const SUPABASE_URL = "https://hypkwdvvrmakqrowbkqw.supabase.co";
const SUPABASE_KEY = "sb_publishable_y0_DEhM-bC37jEKkiC_GGQ_TaWvPqVe";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById("app");
const topbar = document.getElementById("topbar");

const SLOT_H = 46;                 // deve combaciare con --slot-h nel CSS
const PX_MIN = SLOT_H / 30;

let session = null;
let centro = null;        // il centro attualmente aperto
let vista = "giorno";     // giorno | settimana | mese
let giorno = oggi();      // data di riferimento, formato AAAA-MM-GG
let anagrafiche = null;   // cabine, operatrici, trattamenti del centro
let daSpostare = null;    // appuntamento in attesa di una nuova collocazione

// ------------------------------------------------------------------ utils

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Dichiarate come funzioni e non come costanti: servono gia' alla riga in cui
// si calcola la data di partenza, che sta piu' in alto di queste righe.
function iso(d) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

// Data locale, non UTC: toISOString() darebbe il giorno sbagliato la sera.
function oggi() { return iso(new Date()); }

const daIso = (s) => { const [a, m, g] = s.split("-").map(Number); return new Date(a, m - 1, g); };

const piuGiorni = (s, n) => { const d = daIso(s); d.setDate(d.getDate() + n); return iso(d); };
const piuMesi   = (s, n) => { const d = daIso(s); d.setDate(1); d.setMonth(d.getMonth() + n); return iso(d); };

// Lunedi della settimana che contiene la data: in Italia la settimana
// lavorativa comincia da li', non dalla domenica.
const lunedi = (s) => {
  const d = daIso(s);
  const scarto = (d.getDay() + 6) % 7;
  d.setDate(d.getDate() - scarto);
  return iso(d);
};

const primoDelMese = (s) => { const d = daIso(s); d.setDate(1); return iso(d); };

const fmt = (s, opz) => daIso(s).toLocaleDateString("it-IT", opz);
const minuti = (hhmm) => { const [h, m] = hhmm.split(":").map(Number); return h * 60 + m; };
const oraDaMinuti = (m) =>
  `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

// Colore di sfondo tenue a partire dal colore pieno del trattamento.
const tenue = (hex, alpha = .16) => {
  const h = (hex || "#6B4E9B").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, ${alpha})`;
};

// ------------------------------------------------------------------ login

function renderLogin(messaggio = "") {
  topbar.hidden = true;
  app.innerHTML = `
    <div class="login">
      <h1>SV Agenda</h1>
      <p class="sub">Accedi con le credenziali del tuo centro.</p>
      ${messaggio}
      <form id="f">
        <input id="email" type="email" required placeholder="email@centro.it" autocomplete="email">
        <input id="password" type="password" required placeholder="Password" autocomplete="current-password">
        <button class="btn btn-wide" type="submit">Entra</button>
      </form>
    </div>`;

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    btn.disabled = true;
    btn.textContent = "Accesso…";

    const { error } = await sb.auth.signInWithPassword({
      email: document.getElementById("email").value.trim(),
      password: document.getElementById("password").value,
    });

    if (error) {
      renderLogin(`<div class="notice">${
        /invalid login/i.test(error.message) ? "Email o password non corretti." : esc(error.message)
      }</div>`);
      return;
    }
    boot();
  });
}

// ------------------------------------------------------------ caricamento

async function caricaAgenda() {
  if (vista === "giorno")    return caricaGiorno();
  if (vista === "settimana") return caricaSettimana();
  return caricaMese();
}

const erroreSchermo = (msg) =>
  app.innerHTML = `${barra()}<div class="notice" style="margin:20px">${esc(msg)}</div>`;

async function caricaGiorno() {
  const { data, error } = await sb.rpc("crm_agenda_giorno",
    { p_centro: centro.id, p_giorno: giorno });
  if (error) return erroreSchermo(error.message);
  if (!data?.ok) return erroreSchermo(data?.errore || "Agenda non disponibile");
  disegnaGiorno(data);
}

async function caricaSettimana() {
  const da = lunedi(giorno);
  const { data, error } = await sb.rpc("crm_agenda_periodo",
    { p_centro: centro.id, p_da: da, p_a: piuGiorni(da, 6) });
  if (error) return erroreSchermo(error.message);
  if (!data?.ok) return erroreSchermo(data?.errore || "Agenda non disponibile");
  disegnaSettimana(data, da);
}

async function caricaMese() {
  const { data, error } = await sb.rpc("crm_agenda_mese",
    { p_centro: centro.id, p_mese: primoDelMese(giorno) });
  if (error) return erroreSchermo(error.message);
  if (!data?.ok) return erroreSchermo(data?.errore || "Agenda non disponibile");
  disegnaMese(data);
}

// -------------------------------------------------------- barra superiore

function etichettaPeriodo() {
  if (vista === "giorno")
    return fmt(giorno, { weekday: "long", day: "numeric", month: "long" });

  if (vista === "settimana") {
    const da = lunedi(giorno), a = piuGiorni(da, 6);
    const stessoMese = daIso(da).getMonth() === daIso(a).getMonth();
    return stessoMese
      ? `${fmt(da, { day: "numeric" })} – ${fmt(a, { day: "numeric", month: "long" })}`
      : `${fmt(da, { day: "numeric", month: "short" })} – ${fmt(a, { day: "numeric", month: "short" })}`;
  }
  return fmt(giorno, { month: "long", year: "numeric" });
}

function barra(conteggio = "") {
  return `
    <div class="giorno-bar">
      <button class="nav-btn" id="prec" title="Indietro">‹</button>
      <button class="nav-btn" id="succ" title="Avanti">›</button>
      <button class="oggi-btn" id="oggi">Oggi</button>
      <h1>${esc(etichettaPeriodo())}</h1>
      <span class="conteggio">${esc(conteggio)}</span>
      <div class="spazio"></div>
      <div class="viste">
        ${["giorno", "settimana", "mese"].map((v) =>
          `<button class="vista ${vista === v ? "attiva" : ""}" data-vista="${v}">${
            v[0].toUpperCase() + v.slice(1)}</button>`).join("")}
      </div>
    </div>`;
}

function agganciaBarra() {
  const passo = { giorno: 1, settimana: 7, mese: 0 };
  document.getElementById("prec").onclick = () => {
    giorno = vista === "mese" ? piuMesi(giorno, -1) : piuGiorni(giorno, -passo[vista]);
    caricaAgenda();
  };
  document.getElementById("succ").onclick = () => {
    giorno = vista === "mese" ? piuMesi(giorno, 1) : piuGiorni(giorno, passo[vista]);
    caricaAgenda();
  };
  document.getElementById("oggi").onclick = () => { giorno = oggi(); caricaAgenda(); };

  document.querySelectorAll(".vista").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.vista === vista) return;
      vista = b.dataset.vista;
      daSpostare = null;
      document.body.classList.remove("in-spostamento");
      caricaAgenda();
    };
  });
}

// Toglie la barra dello spostamento: vive fuori dalla griglia, quindi
// ridisegnare non la fa sparire da sola.
function gestisciBarraSpostamento() {
  document.querySelector(".barra-spostamento")?.remove();
  if (!daSpostare) { document.body.classList.remove("in-spostamento"); return; }

  document.body.classList.add("in-spostamento");
  const b = document.createElement("div");
  b.className = "barra-spostamento";
  b.innerHTML = `Tocca dove spostare <strong>${esc(daSpostare.cliente)}</strong>
                 <button class="annulla-spost">Annulla</button>`;
  b.querySelector(".annulla-spost").onclick = () => {
    daSpostare = null;
    caricaAgenda();
  };
  document.body.appendChild(b);
}

// ------------------------------------------------------------ vista giorno

function disegnaGiorno(dati) {
  const apertura = minuti(dati.centro.apertura);
  const chiusura = minuti(dati.centro.chiusura);
  const altezza = (chiusura - apertura) * PX_MIN;

  let ore = "";
  for (let m = apertura; m < chiusura; m += 30) {
    ore += `<div class="ora ${m % 60 === 30 ? "mezza" : ""}">${oraDaMinuti(m)}</div>`;
  }

  const perCabina = new Map(dati.cabine.map((c) => [c.id, []]));
  for (const a of dati.appuntamenti) perCabina.get(a.cabina_id)?.push(a);

  const colonne = dati.cabine.map((cab) => {
    const blocchi = (perCabina.get(cab.id) || []).map((a) =>
      bloccoHtml(a, (minuti(a.inizio) - apertura) * PX_MIN, a.durata * PX_MIN, 0, 1)).join("");
    return `<div class="colonna" style="height:${altezza}px">${blocchi}</div>`;
  }).join("");

  const n = dati.cabine.length;
  const css = `grid-template-columns: 62px repeat(${n}, minmax(170px, 1fr))`;
  const q = dati.appuntamenti.length;

  app.innerHTML = `
    ${barra(`${q} ${q === 1 ? "appuntamento" : "appuntamenti"}`)}
    <div class="griglia-wrap">
      ${n === 0
        ? `<div class="vuoto">Nessuna cabina configurata per questo centro.</div>`
        : `<div class="intestazioni" style="${css}">
             <div class="testa ore"></div>
             ${dati.cabine.map((c) => `<div class="testa">${esc(c.nome)}</div>`).join("")}
           </div>
           <div class="griglia" style="${css}">
             <div class="colonna-ore">${ore}</div>
             ${colonne}
           </div>`}
    </div>`;

  agganciaBarra();
  agganciaBlocchi(dati.appuntamenti);

  app.querySelectorAll(".colonna").forEach((col, i) => {
    col.onclick = (e) => {
      const ora = oraDalClick(e, col, apertura, chiusura);
      if (daSpostare) return concludiSpostamento(dati.cabine[i].id, ora, giorno);
      apriNuovo(dati.cabine[i].id, ora, giorno);
    };
  });

  gestisciBarraSpostamento();
}

// --------------------------------------------------------- vista settimana

function disegnaSettimana(dati, da) {
  const apertura = minuti(dati.centro.apertura);
  const chiusura = minuti(dati.centro.chiusura);
  const altezza = (chiusura - apertura) * PX_MIN;
  const giorni = Array.from({ length: 7 }, (_, i) => piuGiorni(da, i));

  let ore = "";
  for (let m = apertura; m < chiusura; m += 30) {
    ore += `<div class="ora ${m % 60 === 30 ? "mezza" : ""}">${oraDaMinuti(m)}</div>`;
  }

  const perGiorno = new Map(giorni.map((g) => [g, []]));
  for (const a of dati.appuntamenti) perGiorno.get(a.giorno)?.push(a);

  const colonne = giorni.map((g) => {
    const lista = (perGiorno.get(g) || []).sort((x, y) => minuti(x.inizio) - minuti(y.inizio));
    assegnaCorsie(lista);
    const blocchi = lista.map((a) =>
      bloccoHtml(a, (minuti(a.inizio) - apertura) * PX_MIN, a.durata * PX_MIN,
                 a._corsia, a._corsie, true)).join("");
    return `<div class="colonna ${g === oggi() ? "oggi" : ""}" data-giorno="${g}"
                 style="height:${altezza}px">${blocchi}</div>`;
  }).join("");

  const teste = giorni.map((g) => `
    <div class="testa ${g === oggi() ? "oggi" : ""}">
      <span class="gg">${fmt(g, { weekday: "short" })}</span>
      <span class="nn">${daIso(g).getDate()}</span>
    </div>`).join("");

  const css = `grid-template-columns: 62px repeat(7, minmax(120px, 1fr))`;
  const q = dati.appuntamenti.length;

  app.innerHTML = `
    ${barra(`${q} ${q === 1 ? "appuntamento" : "appuntamenti"}`)}
    <div class="griglia-wrap">
      <div class="intestazioni" style="${css}">
        <div class="testa ore"></div>
        ${teste}
      </div>
      <div class="griglia" style="${css}">
        <div class="colonna-ore">${ore}</div>
        ${colonne}
      </div>
    </div>`;

  agganciaBarra();
  agganciaBlocchi(dati.appuntamenti);

  // Nella settimana la cabina non e' data dalla colonna: si apre il pannello
  // con la prima cabina, e chi prenota la cambia se serve.
  app.querySelectorAll(".colonna").forEach((col) => {
    col.onclick = (e) => {
      const ora = oraDalClick(e, col, apertura, chiusura);
      const g = col.dataset.giorno;
      if (daSpostare) return concludiSpostamento(daSpostare.cabina_id, ora, g);
      apriNuovo(anagrafiche.cabine[0]?.id, ora, g);
    };
  });

  gestisciBarraSpostamento();
}

// Quando piu' appuntamenti si accavallano nello stesso giorno, si dividono la
// larghezza della colonna invece di coprirsi a vicenda.
function assegnaCorsie(lista) {
  let gruppo = [], finePiuAvanti = -1;

  const chiudi = () => {
    if (!gruppo.length) return;
    const corsie = [];
    for (const a of gruppo) {
      const ini = minuti(a.inizio), fin = ini + a.durata;
      let i = corsie.findIndex((f) => f <= ini);
      if (i === -1) { corsie.push(fin); i = corsie.length - 1; } else corsie[i] = fin;
      a._corsia = i;
    }
    for (const a of gruppo) a._corsie = corsie.length;
    gruppo = [];
  };

  for (const a of lista) {
    const ini = minuti(a.inizio);
    if (gruppo.length && ini >= finePiuAvanti) { chiudi(); finePiuAvanti = -1; }
    gruppo.push(a);
    finePiuAvanti = Math.max(finePiuAvanti, ini + a.durata);
  }
  chiudi();
}

// ------------------------------------------------------------- vista mese

function disegnaMese(dati) {
  const primo = primoDelMese(giorno);
  const inizioGriglia = lunedi(primo);
  const meseCorrente = daIso(primo).getMonth();
  const celle = [];

  for (let i = 0; i < 42; i++) {
    const g = piuGiorni(inizioGriglia, i);
    const d = daIso(g);
    if (i >= 35 && d.getMonth() !== meseCorrente) break;   // sesta riga solo se serve

    const info = dati.giorni[g];
    const fuori = d.getMonth() !== meseCorrente;
    const ore = info ? Math.round(info.minuti / 6) / 10 : 0;

    celle.push(`
      <button class="cella ${fuori ? "fuori" : ""} ${g === oggi() ? "oggi" : ""}"
              data-giorno="${g}" ${info ? "" : "data-vuoto=1"}>
        <span class="num">${d.getDate()}</span>
        ${info ? `
          <span class="tot">${info.totale}</span>
          <span class="ore">${ore} h</span>
          ${info.da_confermare > 0
            ? `<span class="pallino" title="${info.da_confermare} da confermare"></span>` : ""}
        ` : ""}
      </button>`);
  }

  const totale = Object.values(dati.giorni).reduce((s, d) => s + d.totale, 0);

  app.innerHTML = `
    ${barra(`${totale} nel mese`)}
    <div class="mese-wrap">
      <div class="mese-teste">
        ${["lun", "mar", "mer", "gio", "ven", "sab", "dom"]
          .map((g) => `<div>${g}</div>`).join("")}
      </div>
      <div class="mese">${celle.join("")}</div>
      <p class="legenda">Tocca un giorno per aprirlo. Il pallino segnala gli appuntamenti
         ancora da confermare.</p>
    </div>`;

  agganciaBarra();

  app.querySelectorAll(".cella").forEach((c) => {
    c.onclick = () => { giorno = c.dataset.giorno; vista = "giorno"; caricaAgenda(); };
  });
}

// -------------------------------------------------------- pezzi condivisi

function bloccoHtml(a, top, altezza, corsia, corsie, compatto = false) {
  const h = Math.max(altezza - 2, 20);
  const largh = 100 / corsie;
  const stile = `top:${top}px;height:${h}px;left:calc(${corsia * largh}% + 3px);` +
                `width:calc(${largh}% - 6px);` +
                `background:${tenue(a.colore)};border-left-color:${esc(a.colore)}`;

  // Nella settimana le colonne sono strette e si dividono ulteriormente quando
  // gli appuntamenti si accavallano: su una riga sola il nome sparirebbe dietro
  // i puntini. Meglio ora sopra e cliente sotto.
  if (compatto) {
    // Sotto i 40 pixel non ci stanno due righe: si tiene il nome e si lascia
    // cadere l'ora, che la posizione nella griglia gia' racconta.
    if (h < 40) {
      return `
        <div class="appuntamento compatto minimo ${esc(a.stato)}" data-id="${esc(a.id)}" style="${stile}">
          <div class="c">${esc(a.cliente)}</div>
        </div>`;
    }
    return `
      <div class="appuntamento compatto ${esc(a.stato)}" data-id="${esc(a.id)}" style="${stile}">
        <div class="h">${esc(a.inizio)}</div>
        <div class="c">${esc(a.cliente)}</div>
        ${h >= 66 ? `<div class="t">${esc(a.trattamento)}</div>` : ""}
      </div>`;
  }

  return `
    <div class="appuntamento ${esc(a.stato)}" data-id="${esc(a.id)}" style="${stile}">
      <div class="h">${esc(a.inizio)}<span class="c"> · ${esc(a.cliente)}</span></div>
      ${h < 44 ? "" : `<div class="t">${esc(a.trattamento)}${
        a.operatore ? " · " + esc(a.operatore) : ""}</div>`}
    </div>`;
}

function agganciaBlocchi(lista) {
  app.querySelectorAll(".appuntamento").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();          // altrimenti scatta anche il click sulla colonna
      if (daSpostare) return;
      mostraScheda(lista.find((a) => a.id === el.dataset.id));
    };
  });
}

function oraDalClick(e, col, apertura, chiusura) {
  // Il bordo della colonna cade spesso a meta' pixel mentre la posizione del
  // click e' intera: senza tolleranza si perde mezzo pixel e il click sulla
  // riga delle 10:00 finirebbe per proporre le 09:45.
  const y = Math.max(0, e.clientY - col.getBoundingClientRect().top + 1);
  // Tagli da 15 minuti: la griglia mostra le mezz'ore, ma i centri lavorano
  // spesso su quarti d'ora.
  const grezzo = apertura + Math.floor(y / PX_MIN / 15) * 15;
  return oraDaMinuti(Math.min(Math.max(grezzo, apertura), chiusura - 15));
}

// ------------------------------------------------------------- pannelli

function pannello() {
  const velo = document.createElement("div");
  velo.className = "velo";
  velo.innerHTML = `<div class="scheda"></div>`;
  velo.onclick = (e) => { if (e.target === velo) velo.remove(); };
  document.body.appendChild(velo);
  return { velo, box: velo.querySelector(".scheda"), chiudi: () => velo.remove() };
}

const erroreBox = (msg) => `<div class="notice">${esc(msg)}</div>`;

const STATI = {
  prenotato: "Prenotato",
  confermato: "Confermato",
  presentato: "Presentato",
  non_presentato: "Non presentato",
  annullato: "Annullato",
};

function apriNuovo(cabinaId, ora, dataIso) {
  if (!anagrafiche?.trattamenti?.length) {
    const { box, chiudi } = pannello();
    box.innerHTML = `<h2>Manca il listino</h2>
      <p class="quando">Per prenotare serve almeno un trattamento configurato.</p>
      <button class="btn btn-wide chiudi">Ho capito</button>`;
    box.querySelector(".chiudi").onclick = chiudi;
    return;
  }

  const { box, chiudi } = pannello();
  let clienteScelto = null;

  box.innerHTML = `
    <h2>Nuovo appuntamento</h2>
    <p class="quando">${esc(fmt(dataIso, { weekday: "long", day: "numeric", month: "long" }))} · ore ${esc(ora)}</p>
    <div id="errore"></div>

    <label>Cliente</label>
    <input id="qcliente" type="text" placeholder="Cerca per nome o telefono" autocomplete="off">
    <div id="risultati" class="risultati"></div>
    <div id="nuovocliente" hidden>
      <div class="riga">
        <input id="cnome" placeholder="Nome" autocomplete="off">
        <input id="ccognome" placeholder="Cognome" autocomplete="off">
      </div>
      <input id="ctelefono" placeholder="Telefono" inputmode="tel" autocomplete="off">
    </div>

    <label>Trattamento</label>
    <select id="trattamento">
      ${anagrafiche.trattamenti.map((t) =>
        `<option value="${esc(t.id)}">${esc(t.nome)} · ${t.durata} min</option>`).join("")}
    </select>

    <div class="riga">
      <div>
        <label>Cabina</label>
        <select id="cabina">
          ${anagrafiche.cabine.map((c) =>
            `<option value="${esc(c.id)}" ${c.id === cabinaId ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Ora</label>
        <input id="ora" type="time" value="${esc(ora)}" step="900">
      </div>
    </div>

    <label>Operatrice <span class="opz">(facoltativa)</span></label>
    <select id="operatore">
      <option value="">—</option>
      ${anagrafiche.operatori.map((o) => `<option value="${esc(o.id)}">${esc(o.nome)}</option>`).join("")}
    </select>

    <label>Note <span class="opz">(facoltative)</span></label>
    <textarea id="note" rows="2"></textarea>

    <div class="azioni">
      <button class="btn btn-chiaro" id="annulla">Annulla</button>
      <button class="btn" id="salva">Salva</button>
    </div>`;

  const q = box.querySelector("#qcliente");
  const risultati = box.querySelector("#risultati");
  const nuovo = box.querySelector("#nuovocliente");

  const mostraNuovo = (testo) => {
    clienteScelto = null;
    nuovo.hidden = false;
    risultati.innerHTML = "";
    const pezzi = testo.trim().split(/\s+/);
    box.querySelector("#cnome").value = pezzi[0] || "";
    box.querySelector("#ccognome").value = pezzi.slice(1).join(" ");
  };

  let attesa;
  q.oninput = () => {
    clearTimeout(attesa);
    const testo = q.value.trim();
    clienteScelto = null;
    nuovo.hidden = true;
    if (testo.length < 2) { risultati.innerHTML = ""; return; }

    attesa = setTimeout(async () => {
      const { data: trovati } = await sb.rpc("crm_cerca_cliente",
        { p_centro: centro.id, p_query: testo });
      risultati.innerHTML = (trovati || []).map((c) => `
        <button class="ris" data-id="${esc(c.id)}">
          ${esc(c.nome)} ${esc(c.cognome || "")}
          ${c.telefono ? `<span class="tel">${esc(c.telefono)}</span>` : ""}
        </button>`).join("") +
        `<button class="ris nuovo">+ Nuovo cliente “${esc(testo)}”</button>`;

      risultati.querySelectorAll(".ris").forEach((b) => {
        b.onclick = () => {
          if (b.classList.contains("nuovo")) return mostraNuovo(testo);
          clienteScelto = b.dataset.id;
          q.value = b.textContent.trim().split("\n")[0].trim();
          risultati.innerHTML = "";
          nuovo.hidden = true;
        };
      });
    }, 250);
  };

  box.querySelector("#annulla").onclick = chiudi;

  box.querySelector("#salva").onclick = async (e) => {
    const btn = e.target;
    const err = box.querySelector("#errore");
    err.innerHTML = "";
    btn.disabled = true;
    btn.textContent = "Salvo…";

    let clienteId = clienteScelto;

    // Cliente nuovo: prima si crea l'anagrafica, poi l'appuntamento.
    if (!clienteId) {
      const nome = box.querySelector("#cnome").value.trim();
      if (!nome) {
        err.innerHTML = erroreBox("Scegli un cliente dall'elenco oppure creane uno nuovo.");
        btn.disabled = false; btn.textContent = "Salva";
        return;
      }
      const { data: cli } = await sb.rpc("crm_salva_cliente", {
        p_centro: centro.id, p_nome: nome,
        p_cognome: box.querySelector("#ccognome").value.trim() || null,
        p_telefono: box.querySelector("#ctelefono").value.trim() || null,
      });
      if (!cli?.ok) {
        err.innerHTML = erroreBox(cli?.errore || "Non sono riuscito a salvare il cliente.");
        btn.disabled = false; btn.textContent = "Salva";
        return;
      }
      clienteId = cli.id;
    }

    const { data, error } = await sb.rpc("crm_salva_appuntamento_locale", {
      p_centro: centro.id,
      p_cliente: clienteId,
      p_trattamento: box.querySelector("#trattamento").value,
      p_cabina: box.querySelector("#cabina").value,
      p_giorno: dataIso,
      p_ora: box.querySelector("#ora").value,
      p_operatore: box.querySelector("#operatore").value || null,
      p_note: box.querySelector("#note").value.trim() || null,
    });

    if (error || !data?.ok) {
      // Qui compare "Cabina 1 è già occupata dalle 10:00 alle 11:00".
      err.innerHTML = erroreBox(data?.errore || error?.message || "Non sono riuscito a salvare.");
      btn.disabled = false;
      btn.textContent = "Salva";
      return;
    }

    chiudi();
    caricaAgenda();
  };

  q.focus();
}

function mostraScheda(a) {
  if (!a) return;
  const { box, chiudi } = pannello();

  box.innerHTML = `
    <h2>${esc(a.cliente)}</h2>
    <p class="quando">${a.giorno ? esc(fmt(a.giorno, { weekday: "long", day: "numeric", month: "long" })) + " · " : ""}${esc(a.inizio)}–${esc(a.fine)} · ${esc(a.trattamento)}</p>
    <div id="errore"></div>
    <dl>
      <dt>Stato</dt><dd>${esc(STATI[a.stato] || a.stato)}</dd>
      ${a.cabina ? `<dt>Cabina</dt><dd>${esc(a.cabina)}</dd>` : ""}
      ${a.operatore ? `<dt>Operatrice</dt><dd>${esc(a.operatore)}</dd>` : ""}
      ${a.telefono ? `<dt>Telefono</dt><dd><a href="tel:${esc(a.telefono)}">${esc(a.telefono)}</a></dd>` : ""}
      <dt>Durata</dt><dd>${a.durata} minuti</dd>
      ${a.note ? `<dt>Note</dt><dd>${esc(a.note)}</dd>` : ""}
    </dl>

    <label>Cambia stato</label>
    <div class="stati">
      ${["confermato", "presentato", "non_presentato"].map((s) =>
        `<button class="stato ${a.stato === s ? "attivo" : ""}" data-stato="${s}">${STATI[s]}</button>`).join("")}
    </div>

    <div class="azioni">
      <button class="btn btn-chiaro" id="sposta">Sposta</button>
      <button class="btn btn-chiaro pericolo" id="annullaApp">Annulla appuntamento</button>
    </div>
    <button class="btn btn-wide chiudi">Chiudi</button>`;

  const err = box.querySelector("#errore");

  box.querySelectorAll(".stato").forEach((b) => {
    b.onclick = async () => {
      const { data } = await sb.rpc("crm_cambia_stato", { p_id: a.id, p_stato: b.dataset.stato });
      if (!data?.ok) { err.innerHTML = erroreBox(data?.errore || "Non riesco a cambiare lo stato."); return; }
      chiudi();
      caricaAgenda();
    };
  });

  box.querySelector("#sposta").onclick = () => {
    daSpostare = a;
    // Lo spostamento ha senso sulla vista giorno, dove le colonne sono le
    // cabine: da settimana o mese ci si porta prima sul giorno giusto.
    if (vista !== "giorno") { vista = "giorno"; if (a.giorno) giorno = a.giorno; }
    chiudi();
    caricaAgenda();
  };

  box.querySelector("#annullaApp").onclick = async () => {
    const { data } = await sb.rpc("crm_cambia_stato", { p_id: a.id, p_stato: "annullato" });
    if (!data?.ok) { err.innerHTML = erroreBox(data?.errore || "Non riesco ad annullare."); return; }
    chiudi();
    caricaAgenda();
  };

  box.querySelector(".chiudi").onclick = chiudi;
}

async function concludiSpostamento(cabinaId, ora, data) {
  const a = daSpostare;
  const { data: esito } = await sb.rpc("crm_sposta_appuntamento_locale", {
    p_id: a.id, p_giorno: data, p_ora: ora, p_cabina: cabinaId,
  });

  daSpostare = null;

  if (!esito?.ok) {
    await caricaAgenda();
    const { box, chiudi } = pannello();
    box.innerHTML = `<h2>Non si può spostare lì</h2>
      ${erroreBox(esito?.errore || "Spostamento non riuscito.")}
      <button class="btn btn-wide chiudi">Ho capito</button>`;
    box.querySelector(".chiudi").onclick = chiudi;
    return;
  }
  caricaAgenda();
}

// ------------------------------------------------------------------- boot

async function boot() {
  const { data } = await sb.auth.getSession();
  session = data.session;

  if (!session) return renderLogin();

  const { data: centri, error } = await sb.rpc("crm_miei_centri");
  if (error) return erroreSchermo(error.message);

  topbar.hidden = false;
  document.getElementById("who").textContent = session.user.email;

  if (!centri || centri.length === 0) {
    app.innerHTML = `<div class="vuoto">Il tuo accesso non è collegato a nessun centro.<br>
                     Scrivi al tuo consulente.</div>`;
    return;
  }

  centro = centri[0];   // con piu' centri, in futuro qui va un selettore
  document.getElementById("centro").textContent = centro.nome;

  // Cabine, operatrici e trattamenti cambiano di rado: si caricano una volta.
  const { data: anag } = await sb.rpc("crm_anagrafiche", { p_centro: centro.id });
  anagrafiche = anag || { cabine: [], operatori: [], trattamenti: [] };

  caricaAgenda();
}

document.getElementById("logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

boot();
