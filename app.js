// Il guscio del sito: accesso, barra, rotte e profilo. Le sezioni vere stanno
// nei loro file e non si conoscono fra loro — qui si decide solo quale far
// vedere.
//
// Un centro entra una volta sola e trova tutto: l'agenda, le conversazioni
// delle clienti, i corsi e l'assistente. Le voci che compaiono dipendono da
// cosa quella persona ha davvero: chi fa solo i corsi non vede l'agenda, e
// chi sta al bancone non vede le chat della titolare.

import { sb, app, stato, esc, pagina, erroreBox } from "./core.js?v=19";
import { mostraAgenda } from "./agenda.js?v=19";
import { mostraConversazioni } from "./conversazioni.js?v=19";
import { caricaCatalogo, mostraCorsi, mostraCorso, mostraLezione, fermaWatermark } from "./academy.js?v=19";
import { mostraAssistente } from "./assistente.js?v=19";
import { mostraIntegrazioni } from "./integrazioni.js?v=19";

// Il recupero password passa da n8n, che genera il link e lo manda su WhatsApp.
const RECOVERY_WEBHOOK = "https://n8n.srv1035791.hstgr.cloud/webhook/academy-recupero";

const topbar = document.getElementById("topbar");
const barraTab = document.getElementById("tabs");
const barraServizi = document.getElementById("tabs-servizi");

// Il nome è dentro l'immagine, quindi accanto non si scrive. Ma se l'immagine
// non arriva (file mancante, rete a scatti) sparisce e il nome scritto prende
// il suo posto: un riquadro rotto in cima alla pagina è peggio di nessuna
// immagine, e una barra senza niente in cima è peggio di tutte e due.
// Sono due: quello intero per la colonna e il solo emblema per la riga. Se
// uno dei due non arriva li si spegne entrambi e torna il nome scritto — meglio
// nessuna immagine che una a metà.
document.querySelectorAll(".marchio").forEach((m) => {
  m.addEventListener("error", () => { topbar.classList.add("senza-marchio"); });
});

// Lo stesso marchio, grande, sopra le schermate di accesso. Il nome scritto
// c'e' ancora ma sta nascosto: dentro l'immagine e' gia' scritto, e ripeterlo
// sotto sarebbe un doppione. Ricompare se l'immagine non arriva — una pagina
// di accesso senza niente in cima non dice piu' dove sei.
const MARCHIO_GRANDE =
  `<img class="marchio-grande" src="logo.png?v=19" alt="Estetista Indipendente"
        onerror="this.remove(); document.querySelector('.titolo-marchio').hidden = false">
   <h1 class="titolo-marchio" hidden><b>Estetista</b><i>Indipendente</i></h1>`;

// La barra si può stringere a soli segni: in colonna si porta via 236 pixel, e
// nella vista giorno dell'agenda quei pixel sono colonne-cabina in meno. Chi
// passa la giornata sull'agenda la stringe una volta e la ritrova stretta.
const STRETTA = "sv-barra-stretta";
const bottoneStringi = document.getElementById("stringi");

function applicaLarghezzaBarra() {
  const stretta = localStorage.getItem(STRETTA) === "1";
  document.body.classList.toggle("barra-stretta", stretta);
  bottoneStringi.textContent = stretta ? "›" : "‹";
  bottoneStringi.title = stretta ? "Allarga la barra" : "Restringi la barra";
  bottoneStringi.setAttribute("aria-label", bottoneStringi.title);
}

bottoneStringi.addEventListener("click", () => {
  localStorage.setItem(STRETTA, document.body.classList.contains("barra-stretta") ? "0" : "1");
  applicaLarghezzaBarra();
  // La barra cambia larghezza, la testata dell'agenda si riflette e cambia
  // altezza: la griglia va rimisurata. Invece di chiamare dentro agenda.js si
  // annuncia il cambio a chiunque stia guardando la geometria — è lo stesso
  // segnale che arriva trascinando il bordo della finestra.
  window.dispatchEvent(new Event("resize"));
});

applicaLarghezzaBarra();

let recovering = false;   // true mentre si sta impostando la password dal link
let caricando = false;    // true mentre boot() sta ancora chiedendo centri e corsi
let pulizia = null;       // cosa spegnere uscendo dalla sezione corrente

// ------------------------------------------------------------------ sezioni

const haCorsi = () => (stato.catalogo ?? []).some((c) => c.has_access);

// Due gruppi: sopra il lavoro di ogni giorno, sotto le due voci di servizio.
// La divisione non è estetica — è quello che permette a Integrazioni e Profilo
// di stare in fondo alla colonna e di ridursi al solo segno sul telefono,
// dove le parole rubano lo spazio alle sezioni vere.
const SEZIONI = [
  { id: "agenda",        nome: "Agenda",        segno: "▤", gruppo: 1, disponibile: () => !!stato.centro },
  { id: "conversazioni", nome: "Conversazioni", segno: "✆", gruppo: 1, disponibile: () => stato.centro?.ruolo === "titolare" },
  { id: "corsi",         nome: "Corsi",         segno: "▷", gruppo: 1, disponibile: haCorsi },
  { id: "assistente",    nome: "Assistente",    segno: "✦", gruppo: 1, disponibile: haCorsi },
  { id: "integrazioni",  nome: "Integrazioni",  segno: "⚙", gruppo: 2, disponibile: () => stato.centro?.ruolo === "titolare" },
  // Profilo è l'unica voce che c'è sempre: è da lì che si esce, e chi non ha
  // ancora niente collegato deve comunque poterlo fare.
  { id: "profilo",       nome: "Profilo",       segno: "⋯", gruppo: 2, disponibile: () => !!stato.session },
];

// Corso e lezione sono figli di "Corsi": la voce da accendere è quella.
const TAB_DI = { corso: "corsi", lezione: "corsi" };

const disponibili = () => SEZIONI.filter((s) => s.disponibile());
// Le sezioni vere, senza le voci di servizio: sono queste a decidere se questa
// persona ha davvero qualcosa da guardare.
const principali = () => disponibili().filter((s) => s.gruppo === 1);

function disegnaBarra(attiva) {
  const voce = (s) => `
    <a class="tab ${s.id === attiva ? "attiva" : ""}" href="#/${s.id}"
       aria-label="${esc(s.nome)}"${s.id === attiva ? ' aria-current="page"' : ""}>
      <span class="tab-segno" aria-hidden="true">${s.segno}</span><span class="tab-nome">${esc(s.nome)}</span>
    </a>`;
  const gruppo = (n) => disponibili().filter((s) => s.gruppo === n).map(voce).join("");

  barraTab.innerHTML = gruppo(1);
  barraServizi.innerHTML = gruppo(2);

  // In riga le voci scorrono, e riscrivendole lo scorrimento riparte da zero:
  // su un telefono la voce accesa può cadere fuori dallo schermo e la barra
  // sembra non averne nessuna. La si riporta in vista, come già si fa con il
  // giorno scelto nella striscia dell'agenda.
  barraTab.querySelector(".attiva")?.scrollIntoView({ block: "nearest", inline: "center" });
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

// Nuova password: dal link di recupero, oppure dal Profilo quando si e' dentro.
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
      ${dalRecupero ? "" : `<p class="sub small"><a href="#/profilo">Annulla</a></p>`}
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

// ---------------------------------------------------------------- profilo

// Prende il posto del menu a tendina e ne eredita le tre voci: chi sei, cambia
// password, esci. Ci si sono aggiunti i dati del centro, che prima non si
// potevano cambiare da nessuna parte. Sta qui e non in un file suo perché è
// tutta roba del guscio, e un modulo in meno è un ?v= in meno da allineare.
function mostraProfilo() {
  const centro = stato.centro;
  const titolare = centro?.ruolo === "titolare";
  // Cabine e operatrici arrivano solo se c'è un centro (boot le chiede lì
  // dentro): chi ha soltanto i corsi trova stato.anagrafiche ancora a null, ed
  // è proprio la persona per cui Profilo è l'unica pagina che vede.
  const anag = stato.anagrafiche || {};
  const elenco = (titolo, righe) => (righe || []).length
    ? `<h2>${titolo}</h2><p>${righe.map((r) => esc(r.nome)).join(" · ")}</p>` : "";
  const campo = (id, etichetta, valore, extra = "") => `
    <label class="campo">
      <span>${etichetta}</span>
      <input id="c-${id}" value="${esc(valore || "")}" ${extra}>
    </label>`;

  app.innerHTML = pagina(`
    <h1>Profilo</h1>
    <p class="sub">Chi sei, i dati del centro e come esci.</p>

    <dl class="scheda-dati">
      <dt>Accesso</dt><dd>${esc(stato.session.user.email)}</dd>
      ${centro ? `<dt>Ruolo</dt><dd>${esc(centro.ruolo || "—")}</dd>
                  ${centro.apertura && centro.chiusura
                    ? `<dt>Orari</dt><dd>${esc(centro.apertura)} – ${esc(centro.chiusura)}</dd>` : ""}` : ""}
    </dl>

    ${!centro ? `<p class="sub">Il tuo accesso non è collegato a nessun centro.</p>` : `
      <h2>Il centro</h2>
      ${titolare ? `
        <form id="f-centro" class="modulo-centro">
          ${campo("nome", "Nome", centro.nome, "required maxlength='120'")}
          ${campo("citta", "Città", centro.citta, "maxlength='80'")}
          ${campo("indirizzo", "Indirizzo", centro.indirizzo, "maxlength='160'")}
          ${campo("telefono", "Telefono", centro.telefono, "maxlength='40' inputmode='tel'")}
          <div id="esito-centro"></div>
          <button class="btn" type="submit">Salva</button>
        </form>
        <p class="sub small">Gli orari di apertura li cambia il tuo consulente: da lì dipendono
           gli appuntamenti già in agenda.</p>
      ` : `
        <dl class="scheda-dati">
          <dt>Nome</dt><dd>${esc(centro.nome)}</dd>
          ${centro.citta ? `<dt>Città</dt><dd>${esc(centro.citta)}</dd>` : ""}
          ${centro.indirizzo ? `<dt>Indirizzo</dt><dd>${esc(centro.indirizzo)}</dd>` : ""}
          ${centro.telefono ? `<dt>Telefono</dt><dd>${esc(centro.telefono)}</dd>` : ""}
        </dl>
        <p class="sub small">Solo la titolare può cambiare i dati del centro.</p>
      `}

      ${titolare ? `<h2>Chi può entrare</h2><div id="membri" class="loading">Carico…</div>` : ""}
      ${elenco("Cabine", anag.cabine)}
      ${elenco("Chi lavora in cabina", anag.operatori)}
    `}

    <div class="azioni-profilo">
      <a class="btn-secondario" href="#/password">Cambia password</a>
      <button class="btn-secondario pericolo" id="esci">Esci</button>
    </div>`);

  // Il contenitore si prende adesso, prima di qualunque attesa: se si cambia
  // sezione mentre l'elenco arriva, questo è staccato dal DOM e la scrittura
  // tardiva si perde invece di comparire sopra la pagina nuova.
  const box = app.querySelector(".pagina");

  document.getElementById("esci").onclick = async () => {
    await sb.auth.signOut();
    location.hash = "#/";
    location.reload();
  };

  const modulo = box.querySelector("#f-centro");
  if (modulo) modulo.onsubmit = async (e) => {
    e.preventDefault();
    const btn = modulo.querySelector("button");
    const esito = modulo.querySelector("#esito-centro");
    const leggi = (id) => box.querySelector("#c-" + id).value;
    btn.disabled = true;
    btn.textContent = "Salvo…";
    esito.innerHTML = "";

    const { data, error } = await sb.rpc("crm_centro_salva", {
      p_centro: centro.id,
      p_nome: leggi("nome"),
      p_citta: leggi("citta"),
      p_indirizzo: leggi("indirizzo"),
      p_telefono: leggi("telefono"),
    });

    btn.disabled = false;
    btn.textContent = "Salva";
    if (error || !data?.ok) {
      esito.innerHTML = erroreBox(error?.message || data?.errore || "Non riuscito");
      return;
    }
    // Lo stato condiviso va aggiornato a mano: il centro è stato caricato
    // all'ingresso e nessuno lo rilegge finché non si ricarica la pagina.
    centro.nome = leggi("nome").trim();
    centro.citta = leggi("citta").trim() || null;
    centro.indirizzo = leggi("indirizzo").trim() || null;
    centro.telefono = leggi("telefono").trim() || null;
    esito.innerHTML = `<div class="notice">Salvato.</div>`;
  };

  if (titolare) caricaMembri(box, centro.id);
}

// Chi ha un accesso a questo centro. L'email non sta nella tabella dei membri —
// sta dove il browser non può guardare — quindi la porta una funzione apposta.
async function caricaMembri(box, centroId) {
  const { data, error } = await sb.rpc("crm_membri", { p_centro: centroId });
  const zona = box.querySelector("#membri");
  if (!zona) return;                       // sezione cambiata nel frattempo

  if (error || !data?.ok) {
    zona.className = "";
    zona.innerHTML = erroreBox(error?.message || data?.errore || "Non disponibile");
    return;
  }

  const membri = data.membri || [];
  zona.className = "membri";
  zona.innerHTML = membri.map((m) => `
    <div class="membro">
      <span class="membro-mail">${esc(m.email)}${m.io ? " (tu)" : ""}</span>
      <span class="badge-stato ${m.ruolo === "titolare" ? "on" : "off"}">${esc(m.ruolo)}</span>
    </div>`).join("")
    + `<p class="sub small">Per aggiungere o togliere una persona scrivi al tuo consulente.</p>`;
}

// ----------------------------------------------------------------- rotte

function route() {
  // Cose che restano accese quando si cambia pagina: il watermark del player
  // e il battito delle conversazioni. Si spengono qui, in un posto solo.
  fermaWatermark();
  if (pulizia) { pulizia(); pulizia = null; }

  // Pannello aperto e spostamento a metà vivono appesi al body, fuori da #app:
  // cambiando sezione resterebbero piantati sopra quella nuova. Vale anche per
  // il tasto indietro del browser, che passa di qui come ogni altra rotta.
  document.querySelectorAll(".velo").forEach((v) => v.remove());
  document.querySelector(".barra-spostamento")?.remove();
  document.body.classList.remove("in-spostamento");

  const parti = (location.hash || "#/").split("/");
  const sezione = parti[1] || "";
  const param = parti[2];

  // Il cambio password non è una sezione ma si arriva dal Profilo: la voce da
  // tenere accesa è quella, altrimenti la barra sembra non appartenere a nulla.
  if (sezione === "password") { disegnaBarra("profilo"); return renderNewPassword(false); }

  const aperte = disponibili();
  const prime = principali();

  // Senza nemmeno una sezione vera non c'è niente da guardare — ma Profilo deve
  // restare raggiungibile lo stesso: è l'unica strada per uscire.
  if (!prime.length && sezione !== "profilo") {
    disegnaBarra(null);
    app.innerHTML = `<div class="vuoto">Il tuo accesso non è ancora collegato a nulla.<br>
                     Scrivi al tuo consulente.</div>`;
    return;
  }

  // Rotta sconosciuta, o sezione a cui questa persona non ha accesso: si
  // atterra sulla prima voce che ha. Meglio una pagina utile di un errore.
  const tab = TAB_DI[sezione] || sezione;
  if (!aperte.some((s) => s.id === tab)) {
    // replace e non assegnazione all'hash: il rimbalzo deve SOSTITUIRE la rotta
    // vietata nella cronologia, non aggiungersi dopo di lei. Altrimenti il tasto
    // indietro ci rientra, viene rimbalzato di nuovo in avanti, e da lì non si
    // torna più indietro né si esce dal sito.
    location.replace(`#/${(prime[0] || { id: "profilo" }).id}`);
    return;
  }

  disegnaBarra(tab);

  if (sezione === "agenda")        pulizia = mostraAgenda();
  else if (sezione === "conversazioni") pulizia = mostraConversazioni();
  else if (sezione === "corsi")    mostraCorsi();
  else if (sezione === "corso")    mostraCorso(param);
  else if (sezione === "lezione")  mostraLezione(param);
  else if (sezione === "assistente") mostraAssistente(param, parti[3]);
  // Integrazioni e Profilo non lasciano niente acceso: nessuna pulizia da
  // restituire, a differenza di agenda e conversazioni.
  else if (sezione === "integrazioni") mostraIntegrazioni();
  else if (sezione === "profilo")  mostraProfilo();
}

// ------------------------------------------------------------------- boot

async function boot() {
  // Il link di recupero ha la precedenza su tutto: anche se c'e' gia' una
  // sessione aperta, chi arriva da li' deve poter cambiare la password.
  const [, sezione, parametro] = (location.hash || "#/").split("/");
  if (sezione === "nuova-password" && parametro) return renderTokenRecovery(parametro);

  // Se si è lasciato il link di recupero senza salvare, la parentesi si chiude
  // qui: questo boot ricarica lo stato, e dai clic successivi basta route().
  // Senza, ogni voce della barra rifarebbe da capo accesso, centri e corsi.
  recovering = false;

  const { data } = await sb.auth.getSession();
  stato.session = data.session;

  if (!stato.session) return (sezione === "recupera") ? renderRecover() : renderLogin();

  caricando = true;
  app.innerHTML = `<div class="loading">Caricamento…</div>`;

  // Il finally non è ornamentale: se una di queste chiamate solleva, `caricando`
  // resterebbe alzato e da lì in poi ogni clic sulla barra verrebbe ignorato in
  // silenzio — un sito che non risponde più, senza niente a schermo che lo dica.
  try {
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
  } finally {
    caricando = false;
  }

  topbar.hidden = false;
  route();
}

window.addEventListener("hashchange", () => {
  // Finché boot() sta ancora chiedendo centri e corsi, stato è a metà: route()
  // non troverebbe nessuna sezione e dipingerebbe "non collegato a nulla" a chi
  // ha appena fatto l'accesso. Ci pensa boot() a disegnare quando ha finito.
  if (caricando) return;
  if (!stato.session || recovering) return boot();
  route();
});

boot();
