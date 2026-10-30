#!/usr/bin/env python3
"""Журнал запросов по fur-erp из истории сессий Claude Code.

  python3 -I prompts.py <папка_журнала>

Берёт все сессии, запущенные в папке проекта, и сессии из ~/Documents/claude,
где проект упоминается часто (работа шла над ним). Для каждой сессии пишет
файл с запросами владельца по времени, плюс общий список ВСЕ_СЕССИИ.md.
Разбирает только изменившиеся файлы (кэш .state.json в папке журнала).
"""
import json, os, re, sys, glob
from datetime import datetime, timezone, timedelta

MSK = timezone(timedelta(hours=3))
HOME = os.path.expanduser("~")
OWN_DIRS = [f"{HOME}/.claude/projects/-Users-petr-Projects-fur-erp"]
SHARED_DIRS = [f"{HOME}/.claude/projects/-Users-petr-Documents-claude"]
MENTION_MIN = 5          # столько упоминаний проекта, чтобы сессия считалась «про fur-erp»
MAX_PROMPT = 6000        # длинные вставки обрезаем
SKIP_PREFIXES = ("[Request interrupted", "Base directory for this skill", "<task-notification>",
                 "Caveat:", "<local-command", "This session is being continued")

out = sys.argv[1]
os.makedirs(out, exist_ok=True)
state_path = os.path.join(out, ".state.json")
try:
    state = json.load(open(state_path, encoding="utf-8"))
except Exception:
    state = {}

def human_text(msg):
    c = msg.get("content")
    if isinstance(c, str):
        return c
    if isinstance(c, list):
        parts = [p.get("text", "") for p in c if isinstance(p, dict) and p.get("type") == "text"]
        return "\n".join(parts)
    return ""

def clean(t):
    t = re.sub(r"<system-reminder>.*?</system-reminder>", "", t, flags=re.S)
    m = re.search(r"<command-name>(.*?)</command-name>.*?<command-args>(.*?)</command-args>", t, flags=re.S)
    if m:
        t = f"{m.group(1).strip()} {m.group(2).strip()}"
    t = t.strip()
    if len(t) > MAX_PROMPT:
        t = t[:MAX_PROMPT] + f"\n…[обрезано, всего {len(t)} знаков]"
    return t

def parse(path):
    prompts, title = [], ""
    with open(path, encoding="utf-8", errors="replace") as f:
        for line in f:
            if '"type":"user"' not in line and '"type":"custom-title"' not in line and '"type":"summary"' not in line:
                continue
            try:
                d = json.loads(line)
            except Exception:
                continue
            if d.get("type") in ("custom-title", "summary"):
                title = d.get("customTitle") or d.get("summary") or title
                continue
            if d.get("isSidechain") or d.get("isMeta"):
                continue
            if (d.get("origin") or {}).get("kind") not in (None, "human"):
                continue
            t = clean(human_text(d.get("message") or {}))
            if not t or t.startswith(SKIP_PREFIXES):
                continue
            ts = d.get("timestamp", "")
            prompts.append((ts, t))
    # одинаковые повторы (перезапуски) убираем
    seen, uniq = set(), []
    for ts, t in prompts:
        k = (ts, t)
        if k not in seen:
            seen.add(k); uniq.append((ts, t))
    return title, uniq

def local(ts):
    try:
        return datetime.fromisoformat(ts.replace("Z", "+00:00")).astimezone(MSK)
    except Exception:
        return None

files = []
for d in OWN_DIRS:
    files += [(p, True) for p in glob.glob(f"{d}/*.jsonl")]
for d in SHARED_DIRS:
    files += [(p, False) for p in glob.glob(f"{d}/*.jsonl")]

changed = False
for path, own in files:
    st = os.stat(path)
    key = f"{st.st_mtime_ns}:{st.st_size}"
    rec = state.get(path)
    if rec and rec.get("key") == key:
        continue
    changed = True
    if not own:
        # считаем только действия Claude с файлами проекта, а не упоминания в заметках памяти
        n = 0
        with open(path, encoding="utf-8", errors="replace") as f:
            for line in f:
                if '"type":"assistant"' in line and ("Projects/fur-erp" in line or "claude/fur-erp" in line):
                    n += 1
        if n < MENTION_MIN:
            state[path] = {"key": key, "skip": True}
            continue
    title, prompts = parse(path)
    if not prompts:
        state[path] = {"key": key, "skip": True}
        continue
    first = local(prompts[0][0])
    sid = os.path.basename(path)[:8]
    stamp = first.strftime("%Y-%m-%d_%H%M") if first else "без-даты"
    name = f"{stamp}_{sid}.md"
    head = title or prompts[0][1].splitlines()[0][:90]
    lines = [f"# {head}", "",
             f"Сессия `{os.path.basename(path)}`" + (" (папка проекта)" if own else " (общая папка claude)"),
             f"Запросов: {len(prompts)}", ""]
    for ts, t in prompts:
        dt = local(ts)
        lines += [f"## {dt.strftime('%d.%m.%Y %H:%M') if dt else ts}", "", t, ""]
    old = (rec or {}).get("file")
    if old and old != name and os.path.exists(os.path.join(out, old)):
        os.remove(os.path.join(out, old))
    with open(os.path.join(out, name), "w", encoding="utf-8") as f:
        f.write("\n".join(lines))
    state[path] = {"key": key, "file": name, "title": head, "count": len(prompts), "start": stamp}

if changed or not os.path.exists(os.path.join(out, "ВСЕ_СЕССИИ.md")):
    rows = sorted([v for v in state.values() if v.get("file")], key=lambda v: v["file"], reverse=True)
    idx = ["# Все сессии работы над fur-erp", "",
           "Каждая строка — одна сессия Claude; в файле все запросы владельца по порядку (время московское).",
           "Собирается автоматически после каждого ответа Claude (scripts/hub-sync.sh).", "",
           "| Начало | Запросов | Тема | Файл |", "|---|---|---|---|"]
    for v in rows:
        t = v["title"].replace("|", "/")[:100]
        idx.append(f"| {v['start'].replace('_', ' ')} | {v['count']} | {t} | [{v['file']}]({v['file']}) |")
    with open(os.path.join(out, "ВСЕ_СЕССИИ.md"), "w", encoding="utf-8") as f:
        f.write("\n".join(idx) + "\n")
    json.dump(state, open(state_path, "w", encoding="utf-8"), ensure_ascii=False)
