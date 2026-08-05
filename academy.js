// I corsi: catalogo, elenco lezioni e player. È l'Academy di prima, portata
// dentro il sito unico; le rotte #/corso/<slug> e #/lezione/<id> sono rimaste
// identiche perché in giro ci sono link già mandati ai centri.

import { sb, app, stato, esc, pagina } from "./core.js?v=19";

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

// --------------------------------------------------------------- catalogo

export function mostraCorsi() {
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

  app.innerHTML = pagina(`
    <h1>I tuoi corsi</h1>
    <p class="sub">La tua formazione</p>
    ${accessible.length ? `<div class="grid">${accessible.map(card).join("")}</div>`
      : `<div class="notice">Non hai ancora corsi attivi. Scrivi al tuo consulente per l'accesso.</div>`}
    ${locked.length ? `<h2>Disponibili su richiesta</h2><div class="grid">${locked.map(card).join("")}</div>` : ""}`);
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
    <a class="back" href="#/corsi">← Tutti i corsi</a>
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
    `<a class="back" href="#/corsi">← Tutti i corsi</a><div class="notice">${esc(msg)}</div>`);
}
