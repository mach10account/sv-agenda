// La Formazione: catalogo dei corsi, elenco lezioni, player e calendario dei
// webinar. È l'Academy di prima, portata dentro il sito unico; le rotte
// #/corsi, #/corso/<slug> e #/lezione/<id> sono rimaste identiche perché in
// giro ci sono link già mandati ai centri — è cambiato solo il nome a schermo.

import { sb, app, stato, esc, pagina } from "./core.js?v=26";

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

// Il calendario arriva da webinar.json, copia della tabella Notion dove i
// webinar vengono programmati: si riallinea il file e si ripubblica, il
// codice non si tocca. Si legge a ogni apertura della scheda, senza ?v:
// GitHub Pages lo tiene al massimo dieci minuti, così anche una pagina
// aperta da giorni sul tablet rilegge il calendario nuovo da sola.
async function caricaWebinar() {
  const r = await fetch("webinar.json");
  if (!r.ok) throw new Error("webinar.json " + r.status);
  return (await r.json()).webinar ?? [];
}

// Nel file le date sono UTC, come le salva Notion; a schermo diventano ora
// italiana per fuso dichiarato, non per orologio del dispositivo — un tablet
// impostato male non deve spostare l'ora del webinar. È la scelta già fatta
// dall'agenda, che converte nel database.
const FUSO = "Europe/Rome";
const inRoma = (d, opz) => new Intl.DateTimeFormat("it-IT", { timeZone: FUSO, ...opz }).format(d);
const giornoRoma = (d) => new Intl.DateTimeFormat("en-CA", { timeZone: FUSO }).format(d);

// Un webinar resta "in corso" per due ore dall'inizio: chi apre la pagina a
// sessione iniziata deve ancora potersi collegare.
const finito = (w) => new Date(w.data).getTime() < Date.now() - 2 * 3600 * 1000;

// "Oggi" e "Domani" a voce, come lo si direbbe; da lì in poi il giorno della
// settimana, che per chi lavora su appuntamenti dice più del numero.
function quandoWebinar(w) {
  const d = new Date(w.data);
  const g = giornoRoma(d);
  let giorno = g === giornoRoma(new Date()) ? "Oggi"
    : g === giornoRoma(new Date(Date.now() + 86400000)) ? "Domani"
    : inRoma(d, { weekday: "short", day: "numeric" });
  giorno = giorno[0].toUpperCase() + giorno.slice(1);
  return `${giorno}, ${inRoma(d, { hour: "2-digit", minute: "2-digit" })}`;
}

function rigaWebinar(w) {
  const d = new Date(w.data);
  const passato = finito(w);

  // Il link di Streamyard è lo stesso prima e dopo: durante è la stanza,
  // a webinar finito serve la registrazione. Finché manca, bottone spento.
  const quando = passato
    ? (w.link ? "Registrazione disponibile" : "Registrazione in arrivo")
    : quandoWebinar(w);
  const testo = passato ? "Rivedi" : "Collegati";
  const classe = passato ? "btn-chiaro" : "btn-gold";
  const bottone = w.link
    ? `<a class="btn ${classe}" href="${esc(w.link)}" target="_blank" rel="noopener noreferrer">${testo}</a>`
    : `<button class="btn ${classe}" disabled>${testo}</button>`;

  return `
    <div class="wb-riga ${passato ? "finito" : ""}">
      <div class="wb-sx">
        <div class="wb-data"><b>${inRoma(d, { day: "2-digit" })}</b><span>${inRoma(d, { month: "short" })}</span></div>
        <div class="wb-info">
          <h4>${esc(w.titolo)}</h4>
          <p class="wb-quando">${quando}</p>
          ${w.argomento ? `<p class="wb-tema">${esc(w.argomento)}</p>` : ""}
        </div>
      </div>
      ${bottone}
    </div>`;
}

// Prima i prossimi in ordine di data, poi i passati dal più recente: in cima
// c'è sempre quello a cui collegarsi adesso. Dei passati se ne tengono
// cinque — è un calendario, non un archivio.
function htmlWebinar(lista) {
  const prossimi = lista.filter((w) => !finito(w)).sort((a, b) => a.data.localeCompare(b.data));
  const passati = lista.filter(finito).sort((a, b) => b.data.localeCompare(a.data)).slice(0, 5);
  const righe = [...prossimi, ...passati];
  return righe.length ? righe.map(rigaWebinar).join("")
    : `<div class="notice">Nessun webinar in calendario al momento.</div>`;
}

// --------------------------------------------------------------- catalogo

// Corsi e webinar sono due schede della stessa voce: impilati in una pagina
// sola, il calendario finiva sotto le locandine e non lo vedeva nessuno. La
// scheda scelta sta nella rotta (#/corsi/webinar), non in una variabile: così
// il tasto indietro la rispetta e il link ai webinar si può mandare com'è.
export async function mostraCorsi(vista) {
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

  const corpoCorsi = `
    ${accessible.length ? `<div class="grid">${accessible.map(card).join("")}</div>`
      : `<div class="notice">Non hai ancora corsi attivi. Scrivi al tuo consulente per l'accesso.</div>`}
    ${locked.length ? `<h2>Disponibili su richiesta</h2><div class="grid">${locked.map(card).join("")}</div>` : ""}`;

  const corpoWebinar = `
    <p class="sub">Collegati con un click, o recupera la registrazione dopo.</p>
    <div id="wb-elenco"><p class="sub">Carico il calendario…</p></div>`;

  app.innerHTML = pagina(`
    <h1>Formazione</h1>
    <p class="sub">I tuoi corsi e i webinar dal vivo</p>
    <div class="viste commuta">
      <a class="vista ${suWebinar ? "" : "attiva"}" href="#/corsi">Corsi</a>
      <a class="vista ${suWebinar ? "attiva" : ""}" href="#/corsi/webinar">Webinar</a>
    </div>
    ${suWebinar ? corpoWebinar : corpoCorsi}`);

  if (!suWebinar) return;

  // Il contenitore si prende prima dell'attesa: se si cambia scheda mentre
  // il file arriva, la scrittura tardiva cade nel vuoto, non sulla pagina
  // nuova. Stessa cura di caricaMembri nel profilo.
  const elenco = app.querySelector("#wb-elenco");
  try {
    const lista = await caricaWebinar();
    if (!elenco.isConnected) return;
    elenco.innerHTML = htmlWebinar(lista);
  } catch (_) {
    if (!elenco.isConnected) return;
    elenco.innerHTML = `<div class="notice error">Non riesco a caricare il calendario. Ricarica la pagina fra poco.</div>`;
  }
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
