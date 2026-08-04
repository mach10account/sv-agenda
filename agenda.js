// L'agenda del centro: la vista giornaliera divisa per operatrice o per
// cabina, con settimana e mese. Il guscio (accesso, barra, rotte) sta in
// app.js: qui si dà per scontato che ci sia già un centro aperto in `stato`.

import { sb, app, stato, esc, erroreBox, pannello } from "./core.js?v=15";

const SLOT_H = 46;                 // deve combaciare con --slot-h nel CSS
const PX_MIN = SLOT_H / 30;

let vista = "giorno";     // giorno | settimana | mese
let raggruppa = "operatrici";  // colonne della vista giorno: operatrici | cabine
let giorno = oggi();      // data di riferimento, formato AAAA-MM-GG
let daSpostare = null;    // appuntamento in attesa di una nuova collocazione

// ------------------------------------------------------------------ utils

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

// ------------------------------------------------------------ caricamento

async function caricaAgenda() {
  if (vista === "giorno")    return caricaGiorno();
  if (vista === "settimana") return caricaSettimana();
  return caricaMese();
}

const erroreSchermo = (msg) =>
  app.innerHTML = `${barra()}<div class="notice error" style="margin:20px">${esc(msg)}</div>`;

async function caricaGiorno() {
  const { data, error } = await sb.rpc("crm_agenda_giorno",
    { p_centro: stato.centro.id, p_giorno: giorno });
  if (error) return erroreSchermo(error.message);
  if (!data?.ok) return erroreSchermo(data?.errore || "Agenda non disponibile");
  disegnaGiorno(data);
}

async function caricaSettimana() {
  const da = lunedi(giorno);
  const { data, error } = await sb.rpc("crm_agenda_periodo",
    { p_centro: stato.centro.id, p_da: da, p_a: piuGiorni(da, 6) });
  if (error) return erroreSchermo(error.message);
  if (!data?.ok) return erroreSchermo(data?.errore || "Agenda non disponibile");
  disegnaSettimana(data, da);
}

async function caricaMese() {
  const { data, error } = await sb.rpc("crm_agenda_mese",
    { p_centro: stato.centro.id, p_mese: primoDelMese(giorno) });
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
    apriNuovo(stato.anagrafiche.cabine[0]?.id, "09:00", vista === "giorno" ? giorno : oggi());
  });

  // Le intestazioni delle colonne devono fermarsi sotto la testata, che cambia
  // altezza a seconda della vista: la si misura invece di indovinarla.
  misuraTestata();

  agganciaRicerca();
}

// Il bordo BASSO della testata e' per definizione il pixel in cui comincia la
// griglia. Misurare quello, invece di sommare l'altezza della testata a quella
// della barra, e' l'unica forma che non dipende da dove sta la barra: vale
// barra+testata quando e' in cima e solo testata quando e' di lato, senza che
// questo file debba saperne niente.
function misuraTestata() {
  const t = document.querySelector(".testata");
  if (!t) return;
  document.documentElement.style.setProperty(
    "--testata-h", `${Math.round(t.getBoundingClientRect().bottom)}px`);
}

// Attraversando la soglia in cui la barra cambia lato, la testata si sposta e
// cambia altezza senza che l'agenda si ridisegni: senza questo la griglia resta
// troppo corta (fascia vuota in fondo) o troppo lunga (ultima ora tagliata)
// finche' non si tocca qualcos'altro. Registrato qui una volta sola: dentro
// agganciaBarra se ne accumulerebbe uno a ogni cambio di giorno.
let misuraInCoda = false;
window.addEventListener("resize", () => {
  if (misuraInCoda) return;
  misuraInCoda = true;
  requestAnimationFrame(() => { misuraInCoda = false; misuraTestata(); });
});

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
        { p_centro: stato.centro.id, p_query: q });

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
    ? (stato.anagrafiche.operatori || []).map((o) => ({ id: o.id, nome: o.nome }))
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
        perOperatrice ? stato.anagrafiche.cabine[0]?.id : g.id,
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

  // 100 e non 120: con la barra di lato la soglia oltre la quale la settimana
  // entra tutta a schermo passerebbe da 902 a 1138 pixel, e su un portatile da
  // 13 pollici la domenica finirebbe fuori. Sopra i 1138 non cambia niente —
  // 1fr continua ad allargare le colonne — si sposta solo il punto in cui
  // compare lo scorrimento di lato.
  const css = `grid-template-columns: 62px repeat(7, minmax(100px, 1fr))`;
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
      apriNuovo(stato.anagrafiche.cabine[0]?.id, ora, g);
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

const STATI = {
  prenotato: "Prenotato",
  confermato: "Confermato",
  presentato: "Presentato",
  non_presentato: "Non presentato",
  annullato: "Annullato",
};

function apriNuovo(cabinaId, ora, dataIso, operatoreId = null) {
  if (!stato.anagrafiche?.trattamenti?.length) {
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
        ${stato.anagrafiche.trattamenti.map((t) =>
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
          ${stato.anagrafiche.cabine.map((c) =>
            `<option value="${esc(c.id)}" ${c.id === cabinaId ? "selected" : ""}>${esc(c.nome)}</option>`).join("")}
        </select>
      </div>
      <div>
        <label>Membro team</label>
        <select id="operatore">
          <option value="">—</option>
          ${stato.anagrafiche.operatori.map((o) =>
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
        { p_centro: stato.centro.id, p_query: testo });
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
        p_centro: stato.centro.id, p_nome: nome,
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
      p_centro: stato.centro.id,
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

// ------------------------------------------------------------------ ingresso

// La sezione si ridisegna da capo a ogni ingresso: il giorno che si stava
// guardando resta quello, ma i dati si rileggono. In un centro l'agenda
// cambia mentre la guardi.
export function mostraAgenda() {
  caricaAgenda();

  // Uscendo dalla sezione uno spostamento a metà non deve restare appeso.
  return () => {
    daSpostare = null;
    document.body.classList.remove("in-spostamento");
    document.querySelector(".barra-spostamento")?.remove();
  };
}
