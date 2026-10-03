"use client";

import { AnimatePresence, motion } from "framer-motion";
import { useEffect, useRef, useState } from "react";
import { CHAT_MAX_LEN, type ChatMessage, type ChatResult } from "@/lib/protocol";

/** Messages fade out of the docked (desktop) view after this long unless the chat is open. */
const FADE_MS = 15_000;
const SHOWN = 8;

/**
 * Desktop (lg+): docked bottom-right, recent lines fade away, Enter to type.
 * Smaller screens: a chat button bottom-left with an unread badge that
 * opens a panel above the hotbar.
 */
export function Chat({
  messages,
  myId,
  send,
}: {
  messages: ChatMessage[];
  myId: string | null;
  send: (text: string) => Promise<ChatResult>;
}) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const [seen, setSeen] = useState(0);
  const [, tick] = useState(0);
  const input = useRef<HTMLInputElement>(null);
  const list = useRef<HTMLOListElement>(null);

  const lastId = messages[messages.length - 1]?.id ?? 0;
  const unread = open ? 0 : messages.filter((m) => m.id > seen && m.who.id !== myId).length;

  useEffect(() => {
    if (open) setSeen(lastId);
  }, [open, lastId]);

  // re-render so old lines fade on the docked view
  useEffect(() => {
    const id = setInterval(() => tick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, []);

  useEffect(() => {
    list.current?.scrollTo({ top: list.current.scrollHeight });
  }, [lastId, open]);

  // Enter or "/" opens the chat from anywhere (unless already typing somewhere)
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      if (t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.isContentEditable)) return;
      if (e.key === "Enter" || e.key === "/") {
        e.preventDefault();
        setOpen(true);
        requestAnimationFrame(() => input.current?.focus());
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  useEffect(() => {
    if (!error) return;
    const id = setTimeout(() => setError(null), 2500);
    return () => clearTimeout(id);
  }, [error]);

  const close = () => {
    setOpen(false);
    setText("");
    input.current?.blur();
  };

  const submit = async () => {
    const msg = text.trim();
    if (!msg) {
      close();
      return;
    }
    if (sending) return;
    setSending(true);
    const res = await send(msg);
    setSending(false);
    if (res.ok) {
      setText("");
      // desktop: Enter sends and gets out of the way; touch keeps the panel up
      if (window.matchMedia("(min-width: 1024px)").matches) close();
    } else {
      setError(res.reason);
    }
  };

  const now = Date.now();
  const visible = messages.slice(-(open ? 40 : SHOWN));

  return (
    <>
      {/* mobile / tablet toggle */}
      <button
        type="button"
        onClick={() => (open ? close() : (setOpen(true), requestAnimationFrame(() => input.current?.focus())))}
        aria-label={open ? "Close chat" : "Open chat"}
        className="absolute bottom-[max(1.25rem,env(safe-area-inset-bottom))] left-4 flex h-9 w-9 items-center justify-center rounded-full border border-black/[0.06] bg-white/70 text-ink shadow-[0_8px_24px_rgba(29,29,31,0.07)] backdrop-blur-xl transition-transform active:scale-95 sm:bottom-7 sm:left-8 sm:h-10 sm:w-10 lg:hidden"
      >
        <svg width="16" height="16" viewBox="0 0 16 16" aria-hidden>
          <path d="M2 3h12v8H6l-3 3v-3H2z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
        </svg>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 min-w-4 rounded-full bg-claude px-1 text-center font-mono text-[9px] font-bold leading-4 text-white">
            {unread > 9 ? "9+" : unread}
          </span>
        )}
      </button>

      <div
        className={`absolute inset-x-3 bottom-[calc(max(1.25rem,env(safe-area-inset-bottom))+7.5rem)] sm:inset-x-auto sm:bottom-40 sm:left-8 sm:w-[340px] lg:bottom-40 lg:left-auto lg:right-8 lg:block lg:w-[320px] ${open ? "block" : "hidden"} ${open ? "pointer-events-auto" : "pointer-events-none"}`}
      >
        <div
          className={`transition-colors duration-200 ${open ? "rounded-xl border border-black/[0.06] bg-white/85 p-2 shadow-[0_12px_32px_rgba(29,29,31,0.12)] backdrop-blur-xl" : "p-2"}`}
        >
          <ol
            ref={list}
            className={`flex flex-col gap-1 overflow-y-auto overscroll-contain ${open ? "max-h-[min(40dvh,260px)]" : "max-h-none"}`}
          >
            {open && messages.length === 0 && (
              <li className="px-1 py-2 text-center font-mono text-[11px] text-muted">no one's said anything. yet.</li>
            )}
            <AnimatePresence initial={false}>
              {visible.map((m) => {
                const age = now - m.t;
                const faded = !open && age > FADE_MS;
                const me = m.who.id === myId;
                return (
                  <motion.li
                    key={m.id}
                    layout="position"
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: faded ? 0 : 1, y: 0 }}
                    transition={{ duration: faded ? 0.8 : 0.18 }}
                    className={`break-words text-[13px] leading-snug ${open ? "px-1" : "w-fit max-w-full rounded-lg bg-white/75 px-2 py-1 shadow-[0_4px_14px_rgba(29,29,31,0.08)] backdrop-blur-md"}`}
                  >
                    <span className="font-semibold" style={{ color: m.who.color }}>
                      {m.who.name}
                      {me && <span className="font-normal text-muted"> (you)</span>}
                    </span>
                    <span className="text-muted">: </span>
                    <span className="text-ink">{m.text}</span>
                  </motion.li>
                );
              })}
            </AnimatePresence>
          </ol>

          <form
            onSubmit={(e) => {
              e.preventDefault();
              void submit();
            }}
            className={`${open ? "mt-2" : "mt-1.5"} pointer-events-auto`}
          >
            <div className="relative">
              <input
                ref={input}
                value={text}
                onChange={(e) => setText(e.target.value.slice(0, CHAT_MAX_LEN))}
                onFocus={() => setOpen(true)}
                onKeyDown={(e) => {
                  if (e.key === "Escape") close();
                }}
                maxLength={CHAT_MAX_LEN}
                enterKeyHint="send"
                autoComplete="off"
                placeholder={open ? "say something to the room…" : "press Enter to chat"}
                aria-label="Chat message"
                className={`w-full rounded-lg border px-2.5 py-1.5 text-[13px] text-ink outline-none transition-colors placeholder:text-muted/70 ${
                  open
                    ? "border-black/10 bg-white focus:border-claude"
                    : "border-black/[0.06] bg-white/60 backdrop-blur-md"
                }`}
              />
              {open && text.length > CHAT_MAX_LEN - 30 && (
                <span className="absolute right-2 top-1/2 -translate-y-1/2 font-mono text-[10px] text-muted">
                  {CHAT_MAX_LEN - text.length}
                </span>
              )}
            </div>
            {error && <p className="mt-1 px-1 font-mono text-[10px] text-red-500">{error}</p>}
          </form>
        </div>
      </div>
    </>
  );
}
