#!/usr/bin/env python3
"""Check design-package integrity only; this does not execute a Malbolge VM."""
from __future__ import annotations

import ast
import hashlib
import json
import re
from datetime import datetime, timezone
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
NAMES = [
    '01_PRODUCT_SPEC.md', '02_UX_SPEC.md', '03_ARCHITECTURE.md',
    '04_SEMANTICS_CONTRACT.md', '05_DATA_AND_PROTOCOL.md',
    '06_DEBUGGER_SPEC.md', '07_TEST_AND_RELEASE.md',
    '08_IMPLEMENTATION_PLAN.md', '09_DECISIONS_AND_GAPS.md',
]
EXPECTED_HASH = '69ed29dde001b80de62e2feaf2a2f5463ec7ee9666b981954ef63a938a854a81'
EXPECTED_PHASES = {'UNLOADED', 'READY', 'RUNNING', 'PAUSED', 'WAITING_INPUT',
                   'HALTED', 'FAULTED', 'DISPOSED'}
checks: list[dict] = []


def record(name: str, passed: bool, detail: object) -> None:
    checks.append({'check': name, 'status': 'PASS' if passed else 'FAIL', 'detail': detail})


def main() -> int:
    texts: dict[str, str] = {}
    manifest = []
    for name in NAMES + ['README.md']:
        path = ROOT / name
        exists = path.is_file()
        record('document:' + name, exists and path.stat().st_size > 500 if exists else False,
               {'exists': exists})
        if not exists:
            continue
        data = path.read_bytes()
        text = data.decode('utf-8', errors='strict')
        texts[name] = text
        manifest.append({'path': name, 'bytes': len(data), 'lines': len(text.splitlines()),
                         'sha256': hashlib.sha256(data).hexdigest()})
        record('fences:' + name, sum(line.startswith('```') for line in text.splitlines()) % 2 == 0,
               'Opening and closing fences must balance.')
        language_hits = [i for i, line in enumerate(text.splitlines(), 1)
                         if re.search(r'[\u3040-\u30ff\u4e00-\u9fff]', line)]
        record('language:' + name, not language_hits, {'unexpected_script_lines': language_hits})
        placeholders = re.findall(r'\b(?:TODO|FIXME|TBD)\b|<INSERT[^>]*>', text)
        record('placeholders:' + name, not placeholders, placeholders)

    json_count = 0
    link_count = 0
    for name, text in texts.items():
        for block in re.findall(r'^```json\s*\n(.*?)^```\s*$', text, re.M | re.S):
            json_count += 1
            try:
                json.loads(block)
                record(f'json:{name}:{json_count}', True, 'Parsed JSON example, not runtime validation.')
            except json.JSONDecodeError as exc:
                record(f'json:{name}:{json_count}', False, str(exc))
        unfenced = re.sub(r'^```[^\n]*\n.*?^```\s*$', '', text, flags=re.M | re.S)
        for destination in re.findall(r'\]\(([^)]+)\)', unfenced):
            if destination.startswith(('https://', 'http://', '#')):
                continue
            link_count += 1
            relative = destination.split('#', 1)[0]
            target = (ROOT / relative).resolve()
            record(f'link:{name}:{relative}', target.is_file() and ROOT in target.parents,
                   {'relative': relative})

    tests_text = texts.get('07_TEST_AND_RELEASE.md', '')
    tests = set(re.findall(r'^\| (T\d{2}) \|', tests_text, re.M))
    required_tests = {f'T{i:02d}' for i in range(1, 43)}
    record('test-definitions', tests == required_tests, {'count': len(tests)})
    all_text = '\n'.join(texts.values())
    refs = set(re.findall(r'\bT\d{2}\b', all_text))
    record('test-references', refs <= tests, {'undefined': sorted(refs - tests)})
    decisions = texts.get('09_DECISIONS_AND_GAPS.md', '')
    for prefix, count in [('R', 42), ('D', 18), ('G', 8)]:
        definitions = set(re.findall(r'^\| (' + prefix + r'\d{2}) \|', decisions, re.M))
        record(prefix + '-definitions', definitions == {f'{prefix}{i:02d}' for i in range(1, count+1)},
               {'count': len(definitions)})
    source_refs = set(re.findall(r'\b(?:S[1-9]|W[1-9])\b', all_text))
    known_sources = {'S1', 'S2', 'S3', 'W1', 'W2', 'W4', 'W5', 'W6', 'W7'}
    record('source-aliases', source_refs <= known_sources, {'undefined': sorted(source_refs-known_sources)})
    contract = texts.get('05_DATA_AND_PROTOCOL.md', '')
    phase_match = re.search(r'type Phase\s*=\s*(.*?);', contract, re.S)
    phases = set(re.findall(r"'([A-Z_]+)'", phase_match.group(1))) if phase_match else set()
    record('canonical-phases', phases == EXPECTED_PHASES, sorted(phases))
    record('no-legacy-wait-alias', 'INPUT_WAIT' not in all_text, 'WAITING_INPUT is the canonical phase.')

    fixture = ROOT / 'fixtures/recurrent_crazy4.mb'
    raw = fixture.read_bytes() if fixture.is_file() else b''
    logical = bytes(b for b in raw if b not in (9, 10, 11, 12, 13, 32))
    actual_hash = hashlib.sha256(logical).hexdigest()
    record('fixture-integrity', len(logical) == 87 and actual_hash == EXPECTED_HASH,
           {'fileBytes': len(raw), 'logicalCells': len(logical), 'logicalSha256': actual_hash})
    fixture_blocks = re.findall(r'^```text\s*\n(.*?)^```\s*$', tests_text, re.M | re.S)
    source_block = next((b for b in fixture_blocks if b.startswith("('s;")), '')
    record('fixture-document-copy', source_block.encode('ascii') == raw, 'Exact source bytes including LF.')

    semantics = texts.get('04_SEMANTICS_CONTRACT.md', '')
    tables = {}
    for name in ['xlat1', 'xlat2']:
        match = re.search(r'const char ' + name + r'\[\] =\s*(.*?);', semantics, re.S)
        # Semicolons occur inside table strings, so use the quoted two-line form instead.
        match = re.search(r'const char ' + name + r'\[\] =\s*\n\s*("(?:\\.|[^"\\])*")\s*\n\s*("(?:\\.|[^"\\])*");', semantics)
        if match:
            tables[name] = ast.literal_eval(match.group(1)) + ast.literal_eval(match.group(2))
        record('table-length:' + name, len(tables.get(name, '')) == 94,
               {'length': len(tables.get(name, '')), 'scope': 'transcription integrity, not VM execution'})
    expected_residues = {'i':4, '<':5, '/':23, '*':39, 'j':40, 'p':62, 'o':68, 'v':81}
    xlat1 = tables.get('xlat1', '')
    actual_residues = {ch: (xlat1.index(ch) + 33) % 94 for ch in expected_residues if ch in xlat1}
    record('table-residue-transcription', actual_residues == expected_residues, actual_residues)
    xlat2 = tables.get('xlat2', '')
    record('permutation-transcription', len(set(xlat2)) == 94 and set(map(ord, xlat2)) == set(range(33, 127)),
           'The 94-character xlat2 transcription is a printable-ASCII permutation.')

    failed = [check for check in checks if check['status'] == 'FAIL']
    report = {
        'schemaVersion': 1, 'timestamp': datetime.now(timezone.utc).isoformat(),
        'scope': 'Design document and fixture integrity only. No Malbolge VM was executed.',
        'status': 'PASS' if not failed else 'FAIL',
        'counts': {'requiredDocuments': len(NAMES), 'markdownFiles': len(texts),
                   'checks': len(checks), 'failed': len(failed), 'jsonExamples': json_count,
                   'relativeLinks': link_count, 'acceptanceTestsDefined': len(tests)},
        'checks': checks, 'documents': manifest,
        'notRun': ['VM conformance', 'TypeScript compilation', 'product tests T01-T39/T41/T42',
                   'app build', 'native UI tests', '.app/.dmg packaging', 'signing',
                   'notarization', 'other-Mac installation', 'performance measurement'],
        'limitations': ['These mechanical checks do not prove semantic correctness or completeness of the design.'],
    }
    output = ROOT / 'evidence/design-validation.json'
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'status': report['status'], 'counts': report['counts'],
                      'failedChecks': failed, 'report': str(output)}, ensure_ascii=False, indent=2))
    return 1 if failed else 0


if __name__ == '__main__':
    raise SystemExit(main())
