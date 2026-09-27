import { useEffect, useRef } from 'react';
import * as monaco from 'monaco-editor/editor/editor.api.js';
import EditorWorker from 'monaco-editor/editor/editor.worker.js?worker';
import { analyzeSource, encode, type Analysis, type SourceKind } from '@bolgescope/core';

const globalWithMonaco = globalThis as typeof globalThis & { MonacoEnvironment?: { getWorker: () => Worker } };
globalWithMonaco.MonacoEnvironment = { getWorker: () => new EditorWorker() };

const legend = { tokenTypes: ['move', 'jump', 'input', 'output', 'math', 'halt', 'nop'], tokenModifiers: [] };
const tokenIndex: Record<string, number> = { j: 0, i: 1, '/': 2, '<': 3, p: 4, '*': 4, v: 5, o: 6 };
let registered = false;
function registerLanguages(): void {
  if (registered) return;
  registered = true;
  for (const id of ['bolge-raw', 'bolge-normalized']) {
    monaco.languages.register({ id });
    monaco.languages.setLanguageConfiguration(id, { comments: {}, brackets: [], autoClosingPairs: [], surroundingPairs: [] });
    monaco.languages.registerDocumentSemanticTokensProvider(id, {
      getLegend: () => legend,
      provideDocumentSemanticTokens(model) {
        const kind: SourceKind = id === 'bolge-raw' ? 'raw' : 'normalized';
        const cells = analyzeSource(model.getValue(), kind).sourceMap;
        const data: number[] = [];
        let previousLine = 0;
        let previousColumn = 0;
        for (const cell of cells) {
          const line = cell.span.line - 1;
          const column = cell.span.column - 1;
          data.push(line - previousLine, line === previousLine ? column - previousColumn : column, 1, tokenIndex[cell.symbol] ?? 6, 0);
          previousLine = line;
          previousColumn = column;
        }
        return { data: new Uint32Array(data), resultId: model.getVersionId().toString() };
      },
      releaseDocumentSemanticTokens() {},
    });
    monaco.languages.registerHoverProvider(id, {
      provideHover(model, position) {
        const kind: SourceKind = id === 'bolge-raw' ? 'raw' : 'normalized';
        const offset = model.getOffsetAt(position);
        const cell = analyzeSource(model.getValue(), kind).sourceMap.find(entry => entry.span.utf16Start === offset);
        if (!cell) return null;
        const authored = model.getValue()[offset] ?? '';
        const content = `주소 **#${cell.address}** · 문자 \`${authored}\` · raw \`${String.fromCharCode(cell.raw)}\` (${cell.raw}) · residue **${(cell.raw + cell.address) % 94}** · 초기 명령 **${cell.symbol}**`;
        return { contents: [{ value: content }] };
      },
    });
  }
  monaco.editor.defineTheme('bolgescope', {
    base: 'vs-dark', inherit: true,
    rules: [
      { token: 'move', foreground: '79C4B6' }, { token: 'jump', foreground: '97D2C9' },
      { token: 'input', foreground: 'E6A36F' }, { token: 'output', foreground: 'EFC49E' },
      { token: 'math', foreground: 'B4A7DF' }, { token: 'halt', foreground: 'ED8C82' },
      { token: 'nop', foreground: 'A9ADAF' },
    ],
    colors: { 'editor.background': '#111316', 'editor.foreground': '#E9E8E4', 'editor.lineHighlightBackground': '#1B1E22', 'editorCursor.foreground': '#E6A36F', 'editor.selectionBackground': '#3B4B50' },
  });
}

type Props = {
  modelKey: string;
  text: string;
  kind: SourceKind;
  analysis: Analysis;
  readOnly: boolean;
  selectedAddress: number | null;
  executionAddress: number | null;
  replacement: { address: number; symbol: string; nonce: number } | null;
  onChange: (value: string) => void;
  onSelect: (address: number | null) => void;
};

export default function SourceEditor({ modelKey, text, kind, analysis, readOnly, selectedAddress, executionAddress, replacement, onChange, onSelect }: Props) {
  const host = useRef<HTMLDivElement>(null);
  const editor = useRef<monaco.editor.IStandaloneCodeEditor | null>(null);
  const decorations = useRef<monaco.editor.IEditorDecorationsCollection | null>(null);
  const models = useRef(new Map<string, monaco.editor.ITextModel>());
  const initial = useRef({ modelKey, text, kind, readOnly });
  const lastReplacement = useRef<number | null>(null);
  const onChangeRef = useRef(onChange);
  const onSelectRef = useRef(onSelect);
  const kindRef = useRef(kind);
  const editableRef = useRef(!readOnly);
  const synchronizing = useRef(false);
  onChangeRef.current = onChange;
  onSelectRef.current = onSelect;
  kindRef.current = kind;
  editableRef.current = !readOnly;

  useEffect(() => {
    registerLanguages();
    if (!host.current) return;
    const first = initial.current;
    const model = monaco.editor.createModel(first.text, first.kind === 'raw' ? 'bolge-raw' : 'bolge-normalized');
    models.current.set(first.modelKey, model);
    const instance = monaco.editor.create(host.current, {
      model, theme: 'bolgescope',
      automaticLayout: true, minimap: { enabled: false }, fontFamily: 'SFMono-Regular, Menlo, ui-monospace, monospace',
      fontSize: 14, lineHeight: 22, readOnly: first.readOnly, scrollBeyondLastLine: false, renderWhitespace: 'selection',
      wordWrap: 'off', tabSize: 2, insertSpaces: false, autoClosingBrackets: 'never', autoClosingQuotes: 'never',
      autoSurround: 'never', formatOnPaste: false, formatOnType: false, trimAutoWhitespace: false,
      padding: { top: 14, bottom: 14 },
    });
    editor.current = instance;
    decorations.current = instance.createDecorationsCollection();
    const changes = instance.onDidChangeModelContent(() => { if (!synchronizing.current && editableRef.current) onChangeRef.current(instance.getValue()); });
    const selection = instance.onDidChangeCursorPosition(event => {
      if (synchronizing.current) return;
      const offset = instance.getModel()?.getOffsetAt(event.position);
      const selected = analyzeSource(instance.getValue(), kindRef.current)
        .sourceMap.find(cell => cell.span.utf16Start === offset);
      onSelectRef.current(selected?.address ?? null);
    });
    return () => { changes.dispose(); selection.dispose(); instance.dispose(); for (const item of models.current.values()) item.dispose(); models.current.clear(); editor.current = null; };
  }, []);

  useEffect(() => {
    const instance = editor.current;
    if (!instance) return;
    let model = models.current.get(modelKey);
    if (!model) { model = monaco.editor.createModel(text, kind === 'raw' ? 'bolge-raw' : 'bolge-normalized'); models.current.set(modelKey, model); }
    synchronizing.current = true;
    try {
      if (instance.getModel() !== model) instance.setModel(model);
      if (model.getValue(monaco.editor.EndOfLinePreference.LF) !== text.replace(/\r\n?/g, '\n')) model.setValue(text);
      monaco.editor.setModelLanguage(model, kind === 'raw' ? 'bolge-raw' : 'bolge-normalized');
      instance.updateOptions({ readOnly });
    } finally { synchronizing.current = false; }
  }, [modelKey, text, kind, readOnly]);

  useEffect(() => {
    const instance = editor.current;
    const model = instance?.getModel();
    if (!instance || !model) return;
    monaco.editor.setModelMarkers(model, 'bolgescope', analysis.diagnostics.map(diagnostic => {
      const start = diagnostic.span ? model.getPositionAt(diagnostic.span.utf16Start) : { lineNumber: 1, column: 1 };
      const end = diagnostic.span ? model.getPositionAt(diagnostic.span.utf16End) : { lineNumber: 1, column: 2 };
      return { ...start, startLineNumber: start.lineNumber, startColumn: start.column, endLineNumber: end.lineNumber, endColumn: end.column, severity: monaco.MarkerSeverity.Error, message: diagnostic.message };
    }));
  }, [analysis]);

  useEffect(() => {
    const model = editor.current?.getModel();
    if (!model) return;
    decorations.current?.set([selectedAddress, executionAddress].flatMap((address, index) => {
      const cell = analysis.sourceMap[address ?? -1];
      if (!cell) return [];
      const start = model.getPositionAt(cell.span.utf16Start);
      return [{ range: new monaco.Range(start.lineNumber, start.column, start.lineNumber, start.column + 1), options: { inlineClassName: index === 0 ? 'selected-cell' : 'execution-cell', hoverMessage: { value: index === 0 ? '선택한 주소' : '실행 위치' } } }];
    }));
  }, [analysis, selectedAddress, executionAddress]);

  useEffect(() => {
    const instance = editor.current;
    if (!replacement || !instance || readOnly || replacement.nonce === lastReplacement.current) return;
    const cell = analysis.sourceMap[replacement.address];
    if (!cell) return;
    const start = instance.getModel()?.getPositionAt(cell.span.utf16Start);
    if (!start) return;
    const raw = kind === 'raw' ? String.fromCharCode(encode(replacement.symbol, replacement.address)) : replacement.symbol;
    instance.pushUndoStop();
    instance.executeEdits('instruction-replace', [{ range: new monaco.Range(start.lineNumber, start.column, start.lineNumber, start.column + 1), text: raw, forceMoveMarkers: true }]);
    instance.pushUndoStop();
    lastReplacement.current = replacement.nonce;
    instance.focus();
  }, [replacement, analysis, kind, readOnly]);

  return <section className="editor-host" ref={host} aria-label={readOnly ? '읽기 전용 소스' : 'Malbolge 소스 편집기'} />;
}
