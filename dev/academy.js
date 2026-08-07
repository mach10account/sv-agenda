// La Formazione: catalogo dei corsi, elenco lezioni, player e calendario dei
// webinar. È l'Academy di prima, portata dentro il sito unico; le rotte
// #/corsi, #/corso/<slug> e #/lezione/<id> sono rimaste identiche perché in
// giro ci sono link già mandati ai centri — è cambiato solo il nome a schermo.

import { sb, app, stato, esc, pagina } from "./core.js?v=25";

// Le descrizioni arrivano da GHL come HTML. Teniamo solo il minimo:
// niente script, niente attributi, e i link si aprono in una scheda nuova.
function safeHtml(html) {
  const doc = new DOMParser().parseFromString(String(html ?? ""), "text/html");
  const allowed = new Set(["P", "BR", "STRONG", "B", "EM", "I", "UL", "OL", "LI", "A", "H3", "H4"]);
  const walk = (node) => {
    [...node.children].forEach((el) => {
      if (!allowed.has(el.tagName)) { el.replaceWith(...el.childNodes); return; }
      const href = el.tagName === "A" ? el.getAttribute("href") : null;
      [...el.attributes].forEach((a) => el.removeAttribute(a.name));
      if (href && /^https?:\/\//i.test(href)) {
        el.setAttribute("href", href);
        el.setAttribute("target", "_blank");
        el.setAttribute("rel", "noopener noreferrer");
      }
      walk(el);
    });
  };
  walk(doc.body);
  return doc.body.innerHTML;
}

const courseStats = (course) => {
  const lessons = course.modules.flatMap((m) => m.lessons);
  const done = lessons.filter((l) => l.completed_at).length;
  return { total: lessons.length, done, pct: lessons.length ? Math.round(done / lessons.length * 100) : 0 };
};

const findLesson = (id) => {
  for (const c of stato.catalogo ?? []) {
    for (const m of c.modules) {
      const i = m.lessons.findIndex((l) => l.id === id);
      if (i >= 0) return { course: c, module: m, lesson: m.lessons[i], next: m.lessons[i + 1] ?? null };
    }
  }
  return null;
};

// Il catalogo è la stessa cosa per corsi e assistente: si carica una volta
// all'accesso e si rilegge dopo ogni "segna come completata".
export async function caricaCatalogo() {
  const { data, error } = await sb.rpc("academy_my_catalog");
  if (error) { stato.catalogo = []; return false; }
  stato.catalogo = data ?? [];
  return true;
}

// ---------------------------------------------------------------- webinar

// I webinar dal vivo non hanno ancora una tabella loro: il calendario si
// aggiorna qui e si ripubblica, e le righe vecchie si tolgono a mano. Data e
// ora sono locali — il pubblico è tutto in Italia. "link" è la stanza a cui
// collegarsi, "registrazione" arriva dopo: finché uno dei due manca, il suo
// bottone resta spento invece di portare nel vuoto.
const WEBINAR = [
  { data: "2026-08-11T18:00", titolo: "Come gestire le obiezioni sul prezzo in cabina",
    categoria: "Vendita", relatore: "Giada", link: "", registrazione: "" },
  { data: "2026-08-12T17:30", titolo: "Leggere il conto economico del tuo centro estetico",
    categoria: "Numeri & Margini", relatore: "Federico", link: "", registrazione: "" },
  { data: "2026-08-14T18:00", titolo: "Costruire un'offerta che il cliente non può rifiutare",
    categoria: "Marketing", relatore: "Matteo", link: "", registrazione: "" },
  { data: "2026-07-28T18:00", titolo: "Script di riattivazione: le prime 10 chiamate",
    categoria: "Vendita", relatore: "Giada", link: "", registrazione: "" },
];

// Le categorie con la loro classe di colore. Anche i filtri nascono da qui:
// una categoria nuova si aggiunge in questa riga e basta.
const CATEGORIE = { "Vendita": "vendita", "Marketing": "marketing", "Numeri & Margini": "numeri" };

const MESI = ["Gen", "Feb", "Mar", "Apr", "Mag", "Giu", "Lug", "Ago", "Set", "Ott", "Nov", "Dic"];
const SETTIMANA = ["Dom", "Lun", "Mar", "Mer", "Gio", "Ven", "Sab"];

// Un webinar resta "in corso" per due ore dall'inizio: chi apre la pagina a
// sessione iniziata deve ancora potersi collegare.
const finito = (w) => new Date(w.data).getTime() < Date.now() - 2 * 3600 * 1000;

// "Oggi" e "Domani" a voce, come lo si direbbe; da lì in poi il giorno della
// settimana, che per una che lavora su appuntamenti dice più del numero.
function quandoWebinar(w) {
  const d = new Date(w.data);
  const oggi = new Date(); oggi.setHours(0, 0, 0, 0);
  const diff = Math.round((new Date(d).setHours(0, 0, 0, 0) - oggi) / 86400000);
  const giorno = diff === 0 ? "Oggi" : diff === 1 ? "Domani" : `${SETTIMANA[d.getDay()]} ${d.getDate()}`;
  return `${giorno}, ${w.data.slice(11, 16)}`;
}

function rigaWebinar(w) {
  const d = new Date(w.data);
  const passato = finito(w);

  const quando = passato
    ? (w.registrazione ? "Registrazione disponibile" : "Registrazione in arrivo")
    : `${quandoWebinar(w)} · con ${esc(w.relatore)}`;

  const apri = (url, testo, classe) => url
    ? `<a class="btn ${classe}" href="${esc(url)}" target="_blank" rel="noopener noreferrer">${testo}</a>`
    : `<button class="btn ${classe}" disabled>${testo}</button>`;
  const bottone = passato
    ? apri(w.registrazione, "Rivedi", "btn-chiaro")
    : apri(w.link, "Collegati", "btn-gold");

  return `
    <div class="wb-riga ${passato ? "finito" : ""}">
      <div class="wb-sx">
        <div class="wb-data"><b>${String(d.getDate()).padStart(2, "0")}</b><span>${MESI[d.getMonth()]}</span></div>
        <div class="wb-info">
          <h4>${esc(w.titolo)}</h4>
          <p class="wb-quando"><span class="wb-cat ${CATEGORIE[w.categoria] || ""}">${esc(w.categoria)}</span>${quando}</p>
        </div>
      </div>
      ${bottone}
    </div>`;
}

// Prima i prossimi in ordine di data, poi i passati dal più recente: in cima
// c'è sempre quello a cui collegarsi adesso.
function htmlWebinar(filtro) {
  const scelti = WEBINAR.filter((w) => filtro === "Tutti" || w.categoria === filtro);
  const prossimi = scelti.filter((w) => !finito(w)).sort((a, b) => a.data.localeCompare(b.data));
  const passati = scelti.filter(finito).sort((a, b) => b.data.localeCompare(a.data));
  const righe = [...prossimi, ...passati];
  return righe.length ? righe.map(rigaWebinar).join("")
    : `<div class="notice">Nessun webinar in calendario in questa categoria.</div>`;
}

// --------------------------------------------------------------- catalogo

// Corsi e webinar sono due schede della stessa voce: impilati in una pagina
// sola, il calendario finiva sotto le locandine e non lo vedeva nessuno. La
// scheda scelta sta nella rotta (#/corsi/webinar), non in una variabile: così
// il tasto indietro la rispetta e il link ai webinar si può mandare com'è.
export function mostraCorsi(vista) {
  const suWebinar = vista === "webinar";
  const accessible = (stato.catalogo ?? []).filter((c) => c.has_access);
  const locked = (stato.catalogo ?? []).filter((c) => !c.has_access);

  const card = (c) => {
    const s = courseStats(c);
    const thumb = c.poster_url
      ? `<div class="thumb" style="background-image:url('${esc(c.poster_url)}')"></div>`
      : `<div class="thumb">${esc(c.title)}</div>`;

    const foot = c.has_access
      ? (s.total
          ? `<div class="meta"><div class="bar"><i style="width:${s.pct}%"></i></div><span>${s.done}/${s.total}</span></div>`
          : `<div class="meta"><span>Nessuna lezione pubblicata</span></div>`)
      : `<div class="meta"><span class="badge gold">Non incluso</span><span>Scrivi al tuo consulente</span></div>`;

    return `
      <a class="card ${c.has_access ? "" : "locked"}" href="${c.has_access ? "#/corso/" + esc(c.slug) : "#/corsi"}">
        ${thumb}
        <div class="card-body">
          <h3>${esc(c.title)}</h3>
          <p>${esc(c.description || "")}</p>
          ${foot}
        </div>
      </a>`;
  };

  const pillola = (c) => `
    <button class="wb-filtro ${c === "Tutti" ? "attiva" : ""}" data-cat="${esc(c)}">${esc(c)}</button>`;

  const corpoCorsi = `
    ${accessible.length ? `<div class="grid">${accessible.map(card).join("")}</div>`
      : `<div class="notice">Non hai ancora corsi attivi. Scrivi al tuo consulente per l'accesso.</div>`}
    ${locked.length ? `<h2>Disponibili su richiesta</h2><div class="grid">${locked.map(card).join("")}</div>` : ""}`;

  const corpoWebinar = `
    <p class="sub">3 sessioni a settimana. Collegati con un click, o recupera la registrazione dopo.</p>
    <div class="wb-filtri">${["Tutti", ...Object.keys(CATEGORIE)].map(pillola).join("")}</div>
    <div id="wb-elenco">${htmlWebinar("Tutti")}</div>`;

  app.innerHTML = pagina(`
    <h1>Formazione</h1>
    <p class="sub">I tuoi corsi e i webinar dal vivo</p>
    <div class="viste commuta">
      <a class="vista ${suWebinar ? "" : "attiva"}" href="#/corsi">Corsi</a>
      <a class="vista ${suWebinar ? "attiva" : ""}" href="#/corsi/webinar">Webinar</a>
    </div>
    ${suWebinar ? corpoWebinar : corpoCorsi}`);

  if (!suWebinar) return;

  // Il filtro ridisegna solo l'elenco: la pagina attorno non si muove.
  const filtri = app.querySelectorAll(".wb-filtro");
  filtri.forEach((b) => b.addEventListener("click", () => {
    filtri.forEach((f) => f.classList.toggle("attiva", f === b));
    document.getElementById("wb-elenco").innerHTML = htmlWebinar(b.dataset.cat);
  }));
}

export function mostraCorso(slug) {
  const course = (stato.catalogo ?? []).find((c) => c.slug === slug);
  if (!course) return mancante();
  if (!course.has_access) return mancante("Questo corso non è incluso nel tuo percorso.");

  const s = courseStats(course);
  const modules = course.modules.map((m) => `
    <h2>${esc(m.title)}</h2>
    <div class="lessons">
      ${m.lessons.map((l, i) => `
        <a class="lesson" href="#/lezione/${esc(l.id)}">
          <span class="n ${l.completed_at ? "done" : ""}">${l.completed_at ? "✓" : i + 1}</span>
          <span class="t">${esc(l.title)}</span>
          ${l.has_video ? "" : `<span class="badge">in arrivo</span>`}
        </a>`).join("")}
    </div>`).join("");

  app.innerHTML = pagina(`
    <a class="back" href="#/corsi">← Formazione</a>
    <h1>${esc(course.title)}</h1>
    <p class="sub">${esc(course.description || "")}</p>
    ${s.total ? `<div class="meta"><div class="bar"><i style="width:${s.pct}%"></i></div><span>${s.done} di ${s.total} completate</span></div>` : ""}
    ${modules || `<div class="notice">Nessuna lezione pubblicata al momento.</div>`}`);
}

// ----------------------------------------------------------------- player

let wmTimer = null;

function startWatermark(text) {
  const wrap = document.querySelector(".player-wrap");
  if (!wrap) return;
  const wm = document.createElement("div");
  wm.id = "wm";
  wm.textContent = text;
  wrap.appendChild(wm);

  const move = () => {
    wm.style.left = (8 + Math.random() * 60) + "%";
    wm.style.top = (10 + Math.random() * 75) + "%";
  };
  move();
  clearInterval(wmTimer);
  wmTimer = setInterval(move, 20000);
}

export async function mostraLezione(id) {
  const found = findLesson(id);
  if (!found) return mancante();
  const { course, lesson, next } = found;

  app.innerHTML = pagina(`
    <a class="back" href="#/corso/${esc(course.slug)}">← ${esc(course.title)}</a>
    <h1>${esc(lesson.title)}</h1>
    <div id="video"><div class="loading">Preparo il video…</div></div>
    <div class="lesson-desc">${safeHtml(lesson.description_html)}</div>
    <div class="actions">
      <button id="done" class="btn ${lesson.completed_at ? "btn-gold" : ""}" ${lesson.completed_at ? "disabled" : ""}>
        ${lesson.completed_at ? "✓ Completata" : "Segna come completata"}
      </button>
      ${next ? `<a class="btn btn-gold" href="#/lezione/${esc(next.id)}">Lezione successiva →</a>` : ""}
    </div>`);

  document.getElementById("done").addEventListener("click", async (e) => {
    e.target.disabled = true;
    e.target.textContent = "Salvo…";
    const { error } = await sb.rpc("academy_set_progress",
      { p_lesson: lesson.id, p_seconds: 0, p_completed: true });
    if (error) {
      e.target.disabled = false;
      e.target.textContent = "Riprova";
      return;
    }
    await caricaCatalogo();
    mostraLezione(lesson.id);
  });

  const box = document.getElementById("video");

  if (!lesson.has_video) {
    box.innerHTML = `<div class="notice">Il video di questa lezione non è ancora disponibile.</div>`;
    return;
  }

  // L'URL del player lo emette il server, e solo se l'iscrizione e' valida.
  const { data, error } = await sb.functions.invoke("lesson-video", { body: { lessonId: lesson.id } });

  if (error || !data?.embedUrl) {
    box.innerHTML = `<div class="notice error">Non riesco ad aprire il video. Ricarica la pagina o scrivi al tuo consulente.</div>`;
    return;
  }

  box.innerHTML = `
    <div class="player-wrap">
      <iframe src="${esc(data.embedUrl)}" loading="lazy"
              allow="accelerometer; gyroscope; encrypted-media; picture-in-picture; fullscreen"
              allowfullscreen></iframe>
    </div>`;
  startWatermark(data.viewer || stato.session?.user?.email || "");
}

// Il watermark si sposta ogni venti secondi: cambiando pagina il cronometro
// va spento, altrimenti resta a girare per tutta la sessione. Lo chiama il
// router prima di disegnare qualunque cosa.
export const fermaWatermark = () => clearInterval(wmTimer);

function mancante(msg = "Contenuto non trovato.") {
  app.innerHTML = pagina(
    `<a class="back" href="#/corsi">← Formazione</a><div class="notice">${esc(msg)}</div>`);
}
