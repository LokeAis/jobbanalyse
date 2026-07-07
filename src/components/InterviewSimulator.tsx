import React, { useState, useRef, useEffect } from 'react';
import { statements, DimensionKey, computeDimensionScore, getBand } from '../data/statements';
import { MessageSquare, Send, RefreshCw, Lock, ArrowRight, Bot, User, ShieldAlert, Sparkles, Ticket, Download, Flag } from 'lucide-react';
import { useAuth } from '../auth/AuthContext';
import CreditPurchase from './CreditPurchase';
import AiConsentNotice, { hasAiConsent } from './AiConsentNotice';
import { track } from '../utils/track';

interface InterviewSimulatorProps {
  answers: Record<string, number>;
  onNavigateToTab: (tabId: string) => void;
}

interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export default function InterviewSimulator({ answers, onNavigateToTab }: InterviewSimulatorProps) {
  const { configured, user, credits, signIn, authedFetch, refreshCredits } = useAuth();

  const totalStatementsCount = statements.length;
  const answeredCount = statements.filter((s) => answers[s.id] !== undefined).length;
  const isCompleted = answeredCount === totalStatementsCount;

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [started, setStarted] = useState(false);
  const [session, setSession] = useState<string | null>(null);
  const [turnsLeft, setTurnsLeft] = useState<number | null>(null);
  const [aiConsent, setAiConsent] = useState<boolean>(() => hasAiConsent());

  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, loading]);

  // Compute Big Five dimension scores for context.
  const getDimensionScores = (): Record<string, { score: number; band: string }> => {
    const keys: DimensionKey[] = ['planmessighet', 'emosjonell_stabilitet', 'ekstroversjon', 'omgjengelighet', 'aapenhet'];
    const result: Record<string, { score: number; band: string }> = {};
    keys.forEach((dim) => {
      const score = computeDimensionScore(dim, answers);
      result[dim] = { score, band: getBand(score) };
    });
    return result;
  };

  const sendTurn = async (
    nextMessages: ChatMessage[],
    sessionToken: string | null,
    restoreOnError?: string,
    forceEnd?: boolean
  ) => {
    setLoading(true);
    setError(null);

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    try {
      const res = await authedFetch('/api/interview-chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          jobTitle: localStorage.getItem('bigfive_prep_job_title') || '',
          jobDescription: localStorage.getItem('bigfive_prep_job_desc') || '',
          dimensionScores: getDimensionScores(),
          messages: nextMessages,
          session: sessionToken,
        }),
        signal: controller.signal,
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data?.error || 'Serveren returnerte en feil.');

      // Starting a new session (no token yet) costs 1 credit — refresh balance.
      if (!sessionToken) {
        refreshCredits();
        track('interview_started');
      }

      setSession(data.session ?? null);
      // Ved bevisst avslutning låser vi økten uansett gjenstående turer, så
      // tilbakemeldingen blir det siste ordet.
      setTurnsLeft(forceEnd ? 0 : typeof data.turnsLeft === 'number' ? data.turnsLeft : null);
      setMessages([...nextMessages, { role: 'assistant', content: data.reply }]);
    } catch (err: any) {
      setError(typeof err?.message === 'string' && err.message.trim() ? err.message : 'Noe gikk galt. Prøv igjen.');
      // Ikke la et mislykket sendeforsøk slette det brukeren skrev — legg det tilbake.
      if (restoreOnError !== undefined) setInput(restoreOnError);
    } finally {
      clearTimeout(timeoutId);
      setLoading(false);
    }
  };

  const handleStart = () => {
    setStarted(true);
    setMessages([]);
    setSession(null);
    setTurnsLeft(null);
    sendTurn([], null);
  };

  const handleSend = () => {
    const text = input.trim();
    if (!text || loading || (turnsLeft !== null && turnsLeft <= 0)) return;
    setInput('');
    sendTurn([...messages, { role: 'user', content: text }], session, text);
  };

  const handleFinish = () => {
    if (loading || !started || messages.length === 0 || (turnsLeft !== null && turnsLeft <= 0)) return;
    const text =
      'Kan du avslutte intervjuet nå med en kort, ærlig oppsummering: mine tydeligste styrker, 2–3 konkrete forbedringspunkter, og ett råd jeg kan ta med til det ekte intervjuet?';
    sendTurn([...messages, { role: 'user', content: text }], session, undefined, true);
  };

  const handleRestart = () => {
    setMessages([]);
    setStarted(false);
    setError(null);
    setInput('');
    setSession(null);
    setTurnsLeft(null);
  };

  const handleExportTranscript = () => {
    let content = `INTERVJU-TRANSKRIPT — BIG FIVE FORBEREDELSE\n`;
    content += `==================================================\n`;
    content += `Dato: ${new Date().toLocaleDateString('no-NO')}\n`;
    content += `==================================================\n\n`;
    messages.forEach((m) => {
      content += `${m.role === 'user' ? 'DU' : 'REKRUTTERER'}:\n${m.content}\n\n`;
    });
    content += `==================================================\n`;
    content += `Personvern: Denne samtalen ble generert av Google Gemini basert på stillingsinfoen og dine Big Five-skårer.`;

    const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'intervju_transkript.txt';
    link.click();
    URL.revokeObjectURL(url);
  };

  const sessionEnded = turnsLeft !== null && turnsLeft <= 0;

  // Gate 1: must be logged in (when auth is configured).
  if (configured && !user) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="bg-white border border-amber-200/70 rounded-2xl p-6 sm:p-8 shadow-xs text-center space-y-5">
          <div className="w-14 h-14 bg-amber-50 border border-amber-100 rounded-full flex items-center justify-center text-amber-600 mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-900">Intervju-simulator</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Øv på et realistisk jobbintervju i sanntid. En AI-rekrutterer stiller deg oppfølgingsspørsmål basert på din Big Five-profil. Logg inn for å starte — ett intervju koster 1 klipp.
            </p>
          </div>
          <button
            onClick={() => signIn()}
            className="w-full bg-teal-700 hover:bg-teal-800 text-white font-semibold py-2.5 px-4 rounded-lg transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
          >
            <Sparkles className="w-4 h-4" />
            Logg inn for å øve
          </button>
        </div>
      </div>
    );
  }

  // Gate 2: must have at least one credit (only relevant before a session starts).
  if (configured && !started && (credits ?? 0) < 1) {
    return (
      <div className="max-w-xl mx-auto py-12 px-4">
        <div className="bg-white border border-amber-200/70 rounded-2xl p-6 sm:p-8 shadow-xs text-center space-y-5">
          <div className="w-14 h-14 bg-amber-50 border border-amber-100 rounded-full flex items-center justify-center text-amber-600 mx-auto">
            <Ticket className="w-6 h-6" />
          </div>
          <div className="space-y-2">
            <h3 className="text-xl font-bold text-slate-900">Du har ingen klipp igjen</h3>
            <p className="text-slate-600 text-sm leading-relaxed">
              Et øvingsintervju koster 1 klipp. Kjøp flere klipp for å starte en ny intervjuøkt.
            </p>
          </div>
          <CreditPurchase />
        </div>
      </div>
    );
  }

  // Gate 3: questionnaire must be completed.
  if (!isCompleted) {
    return (
      <div className="max-w-md mx-auto py-12 px-4 text-center">
        <div className="bg-white border border-slate-200/60 rounded-xl p-8 shadow-xs">
          <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-6 mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          <h2 className="text-xl font-bold text-slate-900 mb-2">Fullfør testen først</h2>
          <p className="text-slate-600 text-sm leading-relaxed mb-6">
            Simulatoren bruker din Big Five-profil for å skreddersy intervjuet. Fullfør de {statements.length} påstandene for å låse den opp.
          </p>
          <button
            onClick={() => onNavigateToTab('questionnaire')}
            className="w-full bg-teal-700 hover:bg-teal-800 text-white font-medium py-2.5 px-4 rounded-lg transition shadow-xs cursor-pointer flex items-center justify-center gap-2"
          >
            Fullfør spørreskjemaet ({answeredCount}/{statements.length})
            <ArrowRight className="w-4 h-4" />
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-3xl mx-auto py-6 px-4">
      <div className="mb-6">
        <div className="inline-flex items-center gap-2 bg-amber-50 border border-amber-100 px-3 py-1 rounded-full text-amber-800 text-xs font-semibold mb-3">
          <Sparkles className="w-3.5 h-3.5 text-amber-500" />
          <span>Premium · Intervju-simulator</span>
        </div>
        <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">Øv på intervjuet i sanntid</h2>
        <p className="text-slate-600 text-sm sm:text-base leading-relaxed">
          En AI-rekrutterer intervjuer deg basert på din profil og stillingen din. Svar så ærlig og konkret du kan — akkurat som i et ekte intervju.
        </p>
      </div>

      {!started ? (
        <div className="bg-white border border-slate-100 rounded-xl p-6 sm:p-8 shadow-xs text-center space-y-5">
          <div className="w-14 h-14 bg-teal-50 rounded-full flex items-center justify-center text-teal-700 mx-auto">
            <Bot className="w-7 h-7" />
          </div>
          <p className="text-slate-600 text-sm leading-relaxed max-w-md mx-auto">
            Rekruttereren tar utgangspunkt i jobben du la inn under «AI Jobbanalyse» (hvis noen). Klar?
          </p>
          <button
            onClick={handleStart}
            disabled={!aiConsent}
            className="bg-teal-700 hover:bg-teal-800 disabled:bg-slate-100 disabled:text-slate-400 disabled:cursor-not-allowed text-white font-bold py-3 px-6 rounded-lg transition shadow-xs cursor-pointer inline-flex items-center gap-2"
          >
            <MessageSquare className="w-5 h-5" />
            Start intervjuet
          </button>
          <div className="max-w-md mx-auto text-left">
            <AiConsentNotice onChange={setAiConsent} />
          </div>
        </div>
      ) : (
        <div className="bg-white border border-slate-100 rounded-xl shadow-xs flex flex-col" style={{ height: '70vh' }}>
          {/* Messages */}
          <div ref={scrollRef} className="flex-1 overflow-y-auto p-4 sm:p-6 space-y-4">
            {messages.map((m, i) => (
              <div key={i} className={`flex gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
                <div
                  className={`w-8 h-8 rounded-full flex items-center justify-center shrink-0 ${
                    m.role === 'user' ? 'bg-slate-200 text-slate-600' : 'bg-teal-700 text-white'
                  }`}
                >
                  {m.role === 'user' ? <User className="w-4 h-4" /> : <Bot className="w-4 h-4" />}
                </div>
                <div
                  className={`max-w-[80%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-line ${
                    m.role === 'user'
                      ? 'bg-slate-100 text-slate-800 rounded-tr-sm'
                      : 'bg-teal-50 text-slate-800 border border-teal-100/50 rounded-tl-sm'
                  }`}
                >
                  {m.content}
                </div>
              </div>
            ))}

            {loading && (
              <div className="flex gap-3" role="status" aria-live="polite">
                <div className="w-8 h-8 rounded-full bg-teal-700 text-white flex items-center justify-center shrink-0">
                  <Bot className="w-4 h-4" />
                </div>
                <div className="bg-teal-50 border border-teal-100/50 rounded-2xl rounded-tl-sm px-4 py-3 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" style={{ animationDelay: '0ms' }} />
                  <span className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" style={{ animationDelay: '150ms' }} />
                  <span className="w-1.5 h-1.5 bg-teal-600 rounded-full animate-bounce" style={{ animationDelay: '300ms' }} />
                </div>
              </div>
            )}

            {error && (
              <div className="p-3 bg-rose-50 border border-rose-100 rounded-lg text-rose-950 text-xs flex items-start gap-2">
                <ShieldAlert className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
                <span>{error}</span>
              </div>
            )}
          </div>

          {/* Composer */}
          <div className="border-t border-slate-100 p-3 sm:p-4">
            {sessionEnded && (
              <div className="mb-3 p-3 bg-amber-50 border border-amber-200 rounded-lg text-xs sm:text-sm text-amber-900 flex items-center justify-between gap-3">
                <span>Intervjuøkten er avsluttet. Start en ny for å øve mer (1 klipp).</span>
                <button
                  onClick={handleStart}
                  className="shrink-0 bg-teal-700 hover:bg-teal-800 text-white font-semibold px-3 py-1.5 rounded-lg transition cursor-pointer"
                >
                  Nytt intervju
                </button>
              </div>
            )}
            {!sessionEnded && messages.length > 0 && (
              <button
                onClick={handleFinish}
                disabled={loading}
                className="mb-3 w-full flex items-center justify-center gap-1.5 text-xs font-semibold text-teal-800 bg-teal-50 hover:bg-teal-100 border border-teal-100 rounded-lg py-2 transition cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed"
                title="Be rekruttereren avslutte med en oppsummering av styrker og forbedringspunkter"
              >
                <Flag className="w-3.5 h-3.5" />
                Avslutt og få tilbakemelding
              </button>
            )}
            <div className="flex items-end gap-2">
              <textarea
                value={input}
                onChange={(e) => setInput(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleSend();
                  }
                }}
                rows={1}
                placeholder={sessionEnded ? 'Økten er ferdig' : 'Skriv svaret ditt...'}
                disabled={loading || sessionEnded}
                className="flex-1 resize-none border border-slate-200 rounded-lg p-2.5 text-sm focus:outline-hidden focus:border-teal-600 focus:ring-1 focus:ring-teal-600 max-h-32 disabled:bg-slate-50 disabled:text-slate-400"
              />
              <button
                onClick={handleSend}
                disabled={loading || !input.trim() || sessionEnded}
                className="bg-teal-700 hover:bg-teal-800 disabled:opacity-40 disabled:cursor-not-allowed text-white p-2.5 rounded-lg transition cursor-pointer shrink-0"
                title="Send svar"
                aria-label="Send svar"
              >
                <Send className="w-5 h-5" />
              </button>
              {messages.length > 0 && (
                <button
                  onClick={handleExportTranscript}
                  className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 p-2.5 rounded-lg transition cursor-pointer shrink-0"
                  title="Last ned transkript (.txt)"
                  aria-label="Last ned transkript"
                >
                  <Download className="w-5 h-5" />
                </button>
              )}
              <button
                onClick={handleRestart}
                className="bg-white border border-slate-200 hover:bg-slate-50 text-slate-600 p-2.5 rounded-lg transition cursor-pointer shrink-0"
                title="Start på nytt"
                aria-label="Start intervjuet på nytt"
              >
                <RefreshCw className="w-5 h-5" />
              </button>
            </div>
            <p className="text-[10px] text-slate-400 mt-1.5 px-1">
              Trykk Enter for å sende · Shift+Enter for ny linje. Samtalen lagres ikke.
              {typeof turnsLeft === 'number' && turnsLeft > 0 && ` · ${turnsLeft} spørsmål igjen i denne økten.`}
            </p>
          </div>
        </div>
      )}
    </div>
  );
}
