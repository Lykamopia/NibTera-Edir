'use client';

import { useEffect, useRef } from 'react';
import { cn } from '@/lib/utils';
import { Bold, Italic, Underline, List, ListOrdered, Heading1, Heading2, Heading3, Quote, Link2, Pilcrow, Undo, Redo } from 'lucide-react';

/**
 * Lightweight semantic WYSIWYG editor (no external deps). Emits clean HTML using
 * heading/list/emphasis tags, which the server sanitizes on save. Uncontrolled
 * content area to preserve caret position; parent is synced via onChange.
 */
export function RichTextEditor({ value, onChange, className }: { value: string; onChange: (html: string) => void; className?: string }) {
  const ref = useRef<HTMLDivElement>(null);

  // Initialise once; do not re-write innerHTML on every keystroke (would reset caret).
  useEffect(() => {
    if (ref.current && ref.current.innerHTML !== (value || '')) ref.current.innerHTML = value || '';
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const sync = () => onChange(ref.current?.innerHTML ?? '');
  const exec = (command: string, arg?: string) => {
    ref.current?.focus();
    try { document.execCommand(command, false, arg); } catch { /* no-op */ }
    sync();
  };
  const block = (tag: string) => exec('formatBlock', `<${tag}>`);
  const link = () => { const url = window.prompt('Link URL (https://…)'); if (url) exec('createLink', url); };

  const Btn = ({ onClick, title, children }: { onClick: () => void; title: string; children: React.ReactNode }) => (
    <button type="button" title={title} onMouseDown={(e) => e.preventDefault()} onClick={onClick}
      className="flex h-8 w-8 items-center justify-center rounded text-muted-foreground hover:bg-background hover:text-foreground">
      {children}
    </button>
  );

  return (
    <div className={cn('overflow-hidden rounded-md border', className)}>
      <div className="flex flex-wrap items-center gap-0.5 border-b bg-muted/40 p-1">
        <Btn onClick={() => block('h1')} title="Heading 1"><Heading1 className="h-4 w-4" /></Btn>
        <Btn onClick={() => block('h2')} title="Heading 2"><Heading2 className="h-4 w-4" /></Btn>
        <Btn onClick={() => block('h3')} title="Heading 3"><Heading3 className="h-4 w-4" /></Btn>
        <Btn onClick={() => block('p')} title="Paragraph"><Pilcrow className="h-4 w-4" /></Btn>
        <span className="mx-1 h-5 w-px bg-border" />
        <Btn onClick={() => exec('bold')} title="Bold"><Bold className="h-4 w-4" /></Btn>
        <Btn onClick={() => exec('italic')} title="Italic"><Italic className="h-4 w-4" /></Btn>
        <Btn onClick={() => exec('underline')} title="Underline"><Underline className="h-4 w-4" /></Btn>
        <span className="mx-1 h-5 w-px bg-border" />
        <Btn onClick={() => exec('insertUnorderedList')} title="Bulleted list"><List className="h-4 w-4" /></Btn>
        <Btn onClick={() => exec('insertOrderedList')} title="Numbered list"><ListOrdered className="h-4 w-4" /></Btn>
        <Btn onClick={() => block('blockquote')} title="Quote"><Quote className="h-4 w-4" /></Btn>
        <Btn onClick={link} title="Insert link"><Link2 className="h-4 w-4" /></Btn>
        <span className="mx-1 h-5 w-px bg-border" />
        <Btn onClick={() => exec('undo')} title="Undo"><Undo className="h-4 w-4" /></Btn>
        <Btn onClick={() => exec('redo')} title="Redo"><Redo className="h-4 w-4" /></Btn>
      </div>
      <div
        ref={ref}
        contentEditable
        suppressContentEditableWarning
        onInput={sync}
        onBlur={sync}
        className="prose prose-sm max-w-none min-h-[320px] overflow-y-auto p-4 focus:outline-none"
        data-placeholder="Start writing the rules and bylaws…"
      />
    </div>
  );
}
