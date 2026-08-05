// Le poche cose che agenda, corsi e assistente si passano fra loro: il
// collegamento a Supabase, chi è entrato e quali sono i suoi centri.
// Tutto il resto vive dentro la sua sezione.

// jsDelivr e non esm.sh, e una versione fissa e non "@2".
//
// Il 5/8/2026 il sito è rimasto appeso su "Caricamento…" per mezz'ora: esm.sh
// aveva pubblicato una build monca di supabase-js 2.112.1 — il modulo di
// ingresso rispondeva 200 e i suoi tre pezzi (auth, postgrest, realtime) 404.
// Un import che non si completa non solleva un errore: resta lì. Quindi niente
// login, niente pagina, niente messaggio — la schermata di attesa e basta,
// all'infinito, senza una riga in console che spiegasse perché.
//
// "@2" voleva dire "sempre l'ultima": chi decideva cosa girava sul sito delle
// titolari era chi pubblicava su npm, e la prima a saperlo era la titolare che
// non riusciva più a entrare. Adesso la versione la si cambia a mano, dopo
// averla provata. Stessa scelta già fatta su manager-stats.
import { createClient } from "https://cdn.jsdelivr.net/npm/@supabase/supabase-js@2.112.1/+esm";

export const SUPABASE_URL = "https://hypkwdvvrmakqrowbkqw.supabase.co";
export const SUPABASE_KEY = "sb_publishable_y0_DEhM-bC37jEKkiC_GGQ_TaWvPqVe";

export const sb = createClient(SUPABASE_URL, SUPABASE_KEY);

export const app = document.getElementById("app");

// Stato condiviso. Lo riempie app.js all'accesso; le sezioni lo leggono e
// basta, così non c'è modo che due parti dell'app credano cose diverse su
// chi è entrato o su che centro sta guardando.
export const stato = {
  session: null,
  centri: [],
  centro: null,      // il centro attualmente aperto
  anagrafiche: null, // cabine, operatrici, trattamenti del centro
  catalogo: null,    // corsi dell'Academy, con dentro chi ha accesso a cosa
};

export const esc = (s) => String(s ?? "").replace(/[&<>"']/g,
  (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

// Due avvisi diversi perché sono due cose diverse: "attenzione, guarda qui"
// e "non ha funzionato". Colori diversi, così si distinguono da lontano.
export const avvisoBox = (msg) => `<div class="notice">${esc(msg)}</div>`;
export const erroreBox = (msg) => `<div class="notice error">${esc(msg)}</div>`;

// Pannello a comparsa: si chiude toccando fuori.
export function pannello() {
  const velo = document.createElement("div");
  velo.className = "velo";
  velo.innerHTML = `<div class="scheda"></div>`;
  velo.onclick = (e) => { if (e.target === velo) velo.remove(); };
  document.body.appendChild(velo);
  return { velo, box: velo.querySelector(".scheda"), chiudi: () => velo.remove() };
}

// L'agenda occupa tutta la larghezza; corsi e assistente sono testo, e il
// testo va incolonnato. Questo è il contenitore delle sezioni "a pagina".
export const pagina = (html) => `<div class="pagina">${html}</div>`;
