// Le chat delle clienti col bot, e in cima una conversazione di prova che
// parla solo dentro il gestionale: serve a farsi un'idea del tono e delle
// disponibilità proposte senza passare da WhatsApp.
//
// Qui è una tab e non più un pannello: è un posto dove la titolare torna, e
// una chat dentro una finestrella sopra l'agenda non si legge.

import { sb, app, stato, esc, erroreBox, SUPABASE_URL, SUPABASE_KEY } from "./core.js?v=15";

const PROVA_FINTA = { id: null, prova: true, nome: "Prova il bot", stato: "bot" };

function quandoBreve(iso) {
  if (!iso) return "";
  const d = new Date(iso);
  const adesso = new Date();
  const stessoGiorno = d.toDateString() === adesso.toDateString();
  return stessoGiorno
    ? d.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit" })
    : d.toLocaleDateString("it-IT", { day: "numeric", month: "short" });
}

export function mostraConversazioni() {
  app.innerHTML = `<div class="wa-schermo" id="wa-schermo">
                     <p class="loading">Carico le conversazioni…</p>
                   </div>`;
  const box = document.getElementById("wa-schermo");

  let lista = [];
  let apertaId = null;
  let aperta = null;
  let inviando = false;
  let vuoiFocus = false;   // rimettere il cursore nel campo dopo un invio
  let battito = null;

  ricarica();
  // Se arriva un messaggio mentre la sezione è aperta deve comparire da solo:
  // una chat che si aggiorna solo ricaricando la pagina non sembra viva.
  battito = setInterval(() => { if (!inviando) ricarica(true); }, 15000);

  async function ricarica(silenzioso = false) {
    const { data, error } = await sb.rpc("crm_wa_conversazioni", { p_centro: stato.centro.id });
    if (error || !data?.ok) {
      if (silenzioso) return;
      box.innerHTML = erroreBox(error?.message || data?.errore || "Non disponibile");
      return;
    }
    lista = data.conversazioni || [];
    if (!lista.some((c) => c.prova)) lista.unshift({ ...PROVA_FINTA });
    else lista.sort((a, b) => (b.prova ? 1 : 0) - (a.prova ? 1 : 0));

    if (apertaId && !lista.some((c) => c.id === apertaId)) apertaId = null;
    if (!apertaId && !silenzioso) apertaId = lista[0]?.id ?? null;

    if (apertaId) await caricaThread(apertaId, true);
    disegna();
  }

  async function caricaThread(id, silenzioso = false) {
    const { data, error } = await sb.rpc("crm_wa_messaggi", { p_conversation: id });
    if (error || !data?.ok) {
      aperta = { errore: error?.message || data?.errore || "Non disponibile", messaggi: [] };
      return;
    }
    aperta = data;
    if (!silenzioso) disegna();
  }

  function disegna(messaggio = "") {
    const sel = lista.find((c) => (c.id ?? null) === apertaId) || lista[0] || null;
    const inProva = !!sel?.prova;
    // La sezione si ridisegna anche a ogni battito: quello che stava
    // scrivendo, e il fatto che stesse scrivendo, vanno riportati dentro.
    const bozza = box.querySelector("#wa-testo")?.value ?? "";
    const scriveva = document.activeElement?.id === "wa-testo";

    box.innerHTML = `
      ${messaggio ? erroreBox(messaggio) : ""}
      <div class="wa-corpo ${apertaId || inProva ? "apri-thread" : ""}">
        <aside class="wa-lista">
          ${lista.map((c) => `
            <button class="wa-voce ${(c.id ?? null) === apertaId ? "attiva" : ""} ${c.prova ? "prova" : ""}"
                    data-id="${c.id ?? ""}">
              <span class="wa-voce-testa">
                <strong>${esc(c.nome)}</strong>
                <span class="wa-quando">${c.prova ? "prova" : esc(quandoBreve(c.quando))}</span>
              </span>
              <span class="wa-ultimo">${c.ultimo
                ? (c.ultimo_da === "out" ? "↩ " : "") + esc(String(c.ultimo).slice(0, 70))
                : "<em>Scrivi qui per provare il bot</em>"}</span>
              ${c.stato === "umano" && !c.prova ? `<span class="wa-tag">rispondi tu</span>` : ""}
            </button>`).join("")}
        </aside>

        <section class="wa-thread">
          ${sel ? `
            <div class="wa-thread-testa">
              <button class="wa-indietro" title="Torna all'elenco">‹</button>
              <strong>${esc(sel.nome)}</strong>
              ${sel.prova ? `
                <button class="btn-mini" id="wa-azzera">Ricomincia</button>
              ` : `
                <button class="btn-mini" id="wa-passa">
                  ${aperta?.stato === "umano" ? "Riattiva il bot" : "Rispondo io"}
                </button>`}
            </div>
            ${sel.prova ? `<p class="wa-nota">Questa chat vive solo qui dentro: il bot risponde
                            come farebbe su WhatsApp, usando davvero la tua agenda.</p>` : ""}
            ${aperta?.stato === "umano" && !sel.prova
              ? `<p class="wa-nota">Il bot e' in pausa su questa chat: rispondi dal tuo telefono.</p>` : ""}
            <div class="wa-messaggi" id="wa-messaggi">
              ${aperta?.errore ? erroreBox(aperta.errore) : ""}
              ${(aperta?.messaggi || []).map((m) => `
                <div class="wa-bolla ${m.da === "in" ? "in" : "out"}">
                  ${esc(m.testo)}
                  <span class="wa-ora">${esc(quandoBreve(m.quando))}${m.dal_telefono ? " · dal telefono" : ""}</span>
                </div>`).join("")}
              ${!aperta?.messaggi?.length && !aperta?.errore
                ? `<p class="wa-vuoto">${sel.prova ? "Scrivi come farebbe una cliente." : "Nessun messaggio."}</p>` : ""}
            </div>
            ${sel.prova ? `
              <form class="wa-scrivi" id="wa-form">
                <input id="wa-testo" placeholder="Ciao, vorrei prenotare…" autocomplete="off">
                <button class="btn" id="wa-invia">Invia</button>
              </form>` : ""}
          ` : `<p class="wa-vuoto">Nessuna conversazione.</p>`}
        </section>
      </div>`;

    const campo = box.querySelector("#wa-testo");
    if (campo) {
      campo.value = bozza;
      if (scriveva || bozza || vuoiFocus) campo.focus();
    }
    vuoiFocus = false;

    const messaggi = box.querySelector("#wa-messaggi");
    if (messaggi) messaggi.scrollTop = messaggi.scrollHeight;

    box.querySelectorAll(".wa-voce").forEach((b) => {
      b.onclick = async () => {
        apertaId = b.dataset.id || null;
        aperta = apertaId ? null : { messaggi: [] };
        if (apertaId) await caricaThread(apertaId, true);
        vuoiFocus = b.classList.contains("prova");
        disegna();
      };
    });

    const indietro = box.querySelector(".wa-indietro");
    if (indietro) indietro.onclick = () => {
      box.querySelector(".wa-corpo").classList.remove("apri-thread");
    };

    const passa = box.querySelector("#wa-passa");
    if (passa) passa.onclick = async () => {
      const nuovo = aperta?.stato === "umano" ? "bot" : "umano";
      passa.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_chat_stato", {
        p_conversation: apertaId, p_stato: nuovo,
      });
      if (error || !data?.ok) return disegna(error?.message || data?.errore || "Non riuscito");
      await ricarica(true);
    };

    const azzera = box.querySelector("#wa-azzera");
    if (azzera) azzera.onclick = async () => {
      azzera.disabled = true;
      const { data, error } = await sb.rpc("crm_wa_prova_azzera", { p_centro: stato.centro.id });
      if (error || !data?.ok) return disegna(error?.message || data?.errore || "Non riuscito");
      aperta = { messaggi: [], stato: "bot" };
      await ricarica(true);
    };

    const form = box.querySelector("#wa-form");
    if (form) form.onsubmit = (e) => { e.preventDefault(); invia(); };
  }

  async function invia() {
    const campo = box.querySelector("#wa-testo");
    const testo = (campo?.value ?? "").trim();
    if (!testo || inviando) return;
    inviando = true;
    campo.value = "";

    // Si mostra subito quello che ha scritto lei e un segnaposto: la risposta
    // richiede qualche secondo e il silenzio sembrerebbe un blocco.
    const zona = box.querySelector("#wa-messaggi");
    zona.querySelector(".wa-vuoto")?.remove();
    zona.insertAdjacentHTML("beforeend",
      `<div class="wa-bolla in">${esc(testo)}</div>
       <div class="wa-bolla out attesa" id="wa-attesa"><span></span><span></span><span></span></div>`);
    zona.scrollTop = zona.scrollHeight;

    try {
      const { data: { session: sess } } = await sb.auth.getSession();
      const res = await fetch(`${SUPABASE_URL}/functions/v1/wa-inbound`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "x-prova": "1",
          apikey: SUPABASE_KEY,
          authorization: `Bearer ${sess.access_token}`,
        },
        body: JSON.stringify({ centro_id: stato.centro.id, testo }),
      });
      const esito = await res.json().catch(() => ({}));
      inviando = false;
      if (!esito?.ok) {
        apertaId = esito?.conversation_id ?? apertaId;
        return disegna(esito?.errore || "Il bot non ha risposto");
      }
      apertaId = esito.conversation_id;
      vuoiFocus = true;
      await ricarica(true);
    } catch (e) {
      inviando = false;
      disegna(String(e.message || e));
    }
  }

  // Uscendo dalla tab il battito va spento: altrimenti continuerebbe a
  // chiedere messaggi mentre si guarda l'agenda.
  return () => clearInterval(battito);
}
