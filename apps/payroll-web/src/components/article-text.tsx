import type { ReactNode } from 'react';

/**
 * Renders article text with a tiny, safe subset of Markdown: "# " / "## " headings, "- " bullets,
 * "1. " numbered steps and blank-line paragraphs. Everything is rendered as React text (no HTML),
 * so pasted content cannot inject markup.
 */
export function ArticleText({ text }: { text: string }) {
  const out: ReactNode[] = [];
  let list: { ordered: boolean; items: string[] } | null = null;
  let para: string[] = [];
  const flushPara = () => {
    if (para.length) out.push(<p key={`p${out.length}`}>{para.join(' ')}</p>);
    para = [];
  };
  const flushList = () => {
    if (!list) return;
    const items = list.items.map((t, i) => <li key={i}>{t}</li>);
    out.push(list.ordered ? <ol key={`o${out.length}`} className="list-decimal space-y-1 pl-5">{items}</ol> : <ul key={`u${out.length}`} className="list-disc space-y-1 pl-5">{items}</ul>);
    list = null;
  };
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trimEnd();
    const bullet = /^\s*[-*]\s+(.*)$/.exec(line);
    const numbered = /^\s*\d+[.)]\s+(.*)$/.exec(line);
    if (!line.trim()) {
      flushPara();
      flushList();
    } else if (line.startsWith('## ')) {
      flushPara();
      flushList();
      out.push(<h4 key={`h${out.length}`} className="pt-2 text-sm font-semibold text-ink">{line.slice(3)}</h4>);
    } else if (line.startsWith('# ')) {
      flushPara();
      flushList();
      out.push(<h3 key={`h${out.length}`} className="pt-3 text-base font-semibold text-ink">{line.slice(2)}</h3>);
    } else if (bullet || numbered) {
      flushPara();
      const ordered = !!numbered;
      if (!list || list.ordered !== ordered) {
        flushList();
        list = { ordered, items: [] };
      }
      list.items.push((bullet ?? numbered)![1]);
    } else {
      flushList();
      para.push(line.trim());
    }
  }
  flushPara();
  flushList();
  return <div className="space-y-3 text-[15px] leading-relaxed text-ink">{out}</div>;
}
