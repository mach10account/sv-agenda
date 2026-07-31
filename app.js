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
let raggruppa = "operatrici";  // colonne della vista giorno: operatrici | cabine
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

// Striscia dei giorni: una settimana indietro e due avanti attorno al giorno
// scelto. In un centro si ragiona per giorni vicini, non per date astratte.
function strisciaGiorni() {
  const celle = [];
  for (let i = -7; i <= 14; i++) {
    const g = piuGiorni(giorno, i);
    const d = daIso(g);
    const festivo = d.getDay() === 0;
    celle.push(`
      <button class="gday ${g === giorno ? "scelto" : ""} ${g === oggi() ? "oggi" : ""}
                     ${festivo ? "festivo" : ""}" data-giorno="${g}">
        <span class="gg">${fmt(g, { weekday: "short" })}</span>
        <span class="nn">${d.getDate()}</span>
      </button>`);
  }
  return `<div class="striscia" id="striscia">${celle.join("")}</div>`;
}

function barra(conteggio = "") {
  const soloGiorno = vista === "giorno";

  return `
    <div class="testata">
      <div class="riga-alta">
        <div class="cerca-box">
          <input id="cerca" type="search" placeholder="Cerca appuntamenti" autocomplete="off">
          <div id="cerca-esiti" class="cerca-esiti"></div>
        </div>
        <div class="viste">
          ${["giorno", "settimana", "mese"].map((v) =>
            `<button class="vista ${vista === v ? "attiva" : ""}" data-vista="${v}">${
              v[0].toUpperCase() + v.slice(1)}</button>`).join("")}
        </div>
        <button class="btn aggiungi" id="aggiungi">+ Aggiungi</button>
      </div>

      <div class="riga-bassa">
        <div class="titolo">
          <span class="anno">${daIso(giorno).getFullYear()}</span>
          <button class="data-grande" id="apriData">
            ${esc(soloGiorno ? fmt(giorno, { day: "numeric", month: "long" }) : etichettaPeriodo())}
            <span class="freccia">⌄</span>
          </button>
          <div id="calendario" class="calendario" hidden></div>
          ${conteggio ? `<span class="conteggio">${esc(conteggio)}</span>` : ""}
        </div>

        ${soloGiorno ? strisciaGiorni() : `
          <div class="nav-periodo">
            <button class="nav-btn" id="prec" title="Indietro">‹</button>
            <button class="oggi-btn" id="oggi">Oggi</button>
            <button class="nav-btn" id="succ" title="Avanti">›</button>
          </div>`}

        ${soloGiorno ? `
          <div class="raggruppa">
            ${[["operatrici", "Operatrici"], ["cabine", "Cabine"]].map(([k, e]) =>
              `<button class="rg ${raggruppa === k ? "attiva" : ""}" data-rg="${k}">${e}</button>`).join("")}
          </div>` : ""}
      </div>
    </div>`;
}

function agganciaBarra() {
  const passo = { settimana: 7, mese: 0 };

  document.getElementById("prec")?.addEventListener("click", () => {
    giorno = vista === "mese" ? piuMesi(giorno, -1) : piuGiorni(giorno, -passo[vista]);
    caricaAgenda();
  });
  document.getElementById("succ")?.addEventListener("click", () => {
    giorno = vista === "mese" ? piuMesi(giorno, 1) : piuGiorni(giorno, passo[vista]);
    caricaAgenda();
  });
  document.getElementById("oggi")?.addEventListener("click", () => { giorno = oggi(); caricaAgenda(); });

  // Striscia dei giorni
  document.querySelectorAll(".gday").forEach((b) => {
    b.onclick = () => { giorno = b.dataset.giorno; caricaAgenda(); };
  });

  // Il giorno scelto deve restare visibile anche quando la striscia scorre.
  const scelto = document.querySelector(".gday.scelto");
  scelto?.scrollIntoView({ block: "nearest", inline: "center" });

  agganciaCalendario();

  document.querySelectorAll(".vista").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.vista === vista) return;
      vista = b.dataset.vista;
      daSpostare = null;
      document.body.classList.remove("in-spostamento");
      caricaAgenda();
    };
  });

  document.querySelectorAll(".rg").forEach((b) => {
    b.onclick = () => {
      if (b.dataset.rg === raggruppa) return;
      raggruppa = b.dataset.rg;
      caricaAgenda();
    };
  });

  document.getElementById("aggiungi")?.addEventListener("click", () => {
    // Senza uno slot preciso si parte dall'apertura del centro.
    apriNuovo(anagrafiche.cabine[0]?.id, "09:00", vista === "giorno" ? giorno : oggi());
  });

  // Le intestazioni delle colonne devono fermarsi sotto la testata, che cambia
  // altezza a seconda della vista: la si misura invece di indovinarla.
  const t = document.querySelector(".testata");
  if (t) {
    document.documentElement.style.setProperty(
      "--testata-h", `${Math.round(t.getBoundingClientRect().height + 54)}px`);
  }

  agganciaRicerca();
}

// Calendario a tendina: si disegna qui invece di usare quello di sistema, che
// su desktop e mobile ha aspetti diversi e non si puo' allineare al resto.
function agganciaCalendario() {
  const bottone = document.getElementById("apriData");
  const box = document.getElementById("calendario");
  if (!bottone || !box) return;

  let meseAperto = primoDelMese(giorno);

  const disegna = () => {
    const primo = daIso(meseAperto);
    const inizio = lunedi(meseAperto);
    const celle = [];

    for (let i = 0; i < 42; i++) {
      const g = piuGiorni(inizio, i);
      const d = daIso(g);
      if (i >= 35 && d.getMonth() !== primo.getMonth()) break;
      celle.push(`
        <button class="cg ${d.getMonth() !== primo.getMonth() ? "fuori" : ""}
                       ${g === giorno ? "scelto" : ""} ${g === oggi() ? "oggi" : ""}"
                data-giorno="${g}">${d.getDate()}</button>`);
    }

    box.innerHTML = `
      <div class="cal-testa">
        <button class="cal-nav" data-passo="-1">‹</button>
        <span>${esc(fmt(meseAperto, { month: "long", year: "numeric" }))}</span>
        <button class="cal-nav" data-passo="1">›</button>
      </div>
      <div class="cal-gg">${["lun","mar","mer","gio","ven","sab","dom"]
        .map((g) => `<span>${g}</span>`).join("")}</div>
      <div class="cal-griglia">${celle.join("")}</div>`;

    box.querySelectorAll(".cal-nav").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        meseAperto = piuMesi(meseAperto, Number(b.dataset.passo));
        disegna();
      };
    });

    box.querySelectorAll(".cg").forEach((b) => {
      b.onclick = (e) => {
        e.stopPropagation();
        giorno = b.dataset.giorno;
        box.hidden = true;
        caricaAgenda();
      };
    });
  };

  bottone.onclick = (e) => {
    e.stopPropagation();
    if (!box.hidden) { box.hidden = true; return; }
    meseAperto = primoDelMese(giorno);
    disegna();
    box.hidden = false;
  };

  document.addEventListener("click", (e) => {
    if (!box.hidden && !box.contains(e.target)) box.hidden = true;
  });
}

function agganciaRicerca() {
  const input = document.getElementById("cerca");
  const esiti = document.getElementById("cerca-esiti");
  if (!input) return;

  let attesa;
  input.oninput = () => {
    clearTimeout(attesa);
    const q = input.value.trim();
    if (q.length < 2) { esiti.innerHTML = ""; esiti.classList.remove("aperti"); return; }

    attesa = setTimeout(async () => {
      const { data, error } = await sb.rpc("crm_cerca_appuntamenti",
        { p_centro: centro.id, p_query: q });

      esiti.classList.add("aperti");

      // Un guasto del server non deve travestirsi da "nessun risultato":
      // sono due cose diverse e chi cerca deve poterle distinguere.
      if (error) {
        esiti.innerHTML = `<div class="esito vuoto errore">La ricerca non ha funzionato. Riprova.</div>`;
        return;
      }

      const lista = data || [];
      esiti.innerHTML = lista.length
        ? lista.map((a) => `
            <button class="esito" data-giorno="${esc(a.giorno)}">
              <span class="quando">${esc(a.quando)} · ${esc(a.ora)}</span>
              <span class="chi">${esc(a.cliente)}</span>
              <span class="cosa">${esc(a.trattamento)}</span>
            </button>`).join("")
        : `<div class="esito vuoto">Nessun appuntamento trovato</div>`;

      esiti.querySelectorAll(".esito[data-giorno]").forEach((b) => {
        b.onclick = () => {
          giorno = b.dataset.giorno;
          vista = "giorno";
          input.value = "";
          esiti.innerHTML = "";
          esiti.classList.remove("aperti");
          caricaAgenda();
        };
      });
    }, 280);
  };

  input.onblur = () => setTimeout(() => {
    esiti.innerHTML = "";
    esiti.classList.remove("aperti");
  }, 180);
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

  const ore = etichetteOre(apertura, chiusura);

  // Le colonne sono le operatrici o le cabine, a seconda dell'interruttore.
  // Chi lavora al bancone di solito ragiona per persona; la cabina serve
  // quando le stanze sono il vincolo scarso.
  const perOperatrice = raggruppa === "operatrici";
  let gruppi = perOperatrice
    ? (anagrafiche.operatori || []).map((o) => ({ id: o.id, nome: o.nome }))
    : dati.cabine.map((c) => ({ id: c.id, nome: c.nome }));

  const chiave = (a) => (perOperatrice ? a.operatore_id : a.cabina_id);

  // Gli appuntamenti senza operatrice non devono sparire: hanno una colonna
  // loro, ma solo se ce n'e' davvero qualcuno.
  const orfani = dati.appuntamenti.filter((a) => !chiave(a));
  if (perOperatrice && orfani.length) gruppi = [...gruppi, { id: null, nome: "Non assegnati" }];

  const per = new Map(gruppi.map((g) => [g.id, []]));
  for (const a of dati.appuntamenti) per.get(chiave(a) ?? null)?.push(a);

  const colonne = gruppi.map((g) => {
    const lista = (per.get(g.id) || []).sort((x, y) => minuti(x.inizio) - minuti(y.inizio));
    assegnaCorsie(lista);
    const blocchi = lista.map((a) =>
      bloccoHtml(a, (minuti(a.inizio) - apertura) * PX_MIN, a.durata * PX_MIN,
                 a._corsia, a._corsie)).join("");
    return `<div class="colonna ${g.id === null ? "orfani" : ""}"
                 style="height:${altezza}px">${blocchi}</div>`;
  }).join("");

  const n = gruppi.length;
  const css = `grid-template-columns: 62px repeat(${n}, minmax(170px, 1fr))`;
  const q = dati.appuntamenti.length;
  const manca = perOperatrice ? "Nessuna operatrice configurata." : "Nessuna cabina configurata.";

  app.innerHTML = `
    ${barra(`${q} ${q === 1 ? "appuntamento" : "appuntamenti"}`)}
    <div class="griglia-wrap">
      ${n === 0
        ? `<div class="vuoto">${manca}</div>`
        : `<div class="intestazioni" style="${css}">
             <div class="testa ore"></div>
             ${gruppi.map((g) => `<div class="testa">${esc(g.nome)}</div>`).join("")}
           </div>
           <div class="griglia" style="${css}">
             <div class="colonna-ore">${ore}</div>
             ${colonne}
             ${rigaOraAttuale(apertura, chiusura, giorno)}
           </div>`}
    </div>`;

  agganciaBarra();
  agganciaBlocchi(dati.appuntamenti);

  app.querySelectorAll(".colonna").forEach((col, i) => {
    col.onclick = (e) => {
      const ora = oraDalClick(e, col, apertura, chiusura);
      const g = gruppi[i];

      if (daSpostare) {
        // Spostando fra colonne cambia cio' che la colonna rappresenta: la
        // cabina se si guarda per cabine, altrimenti solo l'orario.
        return concludiSpostamento(perOperatrice ? daSpostare.cabina_id : g.id, ora, giorno);
      }
      apriNuovo(
        perOperatrice ? anagrafiche.cabine[0]?.id : g.id,
        ora, giorno,
        perOperatrice ? g.id : null);
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

  const ore = etichetteOre(apertura, chiusura);

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
        ${rigaOraAttuale(apertura, chiusura, oggi())}
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
  const posizione = `top:${top}px;height:${h}px;left:calc(${corsia * largh}% + 3px);` +
                    `width:calc(${largh}% - 6px);`;

  // Un blocco non e' un cliente: niente colore del trattamento, aspetto
  // neutro e rigato, cosi' a colpo d'occhio si vede che e' tempo chiuso.
  if (a.tipo === "blocco") {
    return `
      <div class="appuntamento chiusura" data-id="${esc(a.id)}" style="${posizione}">
        <div class="h">${esc(a.inizio)}–${esc(a.fine)}</div>
        <div class="c">${esc(a.titolo || "Bloccato")}</div>
      </div>`;
  }

  const stile = posizione +
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

// Una fascia per ora piena. L'altezza la scriviamo esplicitamente perche' un
// centro puo' aprire alle 8:30, e in quel caso la prima fascia e' piu' corta.
function etichetteOre(apertura, chiusura) {
  let html = "";
  let m = apertura;
  while (m < chiusura) {
    const prossima = Math.min(m === apertura ? (Math.floor(m / 60) + 1) * 60 : m + 60, chiusura);
    html += `<div class="ora" style="height:${(prossima - m) * PX_MIN}px">${oraDaMinuti(m)}</div>`;
    m = prossima;
  }
  return html;
}

// Riga dell'ora corrente: si disegna solo se si sta guardando oggi e siamo
// dentro l'orario di apertura. E' il riferimento che al bancone si cerca per
// primo — "a che punto siamo".
function rigaOraAttuale(apertura, chiusura, giornoMostrato) {
  if (giornoMostrato !== oggi()) return "";
  const adesso = new Date();
  const m = adesso.getHours() * 60 + adesso.getMinutes();
  if (m < apertura || m > chiusura) return "";
  return `<div class="ora-attuale" style="top:${(m - apertura) * PX_MIN}px"></div>`;
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

function apriNuovo(cabinaId, ora, dataIso, operatoreId = null) {
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
  let tipo = "appuntamento";

  const DURATE = [15, 20, 30, 45, 60, 75, 90, 120, 150, 180];

  box.classList.add("scheda-larga");
  box.innerHTML = `
    <div class="scheda-testa">
      <h2>Nuovo appuntamento</h2>
      <div class="scheda-azioni">
        <button class="btn btn-chiaro" id="annulla">Annulla</button>
        <button class="btn" id="salva" disabled>Salva</button>
      </div>
    </div>

    <div class="tipi">
      <button class="tipo attivo" data-tipo="appuntamento">
        <strong>Appuntamento</strong>
        <span>Fissa un appuntamento con un cliente</span>
      </button>
      <button class="tipo" data-tipo="blocco">
        <strong>Blocco</strong>
        <span>Chiudi uno spazio nella tua agenda</span>
      </button>
    </div>

    <div id="errore"></div>

    <div class="riga">
      <div>
        <label>Data</label>
        <input id="data" type="date" value="${esc(dataIso)}">
      </div>
      <div>
        <label>Ora</label>
        <input id="ora" type="time" value="${esc(ora)}" step="900">
      </div>
    </div>

    <div class="solo-appuntamento">
      <label>Modalità</label>
      <select id="modalita">
        <option value="sede">In sede</option>
        <option value="domicilio">A domicilio</option>
      </select>

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

      <label>Servizio</label>
      <select id="trattamento">
        ${anagrafiche.trattamenti.map((t) =>
          `<option value="${esc(t.id)}" data-durata="${t.durata}">${esc(t.nome)}</option>`).join("")}
      </select>
    </div>

    <div class="solo-blocco" hidden>
      <label>Motivo</label>
      <input id="titolo" type="text" placeholder="Pausa pranzo, riunione, ferie…" autocomplete="off">
    </div>

    <label>Durata</label>
    <select id="durata">
      ${DURATE.map((d) => `<option value="${d}">${d} minuti</option>`).join("")}
    </select>

    <div class="riga">
      <div>
        <label>Cabina</label>
        <select id="cabina">
          <option value="">—</option>
          ${anagrafiche.cabine.map((c) =>
            `<option value="${esc(c.id)}" ${c.id === cabinaId ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Membro team</label>
        <select id="operatore">
          <option value="">—</option>
          ${anagrafiche.operatori.map((o) =>
            `<option value="${esc(o.id)}" ${o.id === operatoreId ? "selected" : ""}>${esc(o.nome)}</option>`).join("")}
        </select>
      </div>
    </div>

    <label>Note <span class="opz">(facoltative)</span></label>
    <textarea id="note" rows="2"></textarea>`;

  const el = (id) => box.querySelector("#" + id);
  const err = el("errore");
  const salva = el("salva");
  const trattamento = el("trattamento");
  const durata = el("durata");

  // La durata segue il servizio, ma resta modificabile: un trattamento sulla
  // stessa cliente puo' richiedere piu' tempo del listino.
  const durataDaServizio = () => {
    const d = Number(trattamento.selectedOptions[0]?.dataset.durata || 60);
    const vicina = [...durata.options].find((o) => Number(o.value) >= d) || durata.options[0];
    durata.value = vicina.value;
  };
  durataDaServizio();
  trattamento.onchange = () => { durataDaServizio(); verifica(); };

  // Il tasto Salva resta spento finche' non c'e' abbastanza per salvare:
  // meglio un tasto che non si preme di un errore dopo averlo premuto.
  function verifica() {
    const ok = tipo === "appuntamento"
      ? Boolean(clienteScelto || el("cnome").value.trim()) && Boolean(el("cabina").value)
      : Boolean(el("titolo").value.trim()) && Boolean(el("cabina").value || el("operatore").value);
    salva.disabled = !ok;
  }

  box.querySelectorAll(".tipo").forEach((b) => {
    b.onclick = () => {
      tipo = b.dataset.tipo;
      box.querySelectorAll(".tipo").forEach((x) => x.classList.toggle("attivo", x === b));
      box.querySelector(".solo-appuntamento").hidden = tipo === "blocco";
      box.querySelector(".solo-blocco").hidden = tipo !== "blocco";
      box.querySelector(".scheda-testa h2").textContent =
        tipo === "blocco" ? "Nuovo blocco" : "Nuovo appuntamento";
      verifica();
    };
  });

  ["titolo", "cabina", "operatore", "cnome"].forEach((id) => {
    const e = el(id);
    if (e) e.addEventListener("input", verifica), e.addEventListener("change", verifica);
  });

  // ------------------------------------------------------- ricerca cliente
  const q = el("qcliente");
  const risultati = el("risultati");
  const nuovo = el("nuovocliente");

  const mostraNuovo = (testo) => {
    clienteScelto = null;
    nuovo.hidden = false;
    risultati.innerHTML = "";
    const pezzi = testo.trim().split(/\s+/);
    el("cnome").value = pezzi[0] || "";
    el("ccognome").value = pezzi.slice(1).join(" ");
    verifica();
  };

  let attesa;
  q.oninput = () => {
    clearTimeout(attesa);
    const testo = q.value.trim();
    clienteScelto = null;
    nuovo.hidden = true;
    verifica();
    if (testo.length < 2) { risultati.innerHTML = ""; return; }

    attesa = setTimeout(async () => {
      const { data: trovati, error } = await sb.rpc("crm_cerca_cliente",
        { p_centro: centro.id, p_query: testo });
      if (error) {
        risultati.innerHTML = `<div class="ris vuoto">La ricerca non ha funzionato.</div>`;
        return;
      }
      risultati.innerHTML = (trovati || []).map((c) => `
        <button class="ris" data-id="${esc(c.id)}">
          ${esc(c.nome)} ${esc(c.cognome || "")}
          ${c.telefono ? `<span class="tel">${esc(c.telefono)}</span>` : ""}
        </button>`).join("") +
        `<button class="ris nuovo">+ Nuovo cliente \u201c${esc(testo)}\u201d</button>`;

      risultati.querySelectorAll(".ris").forEach((b) => {
        b.onclick = () => {
          if (b.classList.contains("nuovo")) return mostraNuovo(testo);
          clienteScelto = b.dataset.id;
          q.value = b.textContent.trim().split("\n")[0].trim();
          risultati.innerHTML = "";
          nuovo.hidden = true;
          verifica();
        };
      });
    }, 250);
  };

  el("annulla").onclick = chiudi;

  salva.onclick = async () => {
    err.innerHTML = "";
    salva.disabled = true;
    salva.textContent = "Salvo\u2026";

    let clienteId = clienteScelto;

    if (tipo === "appuntamento" && !clienteId) {
      const nome = el("cnome").value.trim();
      const { data: cli } = await sb.rpc("crm_salva_cliente", {
        p_centro: centro.id, p_nome: nome,
        p_cognome: el("ccognome").value.trim() || null,
        p_telefono: el("ctelefono").value.trim() || null,
      });
      if (!cli?.ok) {
        err.innerHTML = erroreBox(cli?.errore || "Non sono riuscito a salvare il cliente.");
        salva.disabled = false; salva.textContent = "Salva";
        return;
      }
      clienteId = cli.id;
    }

    const { data, error } = await sb.rpc("crm_salva_appuntamento_locale", {
      p_centro: centro.id,
      p_cliente: tipo === "blocco" ? null : clienteId,
      p_trattamento: tipo === "blocco" ? null : trattamento.value,
      p_cabina: el("cabina").value || null,
      p_giorno: el("data").value,
      p_ora: el("ora").value,
      p_operatore: el("operatore").value || null,
      p_durata: Number(durata.value),
      p_note: el("note").value.trim() || null,
      p_tipo: tipo,
      p_titolo: tipo === "blocco" ? el("titolo").value.trim() : null,
      p_modalita: el("modalita").value,
    });

    if (error || !data?.ok) {
      err.innerHTML = erroreBox(data?.errore || error?.message || "Non sono riuscito a salvare.");
      salva.disabled = false;
      salva.textContent = "Salva";
      return;
    }

    // Se si salva su un giorno diverso da quello mostrato, ci si sposta li':
    // altrimenti l'appuntamento sparirebbe e sembrerebbe non salvato.
    if (el("data").value !== giorno) giorno = el("data").value;
    chiudi();
    caricaAgenda();
  };

  verifica();
  q.focus({ preventScroll: true });
}

function mostraScheda(a) {
  if (!a) return;
  const { box, chiudi } = pannello();

  if (a.tipo === "blocco") {
    box.innerHTML = `
      <h2>${esc(a.titolo || "Spazio bloccato")}</h2>
      <p class="quando">${a.giorno ? esc(fmt(a.giorno, { weekday: "long", day: "numeric", month: "long" })) + " \u00b7 " : ""}${esc(a.inizio)}\u2013${esc(a.fine)}</p>
      <div id="errore"></div>
      <dl>
        ${a.cabina ? `<dt>Cabina</dt><dd>${esc(a.cabina)}</dd>` : ""}
        ${a.operatore ? `<dt>Operatrice</dt><dd>${esc(a.operatore)}</dd>` : ""}
        <dt>Durata</dt><dd>${a.durata} minuti</dd>
        ${a.note ? `<dt>Note</dt><dd>${esc(a.note)}</dd>` : ""}
      </dl>
      <div class="azioni">
        <button class="btn btn-chiaro" id="sposta">Sposta</button>
        <button class="btn btn-chiaro pericolo" id="annullaApp">Rimuovi blocco</button>
      </div>
      <button class="btn btn-wide chiudi">Chiudi</button>`;

    const errB = box.querySelector("#errore");
    box.querySelector("#sposta").onclick = () => {
      daSpostare = a;
      if (vista !== "giorno") { vista = "giorno"; if (a.giorno) giorno = a.giorno; }
      chiudi();
      caricaAgenda();
    };
    box.querySelector("#annullaApp").onclick = async () => {
      const { data } = await sb.rpc("crm_cambia_stato", { p_id: a.id, p_stato: "annullato" });
      if (!data?.ok) { errB.innerHTML = erroreBox(data?.errore || "Non riesco a rimuoverlo."); return; }
      chiudi();
      caricaAgenda();
    };
    box.querySelector(".chiudi").onclick = chiudi;
    return;
  }

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

// -------------------------------------------------------- integrazioni

// Collegamento del WhatsApp del centro. Il giro passa da Meta: la titolare
// autorizza nella finestra di Facebook, noi riceviamo un codice usa e getta e
// lo consegniamo subito alla edge function wa-connect, che è l'unica a
// conoscere il segreto dell'app. Nel browser non transita nessuna credenziale.
//
// Modalità Coexistence: il numero resta sull'app del telefono. La titolare
// continua a rispondere come ha sempre fatto, e quando lo fa il bot tace.

let fbPronto = null;   // promessa risolta quando l'SDK di Facebook è caricato

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

async function apriIntegrazioni() {
  const { box, chiudi } = pannello();
  box.classList.add("scheda-larga");
  box.innerHTML = `<div class="scheda-testa"><h2>Integrazioni</h2></div>
                   <p class="quando">Caricamento…</p>`;

  const [statoRes, cfgRes] = await Promise.all([
    sb.rpc("crm_wa_stato", { p_centro: centro.id }),
    sb.rpc("crm_wa_config"),
  ]);
  const stato = statoRes.data;
  const cfg = cfgRes.data;

  if (statoRes.error || !stato?.ok) {
    box.innerHTML = `<div class="scheda-testa"><h2>Integrazioni</h2></div>
      ${erroreBox(statoRes.error?.message || stato?.errore || "Non disponibile")}
      <button class="btn btn-wide chiudi">Chiudi</button>`;
    box.querySelector(".chiudi").onclick = chiudi;
    return;
  }

  disegna();

  function disegna(messaggio = "") {
    const collegato = stato.stato === "collegato";
    box.innerHTML = `
      <div class="scheda-testa"><h2>Integrazioni</h2></div>
      ${messaggio ? erroreBox(messaggio) : ""}
      ${stato.errore ? erroreBox(stato.errore) : ""}
      <div class="integrazione">
        <div class="integrazione-testa">
          <strong>WhatsApp Business</strong>
          <span class="badge-stato ${collegato ? "on" : "off"}">${collegato ? "Collegato" : "Non collegato"}</span>
        </div>
        <p class="quando">${collegato
          ? `Numero ${esc(stato.numero || "collegato")}. Le clienti scrivono come sempre;
             tu continui a rispondere dal telefono quando vuoi.`
          : `Collega il numero WhatsApp del centro: le richieste delle clienti
             finiscono in agenda da sole. Continuerai a usare WhatsApp dal
             telefono come fai adesso.`}</p>
        ${collegato ? `
          <label class="riga-switch">
            <input type="checkbox" id="wa-bot" ${stato.bot_attivo ? "checked" : ""}>
            <span>Risposte automatiche attive</span>
          </label>
          <button class="btn-secondario" id="wa-scollega">Scollega</button>
        ` : `
          <button class="btn btn-wide" id="wa-collega" ${cfg?.pronto ? "" : "disabled"}>
            Collega WhatsApp Business
          </button>
          ${cfg?.pronto ? "" : `<p class="quando">Collegamento non ancora attivo: stiamo completando la verifica con Meta.</p>`}
        `}
      </div>
      <button class="btn-secondario chiudi">Chiudi</button>`;

    box.querySelector(".chiudi").onclick = chiudi;

    const bottone = box.querySelector("#wa-collega");
    if (bottone) bottone.onclick = () => collega(bottone);

    const interruttore = box.querySelector("#wa-bot");
    if (interruttore) interruttore.onchange = async () => {
      const attivo = interruttore.checked;
      interruttore.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_bot", { p_centro: centro.id, p_attivo: attivo });
      interruttore.disabled = false;
      if (error || !data?.ok) {
        interruttore.checked = !attivo;
        return disegna(error?.message || data?.errore || "Non riuscito");
      }
      stato.bot_attivo = attivo;
    };

    const scollega = box.querySelector("#wa-scollega");
    if (scollega) scollega.onclick = async () => {
      scollega.disabled = true;
      scollega.textContent = "Scollego…";
      const { data, error } = await sb.rpc("crm_wa_scollega", { p_centro: centro.id });
      if (error || !data?.ok) {
        scollega.disabled = false;
        scollega.textContent = "Scollega";
        return disegna(error?.message || data?.errore || "Non riuscito");
      }
      stato.stato = "non_collegato";
      stato.numero = null;
      stato.errore = null;
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
        return disegna("Collegamento annullato.");
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
          centro_id: centro.id, code,
          waba_id: ultimaWaba, modalita: ultimaModalita,
        }),
      });
      const esito = await res.json().catch(() => ({}));
      if (!esito?.ok) {
        bottone.disabled = false;
        bottone.textContent = "Collega WhatsApp Business";
        return disegna(esito?.errore || "Collegamento non riuscito");
      }
      stato.stato = "collegato";
      stato.numero = esito.numero;
      stato.bot_attivo = true;
      stato.errore = null;
      disegna();
    } catch (e) {
      bottone.disabled = false;
      bottone.textContent = "Collega WhatsApp Business";
      disegna(String(e.message || e));
    }
  }
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

  // Le integrazioni le configura chi possiede il centro, non chi ci lavora.
  if (centro.ruolo === "titolare") {
    document.getElementById("integrazioni").hidden = false;
  }

  // Cabine, operatrici e trattamenti cambiano di rado: si caricano una volta.
  const { data: anag } = await sb.rpc("crm_anagrafiche", { p_centro: centro.id });
  anagrafiche = anag || { cabine: [], operatori: [], trattamenti: [] };

  caricaAgenda();
}

document.getElementById("integrazioni").addEventListener("click", apriIntegrazioni);

document.getElementById("logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

boot();
