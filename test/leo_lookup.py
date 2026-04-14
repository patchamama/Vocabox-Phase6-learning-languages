#!/usr/bin/env python3
"""
leo_lookup.py — Busca palabras en LEO Diccionario (Alemán ↔ Español)

Uso:
    python leo_lookup.py <palabra> [opciones]

Opciones:
    --results N     Número de resultados (default: 3)
    --lp PAIR       Par de idiomas: esde (default), ende, frde, itde, ptde
    --html          Genera también un archivo HTML
    --only-html     Solo genera HTML, sin imprimir JSON en stdout
    --output FILE   Nombre del archivo HTML (default: leo_<palabra>.html)

Ejemplos:
    python leo_lookup.py verantwortlich
    python leo_lookup.py Haus --html
    python leo_lookup.py gehen --only-html --output gehen.html
    python leo_lookup.py casa --lp esde --results 5
"""

import sys
import re
import json
import argparse
import urllib.request
import urllib.parse
from xml.etree import ElementTree as ET


# ─────────────────────────────────────────────────────────────────
# Configuración
# ─────────────────────────────────────────────────────────────────

AUDIO_BASE = "https://dict.leo.org/media/audio/{file_id}.mp3"

LANG_PAIRS = {
    "esde": ("alem%C3%A1n-espa%C3%B1ol", {"es": "Español",   "de": "Alemán"}),
    "ende": ("englisch-deutsch",          {"en": "Inglés",    "de": "Alemán"}),
    "frde": ("franz%C3%B6sisch-deutsch",  {"fr": "Francés",   "de": "Alemán"}),
    "itde": ("italienisch-deutsch",       {"it": "Italiano",  "de": "Alemán"}),
    "ptde": ("portugiesisch-deutsch",     {"pt": "Portugués", "de": "Alemán"}),
}

CAT_LABELS = {
    "noun":      "Sustantivo",
    "verb":      "Verbo",
    "adjective": "Adjetivo / Adverbio",
    "phrase":    "Frase",
    "prep":      "Preposición",
}

HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) "
        "AppleWebKit/537.36 (KHTML, like Gecko) "
        "Chrome/124.0.0.0 Safari/537.36"
    ),
    "Accept-Language": "es-ES,es;q=0.9",
}


# ─────────────────────────────────────────────────────────────────
# Fetching y parseo
# ─────────────────────────────────────────────────────────────────

def fetch_html(word: str, lp: str) -> str:
    """Descarga el HTML de la página de resultados de LEO."""
    path, _ = LANG_PAIRS[lp]
    encoded = urllib.parse.quote(word, safe="")
    url = f"https://dict.leo.org/{path}/{encoded}"
    req = urllib.request.Request(url, headers=HEADERS)
    with urllib.request.urlopen(req, timeout=15) as resp:
        return resp.read().decode("utf-8", errors="replace")


def extract_xml(html: str) -> str:
    """Extrae el bloque XML embebido en el <script> de la página."""
    pattern = (
        r"<script[^>]*>\s*"
        r"(<xml[^>]+leorendertarget[^>]+>[\s\S]*?</xml>)"
        r"\s*</script>"
    )
    m = re.search(pattern, html)
    if not m:
        raise ValueError("No se encontró el bloque XML en la página de LEO.")
    return m.group(1)


def parse_entries(xml_str: str, max_results: int) -> list:
    """Parsea el XML y devuelve una lista de entradas estructuradas."""
    root = ET.fromstring(xml_str)
    results = []

    for section in root.iter("section"):
        if len(results) >= max_results:
            break

        sct_title = section.get("sctTitle", "")

        for entry in section.findall("entry"):
            if len(results) >= max_results:
                break

            aiid = entry.get("aiid", "")
            cat_el = entry.find(".//category")
            category_type = cat_el.get("type", "") if cat_el is not None else ""

            sides = []
            for side in entry.findall("side"):
                lang = side.get("lang", "")

                # Texto completo desde <repr> (concatena todo el texto interno)
                repr_el = side.find("repr")
                text = ""
                if repr_el is not None:
                    text = "".join(repr_el.itertext())
                    text = re.sub(r"\s+", " ", text).strip()

                # Archivos de audio
                audio_files = []
                pron = side.find(".//pron")
                if pron is not None:
                    for f in pron.findall("file"):
                        fid = f.get("name", "")
                        label = f.get("label", "")
                        if fid:
                            audio_files.append({
                                "file_id": fid,
                                "label":   label,
                                "mp3_url": AUDIO_BASE.format(file_id=fid),
                            })

                sides.append({
                    "lang":  lang,
                    "text":  text,
                    "audio": audio_files,
                })

            results.append({
                "aiid":     aiid,
                "section":  sct_title,
                "category": category_type,
                "sides":    sides,
            })

    return results


def lookup(word: str, lp: str = "esde", max_results: int = 3) -> dict:
    """Función principal: devuelve dict con todos los datos listos para usar."""
    html = fetch_html(word, lp)
    xml_str = extract_xml(html)
    entries = parse_entries(xml_str, max_results)
    _, lang_labels = LANG_PAIRS[lp]
    return {
        "word":          word,
        "lang_pair":     lp,
        "total_results": len(entries),
        "lang_labels":   lang_labels,
        "entries":       entries,
    }


# ─────────────────────────────────────────────────────────────────
# Generación de HTML
# ─────────────────────────────────────────────────────────────────

def _esc(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;")
             .replace('"', "&quot;"))


def _render_side(side: dict, lang_labels: dict) -> str:
    lang  = side["lang"]
    label = lang_labels.get(lang, lang.upper())

    if not side["audio"]:
        audio_html = '<span class="no-audio">Sin audio disponible</span>'
    else:
        items = []
        for f in side["audio"]:
            url = _esc(f["mp3_url"])
            lbl = _esc(f["label"])
            fid = _esc(f["file_id"])
            items.append(f"""
              <div class="audio-item">
                <button class="btn-play" data-url="{url}" title="Reproducir">&#9654;</button>
                <span class="audio-label" title="{lbl}">{lbl}</span>
                <a class="btn-dl" href="{url}" download="{fid}.mp3">&#11015; MP3</a>
              </div>""")
        audio_html = '<div class="audio-list">' + "".join(items) + "</div>"

    return f"""
        <div class="side">
          <div class="lang-badge">{_esc(label)}</div>
          <div class="entry-text">{_esc(side["text"])}</div>
          {audio_html}
        </div>"""


def _render_entry(entry: dict, index: int, lang_labels: dict) -> str:
    cat     = CAT_LABELS.get(entry["category"], entry["category"].capitalize() or "—")
    section = _esc(entry["section"] or cat)
    sides   = "".join(_render_side(s, lang_labels) for s in entry["sides"])
    return f"""
      <div class="entry">
        <div class="entry-header">
          <span class="entry-num">#{index}</span>
          <span class="entry-section">{section}</span>
        </div>
        <div class="sides">{sides}</div>
      </div>"""


def generate_html(data: dict) -> str:
    """Genera un HTML standalone completo con reproductores y botones de descarga."""
    word        = _esc(data["word"])
    lang_labels = data["lang_labels"]
    total       = data["total_results"]
    entries_html = "".join(
        _render_entry(e, i + 1, lang_labels)
        for i, e in enumerate(data["entries"])
    )
    plural = "s" if total != 1 else ""

    return f"""<!DOCTYPE html>
<html lang="es">
<head>
  <meta charset="UTF-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1.0" />
  <title>LEO: {word}</title>
  <style>
    *, *::before, *::after {{ box-sizing: border-box; }}
    body {{
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
      background: #f0f4f8; margin: 0; padding: 24px 16px; color: #1a1a2e;
    }}
    .container {{ max-width: 780px; margin: 0 auto; }}

    header {{
      background: #1a3a5c; color: #fff;
      border-radius: 12px 12px 0 0; padding: 20px 24px;
    }}
    header h1 {{ margin: 0 0 4px; font-size: 22px; font-weight: 700; }}
    header p  {{ margin: 0; font-size: 13px; opacity: 0.72; }}

    .entry {{
      background: #fff; border: 1px solid #dde4ef; border-top: none; overflow: hidden;
    }}
    .entry:last-child {{ border-radius: 0 0 12px 12px; }}

    .entry-header {{
      background: #eef2f9; padding: 9px 16px;
      display: flex; align-items: center; gap: 10px;
      border-bottom: 1px solid #dde4ef;
    }}
    .entry-num {{
      background: #1a3a5c; color: #fff; border-radius: 50%;
      width: 22px; height: 22px; font-size: 11px; font-weight: 700;
      display: flex; align-items: center; justify-content: center; flex-shrink: 0;
    }}
    .entry-section {{
      font-size: 11px; color: #5a6a7e; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.5px;
    }}

    .sides {{ display: grid; grid-template-columns: 1fr 1fr; }}
    .side  {{ padding: 14px 16px; }}
    .side:first-child {{ border-right: 1px solid #dde4ef; }}

    .lang-badge {{
      display: inline-block; background: #e8f0fe; color: #1a3a5c;
      border-radius: 4px; padding: 2px 8px; font-size: 10px; font-weight: 700;
      text-transform: uppercase; letter-spacing: 0.6px; margin-bottom: 7px;
    }}
    .entry-text {{
      font-size: 14px; font-weight: 500; margin-bottom: 10px;
      line-height: 1.5; color: #1a1a2e;
    }}

    .audio-list {{ display: flex; flex-direction: column; gap: 6px; }}
    .audio-item {{ display: flex; align-items: center; gap: 7px; }}

    .btn-play {{
      background: #1a3a5c; border: none; border-radius: 50%;
      width: 28px; height: 28px; cursor: pointer; color: #fff; font-size: 10px;
      display: flex; align-items: center; justify-content: center;
      flex-shrink: 0; transition: background .15s;
    }}
    .btn-play:hover   {{ background: #254e7a; }}
    .btn-play.playing {{ background: #c0392b; }}

    .audio-label {{
      font-size: 12px; color: #5a6a7e; flex: 1; min-width: 0;
      white-space: nowrap; overflow: hidden; text-overflow: ellipsis;
    }}
    .btn-dl {{
      text-decoration: none; background: none; border: 1px solid #c8d0da;
      border-radius: 5px; color: #5a6a7e; font-size: 11px; padding: 3px 8px;
      white-space: nowrap; transition: all .15s; flex-shrink: 0;
    }}
    .btn-dl:hover {{ background: #eef2f9; border-color: #1a3a5c; color: #1a3a5c; }}
    .no-audio {{ font-size: 12px; color: #bbb; font-style: italic; }}

    @media (max-width: 520px) {{
      .sides {{ grid-template-columns: 1fr; }}
      .side:first-child {{ border-right: none; border-bottom: 1px solid #dde4ef; }}
    }}
  </style>
</head>
<body>
  <div class="container">
    <header>
      <h1>&#128270; {word}</h1>
      <p>{total} resultado{plural} &mdash; LEO Diccionario</p>
    </header>
    {entries_html}
  </div>
  <script>
    let current = null;
    document.querySelectorAll('.btn-play').forEach(btn => {{
      btn.addEventListener('click', () => {{
        if (current) {{
          current.audio.pause();
          current.btn.innerHTML = '&#9654;';
          current.btn.classList.remove('playing');
          if (current.btn === btn) {{ current = null; return; }}
        }}
        const audio = new Audio(btn.dataset.url);
        btn.innerHTML = '&#9632;';
        btn.classList.add('playing');
        current = {{ audio, btn }};
        audio.play();
        audio.onended = () => {{
          btn.innerHTML = '&#9654;';
          btn.classList.remove('playing');
          current = null;
        }};
      }});
    }});
  </script>
</body>
</html>"""


# ─────────────────────────────────────────────────────────────────
# CLI
# ─────────────────────────────────────────────────────────────────

def main():
    parser = argparse.ArgumentParser(
        description="Busca una palabra en LEO y devuelve JSON y/o HTML.",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )
    parser.add_argument("word",
        help="Palabra a buscar (ej: verantwortlich, Haus, gehen)")
    parser.add_argument("--results", type=int, default=3, metavar="N",
        help="Número máximo de resultados (default: 3)")
    parser.add_argument("--lp", default="esde", choices=list(LANG_PAIRS.keys()),
        help="Par de idiomas (default: esde)")
    parser.add_argument("--html", action="store_true",
        help="Genera un archivo HTML además de imprimir JSON")
    parser.add_argument("--only-html", action="store_true",
        help="Solo genera HTML, sin imprimir JSON en stdout")
    parser.add_argument("--output", metavar="FILE",
        help="Ruta del archivo HTML generado (default: leo_<palabra>.html)")
    args = parser.parse_args()

    try:
        data = lookup(args.word, lp=args.lp, max_results=args.results)
    except Exception as exc:
        print(f"Error: {exc}", file=sys.stderr)
        sys.exit(1)

    # JSON → stdout
    if not args.only_html:
        print(json.dumps(data, ensure_ascii=False, indent=2))

    # HTML → archivo
    if args.html or args.only_html:
        safe_word = re.sub(r"[^\w\-]", "_", args.word)
        out_file  = args.output or f"leo_{safe_word}.html"
        html_content = generate_html(data)
        with open(out_file, "w", encoding="utf-8") as fh:
            fh.write(html_content)
        print(f"\n✓ HTML guardado en: {out_file}", file=sys.stderr)


if __name__ == "__main__":
    main()