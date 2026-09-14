'use client';

import { useEffect, useRef, useState } from 'react';
import { apiFetch } from '@/lib/api';

type Msg = { role: 'user' | 'assistant'; content: string };

const GREETING: Msg = {
  role: 'assistant',
  content:
    "Hi! I'm Vork, your HR assistant. Ask me about your leave balance, claims, payslips, appraisals, training — or I can help you apply for leave or submit a claim. I can only show information you're allowed to see.",
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
          className="fixed bottom-20 lg:bottom-5 right-4 lg:right-5 z-50 flex h-[52px] w-[52px] items-center justify-center rounded-full bg-accent text-on-accent shadow-card transition hover:opacity-95"
        >
          <ChatIcon className="h-6 w-6" />
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
              <span className="flex h-8 w-8 items-center justify-center rounded-full bg-tint text-accent">
                <ChatIcon className="h-4 w-4" />
              </span>
              <div className="leading-tight">
                <p className="text-sm font-bold text-ink">Vork</p>
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
                className="flex-1 h-10 rounded-control border border-rule bg-paper px-3 text-sm text-ink placeholder:text-muted focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
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

function ChatIcon({ className }: { className?: string }) {
  return (
    <svg className={className} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M21 11.5a8.38 8.38 0 0 1-.9 3.8 8.5 8.5 0 0 1-7.6 4.7 8.38 8.38 0 0 1-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 0 1-.9-3.8 8.5 8.5 0 0 1 4.7-7.6 8.38 8.38 0 0 1 3.8-.9h.5a8.48 8.48 0 0 1 8 8v.5z" />
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
