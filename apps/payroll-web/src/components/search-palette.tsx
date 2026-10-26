'use client';
import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useQuery } from '@tanstack/react-query';
import { Search } from 'lucide-react';
import { get } from '@nexzi/ui';

interface Hit {
  type: string;
  title: string;
  subtitle: string | null;
  href: string;
}

/** Ctrl/⌘+K command palette: searches employees, payroll months and clients the user may open. */
export function SearchPalette() {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState('');
  const [debounced, setDebounced] = useState('');
  const [active, setActive] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const router = useRouter();

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => !o);
      } else if (e.key === 'Escape') setOpen(false);
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  useEffect(() => {
    if (open) setTimeout(() => input.current?.focus(), 0);
    else {
      setText('');
      setDebounced('');
    }
  }, [open]);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(text.trim()), 200);
    return () => clearTimeout(t);
  }, [text]);

  const q = useQuery({ queryKey: ['search', debounced], queryFn: () => get<{ results: Hit[] }>(`/analytics/search?q=${encodeURIComponent(debounced)}`), enabled: open && debounced.length >= 2 });
  const hits = q.data?.results ?? [];
  const go = (h: Hit) => {
    setOpen(false);
    router.push(h.href);
  };

  return (
    <>
      <button type="button" onClick={() => setOpen(true)} className="no-print fixed bottom-4 right-4 z-40 flex items-center gap-2 rounded-full border border-line bg-white px-3 py-2 text-xs text-muted shadow-lg hover:text-ink" aria-label="Search (Ctrl+K)">
        <Search className="h-4 w-4" aria-hidden /> Search <kbd className="rounded border border-line px-1">Ctrl K</kbd>
      </button>
      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center bg-black/40 p-4 pt-24" onClick={() => setOpen(false)} role="dialog" aria-modal="true" aria-label="Search">
          <div className="w-full max-w-lg overflow-hidden rounded-xl bg-white shadow-2xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center gap-2 border-b border-line px-3">
              <Search className="h-4 w-4 text-muted" aria-hidden />
              <input
                ref={input}
                value={text}
                onChange={(e) => {
                  setText(e.target.value);
                  setActive(0);
                }}
                onKeyDown={(e) => {
                  if (e.key === 'ArrowDown') {
                    e.preventDefault();
                    setActive((a) => Math.min(a + 1, hits.length - 1));
                  } else if (e.key === 'ArrowUp') {
                    e.preventDefault();
                    setActive((a) => Math.max(a - 1, 0));
                  } else if (e.key === 'Enter' && hits[active]) go(hits[active]);
                }}
                placeholder="Search employees, payroll months, clients…"
                className="w-full bg-transparent py-3 text-sm outline-none"
              />
            </div>
            <ul className="max-h-80 overflow-y-auto py-1" role="listbox">
              {debounced.length < 2 && <li className="px-4 py-3 text-sm text-muted">Type at least 2 characters.</li>}
              {debounced.length >= 2 && !q.isLoading && hits.length === 0 && <li className="px-4 py-3 text-sm text-muted">No matches.</li>}
              {hits.map((h, i) => (
                <li key={`${h.type}-${h.href}-${i}`} role="option" aria-selected={i === active}>
                  <button type="button" onMouseEnter={() => setActive(i)} onClick={() => go(h)} className={`flex w-full items-center justify-between px-4 py-2 text-left text-sm ${i === active ? 'bg-brand-50' : ''}`}>
                    <span>
                      {h.title}
                      {h.subtitle && <span className="ml-2 text-xs text-muted">{h.subtitle}</span>}
                    </span>
                    <span className="text-xs text-muted">{h.type}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </>
  );
}
