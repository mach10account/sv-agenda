// Le poche cose che agenda, corsi e assistente si passano fra loro: il
// collegamento a Supabase, chi è entrato e quali sono i suoi centri.
// Tutto il resto vive dentro la sua sezione.

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

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
