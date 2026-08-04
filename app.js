// Il guscio del sito: accesso, tab e menu. Le sezioni vere stanno nei loro
// file e non si conoscono fra loro — qui si decide solo quale far vedere.
//
// Un centro entra una volta sola e trova tutto: l'agenda, le conversazioni
// delle clienti, i corsi e l'assistente. Le tab che compaiono dipendono da
// cosa quella persona ha davvero: chi fa solo i corsi non vede l'agenda, e
// chi sta al bancone non vede le chat della titolare.

import { sb, app, stato, esc } from "./core.js?v=14";
import { mostraAgenda } from "./agenda.js?v=14";
import { mostraConversazioni } from "./conversazioni.js?v=14";
import { caricaCatalogo, mostraCorsi, mostraCorso, mostraLezione, fermaWatermark } from "./academy.js?v=14";
import { mostraAssistente } from "./assistente.js?v=14";
import { apriIntegrazioni } from "./integrazioni.js?v=14";

// Il recupero password passa da n8n, che genera il link e lo manda su WhatsApp.
const RECOVERY_WEBHOOK = "https://n8n.srv1035791.hstgr.cloud/webhook/academy-recupero";

const topbar = document.getElementById("topbar");
const barraTab = document.getElementById("tabs");
const bottoneMenu = document.getElementById("menu");
const menu = document.getElementById("menu-voci");

// Il logo è un'immagine, il nome accanto è testo. Se l'immagine non arriva
// (file mancante, rete a scatti) sparisce e resta il nome: un riquadro rotto
// in cima alla pagina è peggio di nessuna immagine.
const marchio = document.getElementById("marchio");
marchio.addEventListener("error", () => { marchio.hidden = true; });

// Lo stesso marchio, grande, sopra le schermate di accesso.
const MARCHIO_GRANDE =
  `<img class="marchio-grande" src="logo.png?v=14" alt="Estetista Indipendente"
        onerror="this.remove()">
   <h1 class="titolo-marchio"><b>Estetista</b><i>Indipendente</i></h1>`;

let recovering = false;   // true mentre si sta impostando la password dal link
let pulizia = null;       // cosa spegnere uscendo dalla sezione corrente

// ------------------------------------------------------------------ sezioni

const haCorsi = () => (stato.catalogo ?? []).some((c) => c.has_access);

const SEZIONI = [
  { id: "agenda",        nome: "Agenda",        disponibile: () => !!stato.centro },
  { id: "conversazioni", nome: "Conversazioni", disponibile: () => stato.centro?.ruolo === "titolare" },
  { id: "corsi",         nome: "Corsi",         disponibile: haCorsi },
  { id: "assistente",    nome: "Assistente",    disponibile: haCorsi },
];

// Corso e lezione sono figli di "Corsi": la tab da accendere è quella.
const TAB_DI = { corso: "corsi", lezione: "corsi" };

const disponibili = () => SEZIONI.filter((s) => s.disponibile());

function disegnaTab(attiva) {
  barraTab.innerHTML = disponibili().map((s) => `
    <a class="tab ${s.id === attiva ? "attiva" : ""}" href="#/${s.id}">${esc(s.nome)}</a>`).join("");
}

// --------------------------------------------------------------- accesso

function renderLogin(messaggio = "") {
  topbar.hidden = true;
  app.innerHTML = `
    <div class="login">
      ${MARCHIO_GRANDE}
      <p class="sub">Accedi con le credenziali del tuo centro.</p>
      ${messaggio}
      <form id="f">
        <input id="email" type="email" required placeholder="email@centro.it" autocomplete="email">
        <input id="password" type="password" required placeholder="Password" autocomplete="current-password">
        <button class="btn btn-wide" type="submit">Entra</button>
      </form>
      <p class="sub small"><a href="#/recupera">Ho dimenticato la password</a></p>
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
      const msg = /invalid login/i.test(error.message)
        ? "Email o password non corretti."
        : esc(error.message);
      renderLogin(`<div class="notice error">${msg}</div>`);
      return;
    }
    location.hash = "#/";
    boot();
  });
}

// Richiesta del link di recupero: parte su WhatsApp, non via email.
// La risposta e' sempre la stessa, che il numero esista o no.
function renderRecover() {
  topbar.hidden = true;
  app.innerHTML = `
    <div class="login">
      ${MARCHIO_GRANDE}
      <h1>Password dimenticata</h1>
      <p class="sub">Scrivi la tua email oppure il numero di telefono:<br>
         ti mandiamo il link su WhatsApp.</p>
      <form id="f">
        <input id="identifier" type="text" required placeholder="email@centro.it oppure 347 1234567"
               autocomplete="username" inputmode="email">
        <button class="btn btn-wide" type="submit">Mandami il link</button>
      </form>
      <p class="sub small"><a href="#/">Torna all'accesso</a></p>
    </div>`;

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const btn = e.target.querySelector("button");
    const identifier = document.getElementById("identifier").value.trim();
    btn.disabled = true;
    btn.textContent = "Invio…";

    try {
      await fetch(RECOVERY_WEBHOOK, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ identifier }),
      });
    } catch (_) {
      // Anche se la chiamata non riesce mostriamo lo stesso messaggio: chi
      // prova numeri a caso non deve capire nulla dalla risposta.
    }

    app.innerHTML = `
      <div class="login">
        ${MARCHIO_GRANDE}
        <h1>Controlla WhatsApp</h1>
        <p class="sub">Se il recapito è registrato, ti arriva un messaggio col link
           per impostare la nuova password.</p>
        <p class="sub small">Non ti arriva niente? Scrivi al tuo consulente.<br>
           <a href="#/">Torna all'accesso</a></p>
      </div>`;
  });
}

// Si arriva qui dal link WhatsApp: #/nuova-password/<token>.
// Il token viene verificato adesso, in pagina. E' il motivo per cui il link
// sopravvive all'anteprima di WhatsApp: aprire questo indirizzo non consuma
// nulla finche' non e' il browser del destinatario a farlo.
async function renderTokenRecovery(tokenHash) {
  topbar.hidden = true;
  app.innerHTML = `<div class="loading">Verifico il link…</div>`;

  const { data, error } = await sb.auth.verifyOtp({ token_hash: tokenHash, type: "recovery" });

  if (error || !data?.session) {
    app.innerHTML = `
      <div class="login">
        <h1>Link non più valido</h1>
        <p class="sub">I link durano un'ora e si possono usare una volta sola.<br>
           Chiedine un altro, oppure scrivi al tuo consulente.</p>
        <p class="sub small"><a href="#/recupera">Richiedi un nuovo link</a></p>
      </div>`;
    return;
  }

  stato.session = data.session;
  recovering = true;
  renderNewPassword(true);
}

// Nuova password: dal link di recupero, oppure dal menu quando si e' dentro.
function renderNewPassword(dalRecupero) {
  topbar.hidden = !stato.session || dalRecupero;
  app.innerHTML = `
    <div class="login">
      <h1>${dalRecupero ? "Imposta la password" : "Cambia password"}</h1>
      <p class="sub">Almeno 8 caratteri.</p>
      <form id="f">
        <input id="p1" type="password" required minlength="8" placeholder="Nuova password" autocomplete="new-password">
        <input id="p2" type="password" required minlength="8" placeholder="Ripeti la password" autocomplete="new-password">
        <button class="btn btn-wide" type="submit">Salva</button>
      </form>
      ${dalRecupero ? "" : `<p class="sub small"><a href="#/">Annulla</a></p>`}
    </div>`;

  document.getElementById("f").addEventListener("submit", async (e) => {
    e.preventDefault();
    const p1 = document.getElementById("p1").value;
    const p2 = document.getElementById("p2").value;
    const btn = e.target.querySelector("button");

    if (p1 !== p2) {
      app.querySelector(".sub").innerHTML = `<span style="color:#8d2b25">Le due password non coincidono.</span>`;
      return;
    }
    btn.disabled = true;
    btn.textContent = "Salvo…";

    const { error } = await sb.auth.updateUser({ password: p1 });
    if (error) {
      btn.disabled = false;
      btn.textContent = "Riprova";
      app.querySelector(".sub").innerHTML = `<span style="color:#8d2b25">${esc(error.message)}</span>`;
      return;
    }
    recovering = false;
    location.hash = "#/";
    boot();
  });
}

// ------------------------------------------------------------------- menu

function disegnaMenu() {
  const titolare = stato.centro?.ruolo === "titolare";
  // Sul telefono il nome del centro mangia lo spazio delle tab: resta solo
  // il segno del menu. Chi lo tocca vede comunque nome ed email dentro.
  bottoneMenu.innerHTML =
    `<span class="menu-nome">${esc(stato.centro?.nome || stato.session.user.email)} ⌄</span>
     <span class="menu-segno">⋯</span>`;
  menu.innerHTML = `
    <span class="menu-chi">${esc(stato.session.user.email)}</span>
    ${titolare ? `<button data-voce="integrazioni">Integrazioni</button>` : ""}
    <button data-voce="password">Cambia password</button>
    <button data-voce="esci">Esci</button>`;

  menu.querySelectorAll("button").forEach((b) => {
    b.onclick = async () => {
      menu.hidden = true;
      if (b.dataset.voce === "integrazioni") return apriIntegrazioni();
      if (b.dataset.voce === "password") { location.hash = "#/password"; return; }
      await sb.auth.signOut();
      location.hash = "#/";
      location.reload();
    };
  });
}

bottoneMenu.addEventListener("click", (e) => {
  e.stopPropagation();
  menu.hidden = !menu.hidden;
});
document.addEventListener("click", (e) => {
  if (!menu.hidden && !menu.contains(e.target)) menu.hidden = true;
});

// ----------------------------------------------------------------- rotte

function route() {
  // Cose che restano accese quando si cambia pagina: il watermark del player
  // e il battito delle conversazioni. Si spengono qui, in un posto solo.
  fermaWatermark();
  if (pulizia) { pulizia(); pulizia = null; }
  menu.hidden = true;

  const parti = (location.hash || "#/").split("/");
  const sezione = parti[1] || "";
  const param = parti[2];

  if (sezione === "password") { disegnaTab(null); return renderNewPassword(false); }

  const aperte = disponibili();
  if (!aperte.length) {
    disegnaTab(null);
    app.innerHTML = `<div class="vuoto">Il tuo accesso non è ancora collegato a nulla.<br>
                     Scrivi al tuo consulente.</div>`;
    return;
  }

  // Rotta sconosciuta, o sezione a cui questa persona non ha accesso: si
  // atterra sulla prima tab che ha. Meglio una pagina utile di un errore.
  const tab = TAB_DI[sezione] || sezione;
  if (!aperte.some((s) => s.id === tab)) {
    location.hash = `#/${aperte[0].id}`;
    return;
  }

  disegnaTab(tab);

  if (sezione === "agenda")        pulizia = mostraAgenda();
  else if (sezione === "conversazioni") pulizia = mostraConversazioni();
  else if (sezione === "corsi")    mostraCorsi();
  else if (sezione === "corso")    mostraCorso(param);
  else if (sezione === "lezione")  mostraLezione(param);
  else if (sezione === "assistente") mostraAssistente(param, parti[3]);
}

// ------------------------------------------------------------------- boot

async function boot() {
  // Il link di recupero ha la precedenza su tutto: anche se c'e' gia' una
  // sessione aperta, chi arriva da li' deve poter cambiare la password.
  const [, sezione, parametro] = (location.hash || "#/").split("/");
  if (sezione === "nuova-password" && parametro) return renderTokenRecovery(parametro);

  const { data } = await sb.auth.getSession();
  stato.session = data.session;

  if (!stato.session) return (sezione === "recupera") ? renderRecover() : renderLogin();

  app.innerHTML = `<div class="loading">Caricamento…</div>`;

  // Centri e corsi si chiedono insieme: sono due domande indipendenti e
  // aspettarle in fila raddoppierebbe l'attesa all'ingresso.
  const [centriRes] = await Promise.all([
    sb.rpc("crm_miei_centri"),
    caricaCatalogo(),
  ]);

  stato.centri = centriRes.data || [];
  stato.centro = stato.centri[0] || null;   // con piu' centri, in futuro qui va un selettore

  if (stato.centro) {
    // Cabine, operatrici e trattamenti cambiano di rado: si caricano una volta.
    const { data: anag } = await sb.rpc("crm_anagrafiche", { p_centro: stato.centro.id });
    stato.anagrafiche = anag || { cabine: [], operatori: [], trattamenti: [] };
  }

  topbar.hidden = false;
  disegnaMenu();
  route();
}

window.addEventListener("hashchange", () => {
  if (!stato.session || recovering) return boot();
  route();
});

boot();
