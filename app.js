import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

// Stesso progetto dell'Academy: il centro entra una volta e trova corsi e agenda.
const SUPABASE_URL = "https://hypkwdvvrmakqrowbkqw.supabase.co";
const SUPABASE_KEY = "sb_publishable_y0_DEhM-bC37jEKkiC_GGQ_TaWvPqVe";

const sb = createClient(SUPABASE_URL, SUPABASE_KEY);
const app = document.getElementById("app");
const topbar = document.getElementById("topbar");

let session = null;
let centro = null;      // il centro attualmente aperto
let giorno = oggi();    // data mostrata, formato AAAA-MM-GG
let anagrafiche = null; // cabine, operatrici, trattamenti del centro
let daSpostare = null;  // appuntamento in attesa di una nuova collocazione

// ------------------------------------------------------------------ utils

const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

function oggi() {
  // Data locale, non UTC: toISOString() darebbe il giorno sbagliato la sera.
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

const spostaGiorno = (iso, delta) => {
  const [a, m, g] = iso.split("-").map(Number);
  const d = new Date(a, m - 1, g + delta);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
};

const etichettaGiorno = (iso) => {
  const [a, m, g] = iso.split("-").map(Number);
  return new Date(a, m - 1, g).toLocaleDateString("it-IT",
    { weekday: "long", day: "numeric", month: "long" });
};

const minuti = (hhmm) => {
  const [h, m] = hhmm.split(":").map(Number);
  return h * 60 + m;
};

// Colore di sfondo tenue a partire dal colore pieno del trattamento.
const tenue = (hex) => {
  const h = (hex || "#6B4E9B").replace("#", "");
  const n = parseInt(h.length === 3 ? h.split("").map((c) => c + c).join("") : h, 16);
  return `rgba(${(n >> 16) & 255}, ${(n >> 8) & 255}, ${n & 255}, .16)`;
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

// ----------------------------------------------------------------- agenda

async function caricaAgenda() {
  const { data, error } = await sb.rpc("crm_agenda_giorno", {
    p_centro: centro.id,
    p_giorno: giorno,
  });

  if (error) {
    app.innerHTML = `<div class="notice" style="margin:20px">Errore: ${esc(error.message)}</div>`;
    return;
  }
  if (!data?.ok) {
    app.innerHTML = `<div class="notice" style="margin:20px">${esc(data?.errore || "Agenda non disponibile")}</div>`;
    return;
  }
  disegna(data);
}

function disegna(dati) {
  const apertura = minuti(dati.centro.apertura);
  const chiusura = minuti(dati.centro.chiusura);
  const durataGiornata = chiusura - apertura;
  const slotH = 46;                     // deve combaciare con --slot-h nel CSS
  const pxPerMinuto = slotH / 30;
  const altezza = durataGiornata * pxPerMinuto;

  // Colonna delle ore, una etichetta ogni mezz'ora.
  let ore = "";
  for (let m = apertura; m < chiusura; m += 30) {
    const h = String(Math.floor(m / 60)).padStart(2, "0");
    const mm = String(m % 60).padStart(2, "0");
    ore += `<div class="ora ${mm === "30" ? "mezza" : ""}">${h}:${mm}</div>`;
  }

  const perCabina = new Map(dati.cabine.map((c) => [c.id, []]));
  for (const a of dati.appuntamenti) {
    if (perCabina.has(a.cabina_id)) perCabina.get(a.cabina_id).push(a);
  }

  const colonne = dati.cabine.map((cab) => {
    const blocchi = (perCabina.get(cab.id) || []).map((a) => {
      const top = (minuti(a.inizio) - apertura) * pxPerMinuto;
      const h = Math.max(a.durata * pxPerMinuto - 2, 20);
      const stretto = h < 44;
      return `
        <div class="appuntamento ${esc(a.stato)}" data-id="${esc(a.id)}"
             style="top:${top}px;height:${h}px;background:${tenue(a.colore)};border-left-color:${esc(a.colore)}">
          <div class="h">${esc(a.inizio)}<span class="c"> · ${esc(a.cliente)}</span></div>
          ${stretto ? "" : `<div class="t">${esc(a.trattamento)}${a.operatore ? " · " + esc(a.operatore) : ""}</div>`}
        </div>`;
    }).join("");

    return `<div class="colonna" style="height:${altezza}px">${blocchi}</div>`;
  }).join("");

  const teste = dati.cabine.map((c) => `<div class="testa">${esc(c.nome)}</div>`).join("");
  const nColonne = dati.cabine.length;
  // Intestazioni e griglia sono due elementi distinti: perche' le colonne
  // restino allineate devono dichiarare le stesse larghezze.
  const colonneCss = `grid-template-columns: 62px repeat(${nColonne}, 190px)`;

  app.innerHTML = `
    <div class="giorno-bar">
      <button class="nav-btn" id="prec" title="Giorno precedente">‹</button>
      <button class="nav-btn" id="succ" title="Giorno successivo">›</button>
      <button class="oggi-btn" id="oggi">Oggi</button>
      <h1>${esc(etichettaGiorno(giorno))}</h1>
      <span class="conteggio">${dati.appuntamenti.length} ${dati.appuntamenti.length === 1 ? "appuntamento" : "appuntamenti"}</span>
    </div>

    <div class="griglia-wrap">
      ${nColonne === 0
        ? `<div class="vuoto">Nessuna cabina configurata per questo centro.</div>`
        : `<div class="intestazioni" style="${colonneCss}">
             <div class="testa ore"></div>
             ${teste}
           </div>
           <div class="griglia" style="${colonneCss}">
             <div class="colonna-ore">${ore}</div>
             ${colonne}
           </div>`}
    </div>`;

  document.getElementById("prec").onclick = () => { giorno = spostaGiorno(giorno, -1); caricaAgenda(); };
  document.getElementById("succ").onclick = () => { giorno = spostaGiorno(giorno, 1); caricaAgenda(); };
  document.getElementById("oggi").onclick = () => { giorno = oggi(); caricaAgenda(); };

  app.querySelectorAll(".appuntamento").forEach((el) => {
    el.onclick = (e) => {
      e.stopPropagation();   // altrimenti scatta anche il click sulla colonna
      if (daSpostare) return;
      mostraScheda(dati.appuntamenti.find((a) => a.id === el.dataset.id));
    };
  });

  // Click su uno spazio libero: si ricava l'ora dalla posizione verticale.
  app.querySelectorAll(".colonna").forEach((col, i) => {
    col.onclick = (e) => {
      // Il bordo della colonna cade spesso a meta' pixel mentre la posizione
      // del click e' intera: senza tolleranza si perde mezzo pixel e il click
      // sulla riga delle 10:00 finirebbe per proporre le 09:45.
      const y = Math.max(0, e.clientY - col.getBoundingClientRect().top + 1);

      // Tagli da 15 minuti: la griglia mostra le mezz'ore, ma i centri
      // lavorano spesso su quarti d'ora.
      const grezzo = apertura + Math.floor(y / pxPerMinuto / 15) * 15;
      const m = Math.min(Math.max(grezzo, apertura), chiusura - 15);
      const ora = `${String(Math.floor(m / 60)).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;
      const cabinaId = dati.cabine[i].id;

      if (daSpostare) return concludiSpostamento(cabinaId, ora);
      apriNuovo(cabinaId, ora);
    };
  });

  // La barra vive fuori dalla griglia, quindi non sparisce da sola quando si
  // ridisegna: va tolta a ogni giro e rimessa solo se serve ancora.
  document.querySelector(".barra-spostamento")?.remove();

  if (daSpostare) {
    document.body.classList.add("in-spostamento");
    const barra = document.createElement("div");
    barra.className = "barra-spostamento";
    barra.innerHTML = `Tocca dove spostare <strong>${esc(daSpostare.cliente)}</strong>
                       <button class="annulla-spost">Annulla</button>`;
    barra.querySelector(".annulla-spost").onclick = () => {
      daSpostare = null;
      document.body.classList.remove("in-spostamento");
      caricaAgenda();
    };
    document.body.appendChild(barra);
  }
}

const STATI = {
  prenotato: "Prenotato",
  confermato: "Confermato",
  presentato: "Presentato",
  non_presentato: "Non presentato",
  annullato: "Annullato",
};

// Pannello riutilizzabile: restituisce l'elemento interno da riempire.
function pannello() {
  const velo = document.createElement("div");
  velo.className = "velo";
  velo.innerHTML = `<div class="scheda"></div>`;
  velo.onclick = (e) => { if (e.target === velo) velo.remove(); };
  document.body.appendChild(velo);
  return { velo, box: velo.querySelector(".scheda"), chiudi: () => velo.remove() };
}

const erroreBox = (msg) => `<div class="notice">${esc(msg)}</div>`;

// ----------------------------------------------------- nuovo appuntamento

function apriNuovo(cabinaId, ora) {
  const { box, chiudi } = pannello();
  let clienteScelto = null;

  box.innerHTML = `
    <h2>Nuovo appuntamento</h2>
    <p class="quando">${esc(etichettaGiorno(giorno))} · ore ${esc(ora)}</p>
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
        `<option value="${esc(t.id)}" data-durata="${t.durata}">${esc(t.nome)} · ${t.durata} min</option>`).join("")}
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
      const { data } = await sb.rpc("crm_cerca_cliente", { p_centro: centro.id, p_query: testo });
      risultati.innerHTML = (data || []).map((c) => `
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
      p_giorno: giorno,
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

// ------------------------------------------------------- scheda esistente

function mostraScheda(a) {
  if (!a) return;
  const { box, chiudi } = pannello();

  box.innerHTML = `
    <h2>${esc(a.cliente)}</h2>
    <p class="quando">${esc(a.inizio)}–${esc(a.fine)} · ${esc(a.trattamento)}</p>
    <div id="errore"></div>
    <dl>
      <dt>Stato</dt><dd>${esc(STATI[a.stato] || a.stato)}</dd>
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

// ---------------------------------------------------------- spostamento

async function concludiSpostamento(cabinaId, ora) {
  const a = daSpostare;
  const { data } = await sb.rpc("crm_sposta_appuntamento_locale", {
    p_id: a.id, p_giorno: giorno, p_ora: ora, p_cabina: cabinaId,
  });

  daSpostare = null;
  document.body.classList.remove("in-spostamento");

  if (!data?.ok) {
    await caricaAgenda();
    const { box, chiudi } = pannello();
    box.innerHTML = `<h2>Non si può spostare lì</h2>
      ${erroreBox(data?.errore || "Spostamento non riuscito.")}
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
  if (error) {
    app.innerHTML = `<div class="notice" style="margin:20px">Errore: ${esc(error.message)}</div>`;
    return;
  }

  if (!centri || centri.length === 0) {
    topbar.hidden = false;
    document.getElementById("who").textContent = session.user.email;
    app.innerHTML = `<div class="vuoto">Il tuo accesso non è collegato a nessun centro.<br>
                     Scrivi al tuo consulente.</div>`;
    return;
  }

  centro = centri[0];   // con piu' centri, in futuro qui va un selettore
  topbar.hidden = false;
  document.getElementById("who").textContent = session.user.email;
  document.getElementById("centro").textContent = centro.nome;

  // Cabine, operatrici e trattamenti cambiano di rado: si caricano una volta
  // e restano pronti per il pannello del nuovo appuntamento.
  const { data: anag } = await sb.rpc("crm_anagrafiche", { p_centro: centro.id });
  anagrafiche = anag || { cabine: [], operatori: [], trattamenti: [] };

  caricaAgenda();
}

document.getElementById("logout").addEventListener("click", async () => {
  await sb.auth.signOut();
  location.reload();
});

boot();
