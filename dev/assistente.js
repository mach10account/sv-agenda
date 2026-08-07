// L'assistente: una chat sui contenuti dei corsi. Risponde citando la lezione
// da cui ha preso la risposta, e le conversazioni restano salvate.
// Il cervello sta nella edge function academy-chat; qui c'è solo la bolla.

import { sb, app, stato, esc, pagina, SUPABASE_URL, SUPABASE_KEY } from "./core.js?v=28";

const CHAT_URL = `${SUPABASE_URL}/functions/v1/academy-chat`;

// La conversazione vive nel tab: sopravvive alla navigazione, muore col tab.
let chat = { id: null, msgs: [], busy: false };
try {
  const saved = JSON.parse(sessionStorage.getItem("sv_chat") || "null");
  if (saved && Array.isArray(saved.msgs)) chat = { ...saved, busy: false };
} catch (_) { /* storage corrotto: si riparte da zero */ }
if (!chat.id) chat.id = crypto.randomUUID();

const saveChat = () => {
  try {
    sessionStorage.setItem("sv_chat", JSON.stringify({ id: chat.id, msgs: chat.msgs.slice(-24) }));
  } catch (_) { /* quota storage piena: pazienza */ }
};

// Rendering della risposta: tutto escapato, poi si riabilitano SOLO i link
// alle lezioni [titolo](#/lezione/<uuid>) e il **grassetto**.
function chatHtml(text) {
  let h = esc(text);
  h = h.replace(
    /\[([^\]]+)\]\((#\/lezione\/[0-9a-f-]{36})\)/g,
    `<a href="$2">📖 $1</a>`,
  );
  h = h.replace(/\*\*([^*\n]+)\*\*/g, "<strong>$1</strong>");
  return h.replace(/\n/g, "<br>");
}

const SUGGERIMENTI = [
  "Come gestisco l'obiezione «ci devo pensare»?",
  "Cosa posso pubblicare sui social in 10 minuti al giorno?",
  "Quali numeri devo controllare ogni mese nel mio centro?",
];

// #/assistente            → conversazione corrente
// #/assistente/storico    → elenco conversazioni salvate
// #/assistente/c/<uuid>   → riapre una conversazione (e si puo' continuare)
export function mostraAssistente(sub, id) {
  if (sub === "storico") return renderChatList();
  if (sub === "c" && id) return openConversation(id);
  renderChatCurrent();
}

const quando = (s) => {
  const d = new Date(s);
  return d.toLocaleDateString("it-IT", { day: "2-digit", month: "2-digit" }) +
    " " + d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" });
};

// Tutte le conversazioni del membro (i messaggi stanno sul server: il log
// della edge function e' la fonte di verita', qui si legge soltanto).
async function renderChatList() {
  app.innerHTML = pagina(`
    <a class="back" href="#/assistente">← Assistente</a>
    <h1>Le tue conversazioni</h1>
    <div class="loading">Carico lo storico…</div>`);

  const { data, error } = await sb.rpc("academy_chat_conversations");
  if (error) {
    app.querySelector(".loading").outerHTML =
      `<div class="notice error">Non riesco a caricare lo storico: ${esc(error.message)}</div>`;
    return;
  }

  const rows = (data ?? []).map((c) => `
    <a class="lesson" href="#/assistente/c/${esc(c.id)}">
      <span class="n">💬</span>
      <span class="t">${esc(c.titolo || "(senza titolo)")}
        <span class="conv-meta">${quando(c.last_at)} · ${c.domande} domand${c.domande === 1 ? "a" : "e"}</span>
      </span>
    </a>`).join("");

  app.innerHTML = pagina(`
    <a class="back" href="#/assistente">← Assistente</a>
    <h1>Le tue conversazioni</h1>
    <p class="sub">Tocca una conversazione per rileggerla o continuarla.</p>
    ${rows ? `<div class="lessons">${rows}</div>`
      : `<div class="notice">Non hai ancora conversazioni salvate.</div>`}`);
}

async function openConversation(id) {
  app.innerHTML = pagina(`<div class="loading">Riapro la conversazione…</div>`);
  const { data, error } = await sb.rpc("academy_chat_history", { p_conversation: id });
  if (error || !Array.isArray(data) || !data.length) {
    app.innerHTML = pagina(`
      <a class="back" href="#/assistente/storico">← Le tue conversazioni</a>
      <div class="notice">Conversazione non trovata.</div>`);
    return;
  }
  chat = { id, msgs: data.map((m) => ({ role: m.role, content: m.content })), busy: false };
  saveChat();
  renderChatCurrent();
}

function renderChatCurrent() {
  const bubbles = chat.msgs.map((m) =>
    `<div class="msg ${m.role === "user" ? "user" : "ai"}">${m.role === "user" ? esc(m.content) : chatHtml(m.content)}</div>`,
  ).join("");

  app.innerHTML = pagina(`
    <h1>Assistente</h1>
    <p class="sub">Fammi una domanda sui contenuti dei corsi: ti rispondo citando la lezione giusta.</p>
    <div class="chat-nav">
      <a href="#/assistente/storico">🕘 Conversazioni precedenti</a>
      ${chat.msgs.length ? `<button id="new-chat" type="button">＋ Nuova conversazione</button>` : ""}
    </div>
    <div class="chat">
      <div id="msgs" class="chat-msgs">
        ${bubbles || ""}
        ${chat.msgs.length ? "" : `
          <div class="chat-suggest">
            ${SUGGERIMENTI.map((s) => `<button type="button" data-q="${esc(s)}">${esc(s)}</button>`).join("")}
          </div>`}
      </div>
      <div id="chat-status" class="chat-status" hidden></div>
      <form id="chat-form" class="chat-form">
        <input id="chat-input" type="text" maxlength="2000" autocomplete="off"
               placeholder="Scrivi la tua domanda…">
        <button class="btn" type="submit">Invia</button>
      </form>
    </div>`);

  const form = document.getElementById("chat-form");
  const input = document.getElementById("chat-input");
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    const q = input.value.trim();
    if (q && !chat.busy) { input.value = ""; sendChat(q); }
  });
  app.querySelectorAll(".chat-suggest button").forEach((b) =>
    b.addEventListener("click", () => { if (!chat.busy) sendChat(b.dataset.q); }));

  document.getElementById("new-chat")?.addEventListener("click", () => {
    chat = { id: crypto.randomUUID(), msgs: [], busy: false };
    saveChat();
    if (location.hash !== "#/assistente") location.hash = "#/assistente";
    else renderChatCurrent();
  });

  scrollChat();
}

const scrollChat = () => {
  const el = document.getElementById("msgs");
  if (el) window.scrollTo(0, document.body.scrollHeight);
};

function setChatBusy(busy) {
  chat.busy = busy;
  const input = document.getElementById("chat-input");
  const btn = document.querySelector("#chat-form button");
  if (input) input.disabled = busy;
  if (btn) { btn.disabled = busy; btn.textContent = busy ? "…" : "Invia"; }
}

async function sendChat(question) {
  const msgs = document.getElementById("msgs");
  const status = document.getElementById("chat-status");
  if (!msgs) return;

  // la history da mandare NON include la domanda corrente
  const history = chat.msgs.slice(-8).map((m) => ({ role: m.role, content: m.content }));

  chat.msgs.push({ role: "user", content: question });
  saveChat();
  msgs.querySelector(".chat-suggest")?.remove();
  msgs.insertAdjacentHTML("beforeend", `<div class="msg user">${esc(question)}</div>`);

  // Riferimento diretto alla bolla, MAI per id: con piu' domande nella stessa
  // pagina un id duplicato farebbe finire la risposta nella bolla precedente.
  const live = document.createElement("div");
  live.className = "msg ai";
  live.innerHTML = `<span class="dots">Ci penso…</span>`;
  msgs.appendChild(live);
  setChatBusy(true);
  scrollChat();
  let answer = "";
  const showStatus = (text) => {
    if (!status) return;
    status.hidden = !text;
    status.textContent = text || "";
  };

  try {
    const res = await fetch(CHAT_URL, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "authorization": `Bearer ${stato.session.access_token}`,
        "apikey": SUPABASE_KEY,
      },
      body: JSON.stringify({ message: question, history, conversationId: chat.id }),
    });

    if (!res.ok || !(res.headers.get("content-type") || "").includes("text/event-stream")) {
      const err = await res.json().catch(() => ({}));
      const msg = res.status === 429
        ? "Hai finito le domande per oggi: la quota si rinnova domani. Se ti serve altro, scrivi al tuo consulente."
        : "Non riesco a risponderti in questo momento. Riprova tra poco.";
      console.error("academy-chat", res.status, err);
      live.innerHTML = chatHtml(msg);
      chat.msgs.push({ role: "assistant", content: msg });
      saveChat();
      return;
    }

    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const events = buf.split("\n\n");
      buf = events.pop() || "";
      for (const evt of events) {
        const lines = evt.split("\n");
        const name = (lines.find((l) => l.startsWith("event: ")) || "").slice(7);
        const dataLine = lines.find((l) => l.startsWith("data: "));
        if (!dataLine) continue;
        let d = {};
        try { d = JSON.parse(dataLine.slice(6)); } catch (_) { continue; }

        if (name === "delta" && d.text) {
          answer += d.text;
          showStatus("");
          live.innerHTML = chatHtml(answer);
          scrollChat();
        } else if (name === "status" && d.type === "reading") {
          showStatus(`📖 Sto leggendo: ${d.title}`);
        } else if (name === "error") {
          answer = answer || d.message || "Qualcosa è andato storto, riprova.";
          live.innerHTML = chatHtml(answer);
        }
      }
    }

    if (!answer) answer = "Non sono riuscito a produrre una risposta, riprova.";
    chat.msgs.push({ role: "assistant", content: answer });
    saveChat();
  } catch (e) {
    console.error("academy-chat", e);
    const msg = "Connessione interrotta. Controlla la rete e riprova.";
    if (live) live.innerHTML = chatHtml(answer ? answer + "\n\n" + msg : msg);
    chat.msgs.push({ role: "assistant", content: answer || msg });
    saveChat();
  } finally {
    showStatus("");
    setChatBusy(false);
    scrollChat();
  }
}
