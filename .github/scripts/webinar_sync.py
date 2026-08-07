# Riallinea dev/webinar.json alla lista scaricata dal webhook n8n
# (in /tmp/webinar-nuovo.json). Scrive il file SOLO se il calendario è
# davvero cambiato, così i commit e le ripubblicazioni di Pages restano
# rare quanto i webinar. Esito in GITHUB_OUTPUT: changed=true/false.
import json
import os
import pathlib
from datetime import datetime, timezone

nuovo = json.load(open("/tmp/webinar-nuovo.json"))
lista = nuovo.get("webinar")
if not isinstance(lista, list):
    raise SystemExit("risposta n8n senza lista 'webinar'")

percorso = pathlib.Path("dev/webinar.json")
esistente = json.loads(percorso.read_text()).get("webinar", []) if percorso.exists() else []


def proietta(voci):
    # Confronto su ciò che il sito mostra davvero, così l'ordine delle
    # chiavi o il campo "aggiornato" non contano come differenze.
    return [
        [v.get("data"), v.get("titolo"), v.get("argomento") or "", v.get("link") or ""]
        for v in voci
    ]


if not lista and esistente:
    # Zero webinar da Notion con un file pieno somiglia più a un guasto che
    # a una scelta: meglio un calendario vecchio di uno svuotato per sbaglio.
    print("Notion ha risposto con zero webinar ma il file ne ha: non tocco nulla.")
    cambiato = False
elif proietta(lista) == proietta(esistente):
    print("Nessuna differenza col calendario pubblicato.")
    cambiato = False
else:
    contenuto = {
        "fonte": "Tabella Notion 🎥 WEBINAR — questo file ne è la copia pubblicata",
        "aggiornato": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
        "webinar": lista,
    }
    percorso.write_text(json.dumps(contenuto, ensure_ascii=False, indent=2) + "\n")
    print(f"Calendario riallineato: {len(lista)} webinar.")
    cambiato = True

with open(os.environ["GITHUB_OUTPUT"], "a") as f:
    f.write(f"changed={'true' if cambiato else 'false'}\n")
