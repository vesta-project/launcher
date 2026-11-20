import { IconButton } from '@vesta/ui';
import { Show, createMemo, createSignal, onSettled } from 'solid-js';
import { Icon } from '../icon';
import { t } from '../../localization';
import { findAll, highlightWindow, lineAt, lineStarts, type CodeLanguage } from './highlight';
import './code-editor.css';

/** Line height in px; the textarea and the overlay must agree exactly. */
const LINE = 20;
/** Lines drawn above and below the visible ones, so fast scrolling stays coloured. */
const OVERSCAN = 30;
/** Above this many characters the file is drawn uncoloured (search still marks matches). */
const COLOUR_LIMIT = 400_000;

export interface CodeEditorProps {
  value: string;
  onChange?: (value: string) => void;
  language: CodeLanguage;
  readOnly?: boolean;
  'aria-label': string;
  class?: string;
}

/**
 * A plain textarea with a coloured copy of the text drawn underneath it, and find (Ctrl/Cmd+F).
 * The textarea keeps every native editing behaviour (undo, IME, selection, spellcheck off); its
 * text is transparent so the overlay shows through, and only the visible lines are coloured.
 */
export function CodeEditor(props: CodeEditorProps) {
  let area!: HTMLTextAreaElement;
  let findInput: HTMLInputElement | undefined;
  const [scroll, setScroll] = createSignal({ top: 0, left: 0, height: 600 }, { name: 'code-editor:scroll' });
  const [finding, setFinding] = createSignal(false, { name: 'code-editor:finding' });
  const [query, setQuery] = createSignal('', { name: 'code-editor:query' });
  const [current, setCurrent] = createSignal(0, { name: 'code-editor:current' });

  const lines = createMemo(() => props.value.split('\n'), { name: 'code-editor:lines' });
  const starts = createMemo(() => lineStarts(lines()), { name: 'code-editor:starts' });
  const matches = createMemo(() => (finding() ? findAll(props.value, query()) : []), { name: 'code-editor:matches' });
  const language = () => (props.value.length > COLOUR_LIMIT ? 'plain' : props.language);
  const first = () => Math.max(0, Math.floor(scroll().top / LINE) - OVERSCAN);
  const last = () => Math.min(lines().length - 1, Math.ceil((scroll().top + scroll().height) / LINE) + OVERSCAN);
  const html = createMemo(
    () => highlightWindow(lines(), starts(), language(), first(), last(), matches(), current()),
    { name: 'code-editor:html' },
  );

  const sync = () => setScroll({ top: area.scrollTop, left: area.scrollLeft, height: area.clientHeight });
  onSettled(() => {
    sync();
    const observer = new ResizeObserver(sync);
    observer.observe(area);
    return () => observer.disconnect();
  });

  /** Selects match `index` in the text and scrolls it a third of the way down. */
  const reveal = (index: number) => {
    const list = matches();
    if (!list.length) return;
    const wrapped = ((index % list.length) + list.length) % list.length;
    setCurrent(wrapped);
    const [from, to] = list[wrapped]!;
    area.setSelectionRange(from, to);
    const line = lineAt(starts(), from);
    area.scrollTop = Math.max(0, line * LINE - area.clientHeight / 3);
    sync();
  };

  const openFind = () => {
    setFinding(true);
    const selected = area.value.slice(area.selectionStart, area.selectionEnd);
    if (selected && !selected.includes('\n')) setQuery(selected);
    queueMicrotask(() => { findInput?.focus(); findInput?.select(); });
  };
  const closeFind = () => {
    setFinding(false);
    area.focus();
  };

  const onKeyDown = (event: KeyboardEvent) => {
    if ((event.ctrlKey || event.metaKey) && !event.altKey && event.key.toLowerCase() === 'f') {
      event.preventDefault();
      openFind();
    } else if (event.key === 'F3') {
      event.preventDefault();
      if (!finding()) openFind();
      else reveal(current() + (event.shiftKey ? -1 : 1));
    }
  };

  const count = () => {
    const total = matches().length;
    if (!query()) return '';
    return total ? t('editor.match-count', { visible: current() + 1, total }) : t('editor.no-matches');
  };

  return (
    <div data-vesta="code-editor" data-language={language()} class={props.class} onKeyDown={onKeyDown}>
      <Show when={finding()}>
        <div data-vesta="code-editor-find" role="search">
          <Icon name="icons/content/search" size={14} />
          <input
            ref={(element: HTMLInputElement) => (findInput = element)}
            type="search"
            value={query()}
            placeholder={t('editor.find')}
            aria-label={t('editor.find')}
            spellcheck={false}
            autocomplete="off"
            onInput={(event) => {
              setQuery(event.currentTarget.value);
              setCurrent(0);
              queueMicrotask(() => reveal(0));
            }}
            onKeyDown={(event) => {
              if (event.key === 'Enter') { event.preventDefault(); reveal(current() + (event.shiftKey ? -1 : 1)); }
              else if (event.key === 'Escape') { event.preventDefault(); event.stopPropagation(); closeFind(); }
            }}
          />
          <span data-vesta="code-editor-count" role="status">{count()}</span>
          <IconButton size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-up" />} label={t('editor.previous-match')}
            disabled={!matches().length} onClick={() => reveal(current() - 1)} />
          <IconButton size="sm" variant="ghost" icon={<Icon name="icons/navigation/arrow-down" />} label={t('editor.next-match')}
            disabled={!matches().length} onClick={() => reveal(current() + 1)} />
          <IconButton size="sm" variant="ghost" icon={<Icon name="icons/actions/close" />} label={t('editor.close-find')} onClick={closeFind} />
        </div>
      </Show>
      <div data-vesta="code-editor-body">
        <pre
          data-vesta="code-editor-overlay"
          aria-hidden="true"
          style={{ transform: `translate(${-scroll().left}px, ${first() * LINE - scroll().top}px)` }}
          innerHTML={html()}
        />
        <textarea
          ref={area}
          data-vesta="code-editor-input"
          value={props.value}
          readonly={props.readOnly}
          aria-label={props['aria-label']}
          spellcheck={false}
          autocomplete="off"
          wrap="off"
          onInput={(event) => props.onChange?.(event.currentTarget.value)}
          onScroll={() => sync()}
        />
      </div>
    </div>
  );
}
