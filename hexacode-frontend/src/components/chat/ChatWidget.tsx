import { useEffect, useRef, useState } from "react";
import { useLocation } from "react-router-dom";
import { Bot, Loader2, MessageSquareText, RefreshCw, Send, Sparkles, X } from "lucide-react";
import {
  postChatMessages,
  type ChatArea,
  type ChatMessage,
} from "@/lib/api";
import { Button } from "@/components/ui/Button";
import { EmptyState, ErrorBanner } from "@/components/ui/Feedback";
import { Textarea } from "@/components/ui/Input";
import { cn } from "@/lib/utils";

const STORAGE_KEY = "hexacode.chat.widget";
const MAX_HISTORY = 12;
const MAX_INPUT_CHARS = 2_000;

type ChatEntry = ChatMessage & {
  id: string;
  createdAt: string;
  requestId?: string;
};

type PersistedState = {
  open: boolean;
  sessionId: string;
  messages: ChatEntry[];
};

function createSessionId() {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return crypto.randomUUID();
  }
  return `chat-${Math.random().toString(36).slice(2, 10)}`;
}

function trimMessages(messages: ChatEntry[]) {
  return messages.slice(-MAX_HISTORY);
}

function isChatRole(value: unknown): value is ChatMessage["role"] {
  return value === "user" || value === "assistant";
}

function isChatEntry(value: unknown): value is ChatEntry {
  if (!value || typeof value !== "object") return false;
  const candidate = value as Partial<ChatEntry>;
  return (
    typeof candidate.id === "string" &&
    typeof candidate.createdAt === "string" &&
    typeof candidate.content === "string" &&
    isChatRole(candidate.role)
  );
}

function loadPersistedState(): PersistedState {
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return { open: false, sessionId: createSessionId(), messages: [] };
    }
    const parsed = JSON.parse(raw) as Partial<PersistedState>;
    return {
      open: Boolean(parsed.open),
      sessionId: typeof parsed.sessionId === "string" && parsed.sessionId ? parsed.sessionId : createSessionId(),
      messages: Array.isArray(parsed.messages) ? trimMessages(parsed.messages.filter(isChatEntry)) : [],
    };
  } catch {
    return { open: false, sessionId: createSessionId(), messages: [] };
  }
}

function persistState(state: PersistedState) {
  try {
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {}
}

function extractProblemSlug(pathname: string) {
  const segments = pathname.split("/").filter(Boolean);
  if (segments[0] !== "problems" || segments.length < 2) return null;
  return segments[1] ?? null;
}

export function ChatWidget({ area }: { area: ChatArea }) {
  const location = useLocation();
  const [state, setState] = useState<PersistedState>(() => loadPersistedState());
  const [draft, setDraft] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const composerRef = useRef<HTMLTextAreaElement | null>(null);
  const logEndRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    persistState(state);
  }, [state]);

  useEffect(() => {
    if (!state.open) return;
    composerRef.current?.focus();
  }, [state.open]);

  useEffect(() => {
    if (!state.open) return;
    logEndRef.current?.scrollIntoView({ behavior: "smooth", block: "end" });
  }, [state.messages, state.open, submitting]);

  const pageContext = {
    route: location.pathname || "/",
    area,
    problemSlug: extractProblemSlug(location.pathname),
  } as const;

  async function handleSend() {
    if (submitting) return;

    const content = draft.trim();
    if (!content) return;
    if (content.length > MAX_INPUT_CHARS) {
      setError(`Messages must be at most ${MAX_INPUT_CHARS} characters.`);
      return;
    }

    const userEntry: ChatEntry = {
      id: createSessionId(),
      role: "user",
      content,
      createdAt: new Date().toISOString(),
    };
    const nextMessages = trimMessages([...state.messages, userEntry]);

    setState((current) => ({
      ...current,
      open: true,
      messages: nextMessages,
    }));
    setDraft("");
    setError(null);
    setSubmitting(true);

    try {
      const response = await postChatMessages({
        sessionId: state.sessionId,
        messages: nextMessages.map((message) => ({
          role: message.role,
          content: message.content,
        })),
        pageContext,
      });

      const assistantEntry: ChatEntry = {
        id: response.requestId || createSessionId(),
        role: "assistant",
        content: response.reply.content,
        createdAt: new Date().toISOString(),
        requestId: response.requestId,
      };
      setState((current) => ({
        ...current,
        messages: trimMessages([...current.messages, assistantEntry]),
      }));
    } catch (requestError) {
      setError((requestError as Error).message);
    } finally {
      setSubmitting(false);
    }
  }

  function handleReset() {
    setState({
      open: true,
      sessionId: createSessionId(),
      messages: [],
    });
    setDraft("");
    setError(null);
  }

  return (
    <div className="pointer-events-none fixed bottom-4 right-4 z-[60] flex max-w-[calc(100vw-1.5rem)] flex-col items-end gap-3">
      {state.open ? (
        <section className="pointer-events-auto flex max-h-[calc(100dvh-2rem)] w-[min(92vw,25rem)] flex-col overflow-hidden rounded-[24px] border border-[var(--color-border-soft)] bg-[var(--color-bg-elevated)] shadow-float">
          <header className="relative overflow-hidden border-b border-[var(--color-border-hair)] px-4 py-4">
            <div className="absolute inset-0 bg-[radial-gradient(circle_at_top_left,rgba(253,186,116,0.45),transparent_55%),radial-gradient(circle_at_bottom_right,rgba(103,232,249,0.24),transparent_48%)]" />
            <div className="relative flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="inline-flex items-center gap-2 rounded-full bg-[var(--color-bg-elevated)]/80 px-2.5 py-1 text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--color-text-secondary)] backdrop-blur">
                  <Sparkles className="h-3.5 w-3.5 text-[var(--color-accent)]" />
                  Problem Lookup
                </div>
                <h2 className="mt-2 text-[16px] font-semibold text-[var(--color-text-primary)]">
                  Find Problems
                </h2>
              </div>
              <Button
                type="button"
                variant="ghost"
                size="icon"
                shape="rect"
                onClick={() => setState((current) => ({ ...current, open: false }))}
                aria-label="Close chat"
              >
                <X className="h-4 w-4" />
              </Button>
            </div>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-4">
            {state.messages.length === 0 ? (
              <EmptyState
                icon={<Bot className="h-5 w-5" />}
                title="Search by topic or pattern"
                description="Try: shortest path, greedy scheduling, sliding window."
                className="border-none bg-[var(--color-bg-muted)] py-10"
              />
            ) : (
              <div className="space-y-3">
                {state.messages.map((message) => (
                  <article
                    key={message.id}
                    className={cn(
                      "flex",
                      message.role === "user" ? "justify-end" : "justify-start",
                    )}
                  >
                    <div
                      className={cn(
                        "max-w-[88%] rounded-[20px] px-3.5 py-3",
                        message.role === "user"
                          ? "bg-[var(--color-accent)] text-[var(--color-accent-fg)]"
                          : "bg-[var(--color-bg-muted)] text-[var(--color-text-primary)] hairline",
                      )}
                    >
                      <div className="whitespace-pre-wrap break-words text-[13px] leading-6 [overflow-wrap:anywhere]">
                        {message.content}
                      </div>
                    </div>
                  </article>
                ))}
                {submitting ? (
                  <div className="flex justify-start">
                    <div className="inline-flex items-center gap-2 rounded-[20px] bg-[var(--color-bg-muted)] px-3.5 py-3 text-[13px] text-[var(--color-text-secondary)] hairline">
                      <Loader2 className="h-4 w-4 animate-spin" />
                      Searching...
                    </div>
                  </div>
                ) : null}
                <div ref={logEndRef} />
              </div>
            )}
          </div>

          <div className="border-t border-[var(--color-border-hair)] px-4 py-4">
            {error ? (
              <ErrorBanner
                title="Chat request failed"
                message={error}
                className="mb-3"
              />
            ) : null}

            <div className="mb-3 flex justify-end">
              <button
                type="button"
                onClick={handleReset}
                className="inline-flex items-center gap-1 text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]"
              >
                <RefreshCw className="h-3.5 w-3.5" />
                New thread
              </button>
            </div>

            <div className="space-y-3">
              <Textarea
                ref={composerRef}
                value={draft}
                onChange={(event) => setDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder="Find problems by topic, technique, or keywords."
                className="min-h-[108px] resize-none rounded-[18px] bg-[var(--color-bg-muted)] px-4 py-3"
                maxLength={MAX_INPUT_CHARS}
              />
              <div className="flex items-center justify-between gap-3">
                <div className="text-[11px] text-[var(--color-text-tertiary)]">
                  {draft.length}/{MAX_INPUT_CHARS}
                </div>
                <Button
                  type="button"
                  onClick={() => void handleSend()}
                  disabled={submitting || draft.trim().length === 0}
                  className="min-w-[112px]"
                >
                  {submitting ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                  Send
                </Button>
              </div>
            </div>
          </div>
        </section>
      ) : null}

      {!state.open ? (
        <Button
          type="button"
          onClick={() => setState((current) => ({ ...current, open: true }))}
          className="pointer-events-auto h-14 px-5 shadow-float"
        >
          <MessageSquareText className="h-4 w-4" />
          Ask Bedrock
        </Button>
      ) : null}
    </div>
  );
}
