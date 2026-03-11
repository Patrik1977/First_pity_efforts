#!/usr/bin/env python3
"""
Rebuild official OGE pack from local FIPI ZIP archives.

Input:
  data/fipi_archives/*.zip

Output:
  data/fipi_official_pack.auto.json
  officialPackData.js
"""

from __future__ import annotations

import argparse
import io
import json
import re
import zipfile
from dataclasses import dataclass
from pathlib import Path
from typing import Dict, List, Tuple

from pypdf import PdfReader


SUBJECT_MAP = {
    "ru": "russian",
    "ma": "math",
    "fi": "physics",
    "iya": "english",
}

CUES = [
    "укажите",
    "выберите",
    "найдите",
    "определите",
    "решите",
    "запишите",
    "выпишите",
    "прочитайте",
    "раскройте",
    "вставьте",
    "установите соответствие",
    "какое",
    "какие",
    "в каком",
    "сколько",
    "чему",
]

TASK_START_RE = re.compile(
    r"(Укажите|Выберите|Найдите|Определите|Решите|Прочитайте|Раскройте|Вставьте|"
    r"Установите соответствие|Сколько|Чему|Какое|Какие|Запишите в таблицу)\b",
    re.IGNORECASE,
)

PRIORITY_START_MARKERS = [
    "Укажите варианты ответов",
    "Установите соответствие",
    "Прочитайте текст",
    "Расставьте знаки препинания",
    "Укажите все цифры",
    "Раскройте скобки",
    "Замените словосочетание",
    "Выпишите",
    "Найдите",
    "Сколько",
    "Чему равна",
]

HEADER_RE = re.compile(
    r"Демонстрационный вариант ОГЭ\s*\d{4}[^\n]*|©\s*20\d{2}\s*Федеральная служба[^\n]*",
    re.IGNORECASE,
)
WS_RE = re.compile(r"[ \t]+")


@dataclass
class ArchiveDemo:
    filename: str
    text: str


def clean_text(value: str) -> str:
    text = (value or "").replace("\u00a0", " ")
    text = HEADER_RE.sub(" ", text)
    text = "\n".join(line.rstrip() for line in text.splitlines())
    text = re.sub(r"\n{3,}", "\n\n", text)
    text = WS_RE.sub(" ", text)
    return text.strip()


def is_demo_pdf(text: str) -> bool:
    low = text.lower()
    if "демонстрационный вариант" not in low:
        return False
    if "итогового собеседования" in low:
        return False
    if "основного государственного экзамена" not in low and "огэ" not in low:
        return False
    return True


def load_demo_pdfs(zip_path: Path) -> List[ArchiveDemo]:
    demos: List[ArchiveDemo] = []
    with zipfile.ZipFile(zip_path) as archive:
        for name in archive.namelist():
            if not name.lower().endswith(".pdf"):
                continue
            data = archive.read(name)
            reader = PdfReader(io.BytesIO(data))
            full_text = "\n".join((page.extract_text() or "") for page in reader.pages)
            if is_demo_pdf(full_text):
                demos.append(ArchiveDemo(filename=name, text=clean_text(full_text)))
    return demos


def extract_answer_map(full_text: str) -> Dict[str, str]:
    marker = -1
    for token in ("Номер задания Правильный ответ", "Номер задания", "Правильный ответ"):
        marker = full_text.find(token)
        if marker != -1:
            break
    if marker == -1:
        return {}

    block = full_text[marker : marker + 6000]
    lines = [re.sub(r"\s+", " ", ln).strip() for ln in block.splitlines()]

    answer_map: Dict[str, str] = {}
    last_key = ""
    for line in lines:
        m = re.match(r"^([1-2]?\d(?:\.\d+)?)\s+(.+)$", line)
        if m:
            key = m.group(1)
            value = m.group(2).replace("<или>", "|").replace(" или ", "|")
            value = re.sub(r"\s+", " ", value).strip(" .;:")
            if value and len(value) <= 48:
                if len(value.split()) > 2:
                    continue
                if not re.fullmatch(r"[0-9A-Za-zА-Яа-яЁё<>{}|/.,+\- ]{1,48}", value):
                    continue
                answer_map[key] = value
                last_key = key
            continue
        if last_key and line.lower().startswith("<или>"):
            extra = line.replace("<или>", "").strip(" .;:")
            if extra:
                answer_map[last_key] = f"{answer_map[last_key]}|{extra}"

    return answer_map


def looks_like_task(text: str) -> bool:
    low = text.lower()
    if len(text) < 35:
        return False
    if "критерии оценивания" in low and "задани" not in low:
        return False
    if "система оценивания" in low and "задани" not in low:
        return False
    if "?" in text or re.search(r"\b\d\)", text):
        return True
    return any(cue in low for cue in CUES)


def trim_to_task_start(text: str) -> str:
    raw = (text or "").strip()
    for marker in PRIORITY_START_MARKERS:
        idx = raw.find(marker)
        if idx > 60:
            raw = raw[idx:]
            break

    raw = re.sub(r"^\s*(?:\d{1,2}\s+){1,4}(?=[А-ЯA-Z])", "", raw)

    m = TASK_START_RE.search(raw)
    if m and m.start() > 120:
        return raw[m.start() :].strip()
    return raw.strip()


def extract_answer_chunks(full_text: str) -> List[str]:
    positions = [m.start() for m in re.finditer(r"Ответ\s*:\s*", full_text, re.IGNORECASE)]
    if not positions:
        return []

    chunks: List[str] = []
    prev = max(0, positions[0] - 2200)
    for idx, pos in enumerate(positions):
        segment = full_text[prev:pos]
        if idx > 0:
            segment = re.sub(r"^[\s._\-–—]+", "", segment)
        segment = trim_to_task_start(clean_text(segment))
        if len(segment) > 2600:
            segment = segment[-2600:]
        if looks_like_task(segment):
            chunks.append(segment)
        prev = pos + 6
    return chunks


def extract_writing_tasks(full_text: str) -> List[Tuple[str, str]]:
    source = clean_text(full_text)
    out: List[Tuple[str, str]] = []
    markers = [("13.1", "13.2"), ("13.2", "13.3"), ("13.3", None)]
    for token, next_token in markers:
        start_match = re.search(rf"(?:^|\n)\s*{re.escape(token)}\b", source)
        if not start_match:
            continue
        start = start_match.start()
        if next_token:
            end_match = re.search(rf"(?:^|\n)\s*{re.escape(next_token)}\b", source[start + 1 :])
            end = start + 1 + end_match.start() if end_match else len(source)
        else:
            end = len(source)
        block = source[start:end].strip()
        if len(block) < 90:
            continue
        if len(block) > 2600:
            block = block[:2600].strip()
        out.append((token, block))
    return out


def question_signature(prompt: str) -> str:
    normalized = re.sub(r"\s+", " ", (prompt or "").lower()).strip()
    return normalized


def build_variant_questions(
    subject: str,
    year: int,
    variant: int,
    demo_text: str,
) -> List[Dict]:
    answer_map = extract_answer_map(demo_text)
    chunks = extract_answer_chunks(demo_text)
    writing_tasks = extract_writing_tasks(demo_text)

    questions: List[Dict] = []
    seen_signatures = set()

    if len(answer_map) >= 3:
        lines = ["Номер задания Правильный ответ"] + [f"{k} {v}" for k, v in answer_map.items()]
        questions.append(
            {
                "subject": subject,
                "year": year,
                "variant": variant,
                "segment": "Служебное",
                "topic": f"Официальная демоверсия ФИПИ {year}",
                "subtopic": "Таблица ответов",
                "difficulty": "medium",
                "type": "short-text",
                "prompt": "\n".join(lines),
            }
        )

    answer_keys = list(answer_map.keys())

    for index, chunk in enumerate(chunks):
        if index < len(answer_keys):
            qnum = answer_keys[index]
        else:
            qnum_match = re.match(r"^([1-2]?\d(?:\.\d+)?)\s+", chunk)
            qnum = qnum_match.group(1) if qnum_match else str(index + 1)

        signature = question_signature(chunk)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)

        questions.append(
            {
                "subject": subject,
                "year": year,
                "variant": variant,
                "questionNumber": qnum,
                "segment": "Официальные задания",
                "topic": f"Официальная демоверсия ФИПИ {year}",
                "subtopic": f"Задание {qnum}",
                "difficulty": "hard",
                "prompt": chunk,
            }
        )

    for qnum, block in writing_tasks:
        signature = question_signature(block)
        if signature in seen_signatures:
            continue
        seen_signatures.add(signature)

        questions.append(
            {
                "subject": subject,
                "year": year,
                "variant": variant,
                "questionNumber": qnum,
                "segment": "Развёрнутый ответ",
                "topic": f"Официальная демоверсия ФИПИ {year}",
                "subtopic": f"Задание {qnum}",
                "difficulty": "hard",
                "type": "extended-answer-lite",
                "prompt": block,
            }
        )

    return questions


def collect_variants(archives_dir: Path) -> List[Dict]:
    variants: List[Dict] = []

    for zip_path in sorted(archives_dir.glob("*_9_*.zip")):
        m = re.match(r"^([a-z]+)_9_(\d{4})\.zip$", zip_path.name)
        if not m:
            continue
        code, year_token = m.group(1), m.group(2)
        if code not in SUBJECT_MAP:
            continue
        subject = SUBJECT_MAP[code]
        year = int(year_token)

        demo_pdfs = load_demo_pdfs(zip_path)
        if not demo_pdfs:
            continue

        variant_number = 1
        for demo in demo_pdfs:
            questions = build_variant_questions(subject, year, variant_number, demo.text)
            if len(questions) < 2:
                variant_number += 1
                continue
            variants.append(
                {
                    "subject": subject,
                    "year": year,
                    "variant": variant_number,
                    "source": "ФИПИ",
                    "questions": questions,
                }
            )
            variant_number += 1

    return variants


def summarize(variants: List[Dict]) -> Dict[str, Dict]:
    summary: Dict[str, Dict] = {}
    for variant in variants:
        subject = variant["subject"]
        summary.setdefault(subject, {"variants": 0, "questions": 0, "years": set()})
        summary[subject]["variants"] += 1
        summary[subject]["questions"] += len(variant.get("questions", []))
        summary[subject]["years"].add(variant["year"])
    for payload in summary.values():
        payload["years"] = sorted(payload["years"])
    return summary


def write_outputs(pack: Dict, json_path: Path, js_path: Path) -> None:
    json_text = json.dumps(pack, ensure_ascii=False, indent=2)
    json_path.write_text(json_text, encoding="utf-8")

    js_text = "window.__OGE_OFFICIAL_PACK__ = " + json.dumps(pack, ensure_ascii=False) + ";\n"
    js_path.write_text(js_text, encoding="utf-8")


def parse_args() -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Rebuild official pack from FIPI archives.")
    parser.add_argument("--archives-dir", default="data/fipi_archives", help="Directory with ZIP archives.")
    parser.add_argument("--json-out", default="data/fipi_official_pack.auto.json", help="Output JSON path.")
    parser.add_argument("--js-out", default="officialPackData.js", help="Output JS path.")
    return parser.parse_args()


def main() -> int:
    args = parse_args()
    archives_dir = Path(args.archives_dir)
    json_out = Path(args.json_out)
    js_out = Path(args.js_out)

    if not archives_dir.exists():
        raise SystemExit(f"Archives directory does not exist: {archives_dir}")

    variants = collect_variants(archives_dir)
    pack = {
        "type": "oge-official-bank-pack",
        "version": 1,
        "source": "ФИПИ",
        "variants": variants,
    }

    write_outputs(pack, json_out, js_out)

    summary = summarize(variants)
    total_questions = sum(p["questions"] for p in summary.values())
    print(f"Variants: {len(variants)}")
    print(f"Questions: {total_questions}")
    for subject in sorted(summary.keys()):
        payload = summary[subject]
        years = ", ".join(str(y) for y in payload["years"])
        print(
            f" - {subject}: variants={payload['variants']}, questions={payload['questions']}, years=[{years}]"
        )

    return 0


if __name__ == "__main__":
    raise SystemExit(main())
