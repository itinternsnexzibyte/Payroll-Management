'use client';
import { useEffect } from 'react';
import { CheckCircle2 } from 'lucide-react';
import { cn } from '../lib/format';

// Deterministic particle layout (no Math.random, so server and client render the same markup).
const PARTICLES = Array.from({ length: 18 }, (_, i) => {
  const h = (n: number) => ((Math.sin(i * 12.9898 + n * 78.233) * 43758.5453) % 1 + 1) % 1;
  return {
    left: `${(h(1) * 100).toFixed(2)}%`,
    size: `${(2 + h(2) * 4).toFixed(1)}px`,
    duration: `${(14 + h(3) * 16).toFixed(1)}s`,
    delay: `${(-h(4) * 30).toFixed(1)}s`,
    drift: `${Math.round((h(5) - 0.5) * 120)}px`,
    opacity: (0.25 + h(6) * 0.45).toFixed(2),
    color: i % 3 === 0 ? '#0cb884' : i % 3 === 1 ? '#3b86d1' : '#9dbbe6',
  };
});

/** Slowly drifting colour fields, a panning grid and rising particles behind the content. */
export function AmbientBackground({ variant = 'app', className }: { variant?: 'app' | 'panel'; className?: string }) {
  return (
    <div className={cn('fx-ambient', variant === 'panel' && 'fx-ambient--panel', className)} aria-hidden>
      <div className="fx-blob fx-blob--a" />
      <div className="fx-blob fx-blob--b" />
      <div className="fx-blob fx-blob--c" />
      <div className="fx-grid" />
      {PARTICLES.map((p, i) => (
        <span
          key={i}
          className="fx-particle"
          style={{ left: p.left, ['--s' as string]: p.size, ['--d' as string]: p.duration, ['--delay' as string]: p.delay, ['--x' as string]: p.drift, ['--o' as string]: p.opacity, ['--c' as string]: p.color }}
        />
      ))}
    </div>
  );
}

const STEPS = ['Draft', 'Calculated', 'Approved', 'Finalised'];

/** Decorative live illustration for the sign-in / sign-up brand panel. */
export function BrandPanelArt() {
  return (
    <div className="pointer-events-none absolute inset-0" aria-hidden>
      <AmbientBackground variant="panel" />
      <svg className="absolute bottom-[18%] left-0 h-48 w-full" viewBox="0 0 600 200" preserveAspectRatio="none" fill="none">
        <defs>
          <linearGradient id="fx-line" x1="0" x2="1">
            <stop offset="0" stopColor="#3b86d1" stopOpacity="0" />
            <stop offset="0.3" stopColor="#3b86d1" />
            <stop offset="1" stopColor="#0cb884" />
          </linearGradient>
        </defs>
        <path className="fx-trace" d="M0 160 C 60 150, 90 120, 140 128 S 230 80, 280 96 S 370 40, 420 58 S 520 20, 600 26" stroke="url(#fx-line)" strokeWidth="2.5" strokeLinecap="round" />
        <path className="fx-trace fx-trace--slow" d="M0 180 C 80 172, 120 160, 180 164 S 280 130, 340 140 S 450 100, 510 108 S 570 90, 600 92" stroke="#9dbbe6" strokeOpacity="0.45" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
      <div className="fx-float fx-glass absolute right-10 top-24 hidden w-56 rounded-2xl px-4 py-3 text-white xl:right-16 [@media(min-height:700px)]:block">
        <div className="flex items-center justify-between text-[11px] uppercase tracking-[0.14em] text-haze">
          <span>Payroll run</span>
          <span className="flex items-center gap-1.5 normal-case tracking-normal text-accent">
            <span className="fx-live-dot h-1.5 w-1.5 rounded-full bg-accent" /> Live
          </span>
        </div>
        <ol className="mt-2.5 space-y-1.5">
          {STEPS.map((s, i) => (
            <li key={s} className="flex items-center gap-2.5 text-sm">
              <span className="relative flex h-5 w-5 items-center justify-center rounded-full bg-white/10 ring-1 ring-white/20">
                <span className="fx-step-dot h-2 w-2 rounded-full bg-accent" style={{ animationDelay: `${i * 0.9}s` }} />
              </span>
              <span className="text-white/90">{s}</span>
            </li>
          ))}
        </ol>
      </div>
      <div className="fx-float fx-float--late fx-glass absolute bottom-[8%] right-24 flex items-center gap-3 rounded-2xl px-4 py-3 text-white xl:right-32">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-accent/20 text-accent">
          <CheckCircle2 className="h-5 w-5" />
        </span>
        <span className="leading-tight">
          <span className="block text-sm font-medium">Payslips issued</span>
          <span className="block text-xs text-haze">Locked, audited, ready to share</span>
        </span>
        <span className="ml-2 flex h-8 items-end gap-1">
          {[40, 65, 50, 85, 100].map((h, i) => (
            <span key={i} className="fx-bar w-1.5 rounded-sm bg-gradient-to-t from-secondary to-accent" style={{ height: `${h}%`, animationDelay: `${i * 0.12}s` }} />
          ))}
        </span>
      </div>
    </div>
  );
}

const RIPPLE_TARGETS =
  'button:not(:disabled), a[href], [role="menuitem"], [role="tab"], [role="option"], select:not(:disabled), summary, label:has(> input[type="checkbox"]), input[type="checkbox"]:not(:disabled)';

function isDark(el: Element): boolean {
  for (let node: Element | null = el; node; node = node.parentElement) {
    const cs = getComputedStyle(node);
    if (cs.backgroundImage.includes('gradient')) return true;
    const m = cs.backgroundColor.match(/rgba?\(([\d.]+)[ ,]+([\d.]+)[ ,]+([\d.]+)(?:[ ,/]+([\d.]+))?/);
    if (m && (m[4] === undefined || Number(m[4]) > 0.4)) {
      const [r, g, b] = [m[1], m[2], m[3]].map(Number);
      return 0.2126 * r + 0.7152 * g + 0.0722 * b < 140;
    }
  }
  return false;
}

/**
 * One delegated listener that gives every button, link and option a ripple from the pointer, plus a
 * burst of teal sparks on primary actions. Drawn in a fixed overlay so no component's layout changes.
 */
export function InteractionEffects() {
  useEffect(() => {
    const reduced = window.matchMedia('(prefers-reduced-motion: reduce)');
    const onDown = (e: PointerEvent) => {
      if (e.button !== 0 || reduced.matches) return;
      const el = (e.target as Element | null)?.closest(RIPPLE_TARGETS);
      if (!el || el.closest('[data-no-ripple]')) return;
      const target = el;
      const r = target.getBoundingClientRect();
      if (!r.width || !r.height || (r.width > 900 && r.height > 300)) return;
      const cs = getComputedStyle(target);
      const host = document.createElement('div');
      host.className = 'fx-ripple-host';
      Object.assign(host.style, { left: `${r.left}px`, top: `${r.top}px`, width: `${r.width}px`, height: `${r.height}px`, borderRadius: cs.borderRadius });
      const x = e.clientX - r.left;
      const y = e.clientY - r.top;
      const size = 2 * Math.hypot(Math.max(x, r.width - x), Math.max(y, r.height - y));
      const dot = document.createElement('span');
      dot.className = 'fx-ripple';
      const dark = isDark(target);
      Object.assign(dot.style, {
        left: `${x}px`,
        top: `${y}px`,
        width: `${size}px`,
        height: `${size}px`,
        background: dark ? 'radial-gradient(circle, rgb(255 255 255 / 0.55), rgb(12 184 132 / 0.25) 60%, transparent 70%)' : 'radial-gradient(circle, rgb(59 134 209 / 0.28), rgb(12 184 132 / 0.12) 60%, transparent 70%)',
      });
      host.appendChild(dot);
      document.body.appendChild(host);
      window.setTimeout(() => host.remove(), 800);

      if (target.matches('[data-fx="primary"]')) {
        for (let i = 0; i < 8; i++) {
          const a = (Math.PI * 2 * i) / 8 + Math.random() * 0.4;
          const d = 22 + Math.random() * 18;
          const s = document.createElement('span');
          s.className = 'fx-spark';
          Object.assign(s.style, { left: `${e.clientX}px`, top: `${e.clientY}px`, background: i % 2 ? '#0cb884' : '#9dbbe6' });
          s.style.setProperty('--dx', `${Math.cos(a) * d}px`);
          s.style.setProperty('--dy', `${Math.sin(a) * d}px`);
          document.body.appendChild(s);
          window.setTimeout(() => s.remove(), 650);
        }
      }
    };
    document.addEventListener('pointerdown', onDown, { passive: true });
    return () => document.removeEventListener('pointerdown', onDown);
  }, []);
  return null;
}
