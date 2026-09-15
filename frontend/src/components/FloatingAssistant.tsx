'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

const GREETING: Msg = {
  role: 'assistant',
  content:
    "Hi! I'm ToTo, your HR assistant. Ask me about your leave balance, claims, payslips, appraisals, training — or I can help you apply for leave or submit a claim. I can only show information you're allowed to see.",
};

export default function FloatingAssistant() {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<Msg[]>([GREETING]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (scrollRef.current) scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
  }, [messages, open, loading]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  async function send() {
    const text = input.trim();
    if (!text || loading) return;
    const next: Msg[] = [...messages, { role: 'user', content: text }];
    setMessages(next);
    setInput('');
    setLoading(true);
    try {
      // Send the conversation minus the static greeting; the API needs the
      // last message to be from the user.
      const history = next.filter((m) => m !== GREETING);
      const data = await apiFetch('/assistant/chat', {
        method: 'POST',
        body: JSON.stringify({ messages: history }),
      });
      setMessages([...next, { role: 'assistant', content: data.reply ?? "Sorry, I couldn't answer that." }]);
    } catch (e: any) {
      setMessages([
        ...next,
        { role: 'assistant', content: e?.message?.includes('not configured')
            ? 'The assistant is not configured yet — an administrator needs to add an API key.'
            : `Sorry, something went wrong: ${e?.message ?? 'unknown error'}` },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function onKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      send();
    }
  }

  return (
    <>
      {/* Launcher bubble (sits above the phone bottom bar) */}
      {!open && (
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Open HR assistant"
          className="fixed bottom-20 lg:bottom-5 right-4 lg:right-5 z-50 flex h-[56px] w-[56px] items-center justify-center rounded-full bg-tint border-2 border-accent shadow-card transition hover:scale-105"
        >
          <TurtleAvatar size={46} />
        </button>
      )}

      {/* Chat panel */}
      {open && (
        <div
          role="dialog"
          aria-label="HR assistant"
          className="fixed bottom-20 lg:bottom-5 right-4 lg:right-5 z-50 flex h-[min(560px,75vh)] w-[min(380px,calc(100vw-2rem))] flex-col overflow-hidden rounded-card border border-rule bg-paper shadow-card"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-rule px-4 h-14">
            <div className="flex items-center gap-2.5">
              <span className="flex h-9 w-9 items-center justify-center rounded-full bg-tint">
                <TurtleAvatar size={32} />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold text-ink">ToTo</p>
                <p className="text-xs text-muted">HR assistant</p>
              </div>
            </div>
            <div className="flex items-center gap-0.5">
              <button type="button" onClick={() => setOpen(false)} aria-label="Minimise" title="Minimise" className="w-9 h-9 flex items-center justify-center rounded-control text-muted hover:bg-page hover:text-ink">
                <MinimizeIcon className="h-5 w-5" />
              </button>
              <button type="button" onClick={() => { setMessages([GREETING]); setOpen(false); }} aria-label="Close and clear chat" title="Close and clear" className="w-9 h-9 flex items-center justify-center rounded-control text-muted hover:bg-page hover:text-ink">
                <CloseIcon className="h-5 w-5" />
              </button>
            </div>
          </div>

          {/* Messages */}
          <div ref={scrollRef} className="flex-1 space-y-2.5 overflow-y-auto bg-page p-3" aria-live="polite">
            {messages.map((m, i) => (
              <div key={i} className={m.role === 'user' ? 'flex justify-end' : 'flex justify-start'}>
                <div
                  className={
                    'max-w-[85%] whitespace-pre-wrap px-3.5 py-2 text-sm leading-normal ' +
                    (m.role === 'user'
                      ? 'rounded-card rounded-br-control bg-accent text-on-accent'
                      : 'rounded-card rounded-bl-control border border-rule bg-paper text-ink')
                  }
                >
                  {m.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="flex items-center gap-1 rounded-card border border-rule bg-paper px-3.5 py-3" aria-label="Assistant is typing">
                  <Dot /> <Dot delay="150ms" /> <Dot delay="300ms" />
                </div>
              </div>
            )}
          </div>

          {/* Input */}
          <div className="border-t border-rule bg-paper p-2.5">
            <div className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={onKeyDown}
                placeholder="Ask about your leave, claims, payslip…"
                aria-label="Message"
                className="flex-1 h-10 rounded-control border border-rule bg-paper px-3 text-sm text-ink placeholder:text-muted focus:border-accent"
              />
              <button
                type="button"
                onClick={send}
                disabled={loading || !input.trim()}
                aria-label="Send"
                className="flex h-10 w-10 shrink-0 items-center justify-center rounded-control bg-accent text-on-accent transition hover:opacity-95 disabled:opacity-40"
              >
                <SendIcon className="h-4 w-4" />
              </button>
            </div>
            <p className="mt-1.5 px-1 text-xs text-muted">Answers are limited to what your role can access.</p>
          </div>
        </div>
      )}
    </>
  );
}

function Dot({ delay = '0ms' }: { delay?: string }) {
  return <span className="h-1.5 w-1.5 rounded-full animate-bounce bg-muted" style={{ animationDelay: delay }} />;
}

/**
 * ToTo — a small, friendly turtle in the brand greens with a brass-edged
 * shell (the same carapace idea as the logo, drawn soft). Pure SVG, so it
 * scales and follows the tokens.
 */
function TurtleAvatar({ size = 32 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 64 64" aria-hidden="true" style={{ display: 'block', flexShrink: 0 }}>
      {/* back flippers */}
      <ellipse cx="16" cy="46" rx="7.5" ry="4.2" fill="#3FA07C" transform="rotate(-25 16 46)" />
      <ellipse cx="48" cy="46" rx="7.5" ry="4.2" fill="#3FA07C" transform="rotate(25 48 46)" />
      {/* shell */}
      <path d="M12 38 C12 22 21 14 32 14 C43 14 52 22 52 38 Z" fill="var(--accent)" />
      <path d="M10 38 H54 C54 42 50 44 46 44 H18 C14 44 10 42 10 38 Z" fill="#C08A3E" />
      {/* scutes */}
      <path d="M32 19 L39 24 L36 31 L28 31 L25 24 Z" fill="none" stroke="#C08A3E" strokeWidth="1.8" strokeLinejoin="round" />
      <path d="M25 24 L18 29 M39 24 L46 29 M28 31 L23 38 M36 31 L41 38" fill="none" stroke="#C08A3E" strokeWidth="1.8" strokeLinecap="round" />
      {/* head */}
      <circle cx="32" cy="46" r="11" fill="#3FA07C" />
      <circle cx="27.5" cy="44" r="2.3" fill="#1A1A18" />
      <circle cx="36.5" cy="44" r="2.3" fill="#1A1A18" />
      <circle cx="28.3" cy="43.2" r="0.8" fill="#FFFFFF" />
      <circle cx="37.3" cy="43.2" r="0.8" fill="#FFFFFF" />
      <path d="M28 49 Q32 52.5 36 49" fill="none" stroke="#1A1A18" strokeWidth="1.6" strokeLinecap="round" />
      {/* cheeks */}
      <circle cx="23.5" cy="47.5" r="1.9" fill="#E5735F" opacity="0.6" />
      <circle cx="40.5" cy="47.5" r="1.9" fill="#E5735F" opacity="0.6" />
    </svg>
  );
}

function SendIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="22" y1="2" x2="11" y2="13" />
      <polygon points="22 2 15 22 11 13 2 9 22 2" />
    </svg>
  );
}

function MinimizeIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="6" y1="18" x2="18" y2="18" />
    </svg>
  );
}

function CloseIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <line x1="18" y1="6" x2="6" y2="18" />
      <line x1="6" y1="6" x2="18" y2="18" />
    </svg>
  );
}
