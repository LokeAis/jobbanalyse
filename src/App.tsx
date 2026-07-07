import React, { useState, useEffect, useRef, useCallback, lazy, Suspense } from 'react';
import { statements, DimensionKey, BigFiveKey, dimensionsData, resolveDimensionKey, computeDimensionScore, getBand, INTEGRITY_KEY } from './data/statements';
import { useAuth } from './auth/AuthContext';
import { useFeedback } from './ui/Feedback';
import { track } from './utils/track';
import DisclaimerBanner from './components/DisclaimerBanner';
import LandingPage from './components/LandingPage';
import CreditPurchase from './components/CreditPurchase';
import { useDialog } from './hooks/useDialog';

// Ikke-landingsside-seksjoner lastes først når brukeren navigerer dit. Holder
// den initielle bunten (som mobil-førstegangsbesøkende laster) mye mindre.
const BigFiveOverview = lazy(() => import('./components/BigFiveOverview'));
const Questionnaire = lazy(() => import('./components/Questionnaire'));
const Results = lazy(() => import('./components/Results'));
const ConsistencyReview = lazy(() => import('./components/ConsistencyReview'));
const InterviewPrep = lazy(() => import('./components/InterviewPrep'));
const NotesSection = lazy(() => import('./components/NotesSection'));
const JobAnalysis = lazy(() => import('./components/JobAnalysis'));
const InterviewSimulator = lazy(() => import('./components/InterviewSimulator'));
const PriorityPractice = lazy(() => import('./components/PriorityPractice'));
const LegalView = lazy(() => import('./components/LegalView'));
import personvernMd from '@/docs/PERSONVERN.md?raw';
import vilkarMd from '@/docs/VILKAR.md?raw';

import { 
  Compass, 
  BookOpen, 
  ClipboardList, 
  FileText, 
  ShieldCheck, 
  HelpCircle, 
  BookMarked,
  Trash2,
  Home,
  Sparkles,
  MessageSquare,
  Ticket,
  LogIn,
  LogOut,
  Plus,
  X,
  Scale,
  UserCircle,
  HardDrive,
  Menu
} from 'lucide-react';

type TabType = 'home' | 'theory' | 'questionnaire' | 'results' | 'consistency' | 'prep' | 'jobAnalysis' | 'interview' | 'priority' | 'notes' | 'privacy';

// All localStorage keys the app owns — used for reset, export and import.
const STORAGE_KEYS = [
  'bigfive_prep_answers',
  'bigfive_prep_notes',
  'bigfive_prep_confirmed_context',
  'bigfive_prep_shuffled_ids',
  'bigfive_prep_job_title',
  'bigfive_prep_job_desc',
  'bigfive_prep_job_analysis',
  'bigfive_prep_job_analyses',
  'bigfive_prep_guesses',
  'bigfive_prep_mode',
  'bigfive_prep_ai_consent',
  'bigfive_prep_score_history',
] as const;

const SCORE_HISTORY_LIMIT = 5;

export interface ScoreSnapshot {
  date: string;
  scores: Record<string, number>;
}

// Per-eier sikkerhetskopi av de live nøklene over ("bytt hele bøtta" i stedet for å
// slette ved ut-/innlogging). Owner er en Firebase uid, eller 'anon' for ikke innlogget.
const bucketKey = (key: string, owner: string) => `${key}::${owner}`;

function backupLiveInto(owner: string) {
  STORAGE_KEYS.forEach((k) => {
    const v = localStorage.getItem(k);
    if (v !== null) localStorage.setItem(bucketKey(k, owner), v);
    else localStorage.removeItem(bucketKey(k, owner));
  });
}
function restoreLiveFrom(owner: string) {
  STORAGE_KEYS.forEach((k) => {
    const v = localStorage.getItem(bucketKey(k, owner));
    if (v !== null) localStorage.setItem(k, v);
    else localStorage.removeItem(k);
  });
}
function hasBucket(owner: string): boolean {
  return STORAGE_KEYS.some((k) => localStorage.getItem(bucketKey(k, owner)) !== null);
}

export default function App() {
  const [activeTab, setActiveTab] = useState<TabType>('home');
  const { configured, loading, user, credits, signIn, signOut, refreshCredits, authedFetch } = useAuth();
  const { toast, confirm } = useFeedback();
  const [showPurchase, setShowPurchase] = useState(false);
  const [purchaseConsent, setPurchaseConsent] = useState(false);
  const closePurchase = useCallback(() => setShowPurchase(false), []);
  const purchaseDialogRef = useDialog<HTMLDivElement>(showPurchase, closePurchase);
  const [showAccount, setShowAccount] = useState(false);
  const closeAccount = useCallback(() => setShowAccount(false), []);
  const accountDialogRef = useDialog<HTMLDivElement>(showAccount, closeAccount);
  const [showNav, setShowNav] = useState(false);
  const closeNav = useCallback(() => setShowNav(false), []);
  const navDialogRef = useDialog<HTMLDivElement>(showNav, closeNav);
  const [legalView, setLegalView] = useState<null | 'personvern' | 'vilkar'>(null);
  const openLegal = useCallback((doc: 'personvern' | 'vilkar') => {
    setShowPurchase(false);
    setLegalView(doc);
  }, []);

  // Handle return from Stripe Checkout (?kjop=ok / ?kjop=avbrutt).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const kjop = params.get('kjop');
    if (!kjop) return;
    // Clean the URL so a refresh doesn't re-trigger this.
    window.history.replaceState({}, '', window.location.pathname);
    if (kjop === 'ok') {
      toast('Takk for kjøpet! Klippene legges til om et øyeblikk.', 'success');
      // The webhook credits the account asynchronously — poll the balance.
      let tries = 0;
      const tick = () => {
        refreshCredits();
        if (++tries < 4) setTimeout(tick, 2000);
      };
      setTimeout(tick, 1500);
    } else if (kjop === 'avbrutt') {
      toast('Kjøpet ble avbrutt – ingen klipp er trukket.', 'info');
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // One-time cleanup: the old premium concept left an orphan localStorage key.
  useEffect(() => {
    localStorage.removeItem('bigfive_prep_premium');
  }, []);

  // Bekreftelse etter at identitetsskiftet under (bucket-bytte) gjenopprettet
  // tidligere lagret fremgang for kontoen som nettopp logget inn.
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    if (!params.get('gjenopprettet')) return;
    window.history.replaceState({}, '', window.location.pathname);
    toast('Fant og gjenopprettet din tidligere fremgang.', 'success');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Personvern-vakt for enhetslokal data (test/notater/lagrede analyser). Denne
  // dataen er IKKE knyttet til en konto, så på en delt nettleser må vi rydde ved
  // identitetsskifte — men IKKE ved å slette: vi bytter hele "bøtta" (se
  // backupLiveInto/restoreLiveFrom over), slik at ingen mister fremgang ved
  // ut-/innlogging, samtidig som ingen konto ser en annens data.
  useEffect(() => {
    if (loading) return; // ikke reager før Firebase har avgjort innloggingsstatus
    const OWNER_KEY = 'bigfive_prep_owner_uid';
    const nextOwner = user?.uid ?? 'anon';
    const currentOwner = localStorage.getItem(OWNER_KEY) ?? 'anon';
    if (nextOwner === currentOwner) return; // samme identitet fortsetter

    const isFirstClaim = currentOwner === 'anon' && nextOwner !== 'anon' && !hasBucket(nextOwner);
    if (isFirstClaim) {
      // Anonym utfylling → første innlogging: behold live data som den er.
      backupLiveInto(nextOwner);
    } else {
      backupLiveInto(currentOwner); // ta vare på det som var aktivt, uansett hvem
      if (hasBucket(nextOwner)) {
        restoreLiveFrom(nextOwner);
        localStorage.setItem(OWNER_KEY, nextOwner);
        window.location.href = window.location.pathname + '?gjenopprettet=1';
        return;
      }
      STORAGE_KEYS.forEach((k) => localStorage.removeItem(k)); // ny/tom identitet
    }
    localStorage.setItem(OWNER_KEY, nextOwner);
    window.location.reload();
  }, [user, loading]);

  // Deep link from e.g. the e-mail receipt: ?juridisk=vilkar|personvern.
  useEffect(() => {
    const j = new URLSearchParams(window.location.search).get('juridisk');
    if (j === 'vilkar' || j === 'personvern') {
      setLegalView(j);
      const url = new URL(window.location.href);
      url.searchParams.delete('juridisk');
      window.history.replaceState({}, '', url.pathname + url.search);
    }
  }, []);

  // 1. Load state from localStorage on init
  const [answers, setAnswers] = useState<Record<string, number>>(() => {
    const saved = localStorage.getItem('bigfive_prep_answers');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return {};
      }
    }
    return {};
  });

  const [notes, setNotes] = useState<Record<string, { workExample: string; interviewStrength: string; awareness: string }>>(() => {
    const saved = localStorage.getItem('bigfive_prep_notes');
    if (saved) {
      try {
        return JSON.parse(saved);
      } catch (e) {
        return {};
      }
    }
    return {};
  });

  const [showResetConfirm, setShowResetConfirm] = useState<boolean>(false);
  const importInputRef = useRef<HTMLInputElement>(null);

  // 2. Persistent saves on update
  const handleAnswer = (id: string, value: number) => {
    const wasEmpty = Object.keys(answers).length === 0;
    const prevCompleted = statements.every((s) => answers[s.id] !== undefined);
    const newAnswers = { ...answers, [id]: value };
    setAnswers(newAnswers);
    localStorage.setItem('bigfive_prep_answers', JSON.stringify(newAnswers));
    if (wasEmpty) track('test_started');
    const nowCompleted = statements.every((s) => newAnswers[s.id] !== undefined);
    if (nowCompleted && !prevCompleted) track('test_completed');
  };

  const handleSaveNote = (
    dimKey: DimensionKey, 
    field: 'workExample' | 'interviewStrength' | 'awareness', 
    value: string
  ) => {
    const currentDimNotes = notes[dimKey] || { workExample: '', interviewStrength: '', awareness: '' };
    const updatedNotes = {
      ...notes,
      [dimKey]: {
        ...currentDimNotes,
        [field]: value
      }
    };
    setNotes(updatedNotes);
    localStorage.setItem('bigfive_prep_notes', JSON.stringify(updatedNotes));
  };

  // Snapshot dagens skårer (til "Sammenlign med forrige forsøk" i Results.tsx).
  // Returnerer JSON for den oppdaterte historikken, eller null hvis testen ikke
  // var fullført — da er det ingenting meningsfullt å lagre.
  const snapshotScoreHistory = (): string | null => {
    if (!isQuestionnaireComplete) return null;
    const allKeys: DimensionKey[] = [...(Object.keys(dimensionsData) as BigFiveKey[]), INTEGRITY_KEY];
    const snapshot: ScoreSnapshot = {
      date: new Date().toISOString(),
      scores: Object.fromEntries(allKeys.map((k) => [k, computeDimensionScore(k, answers)])),
    };
    let history: ScoreSnapshot[] = [];
    try {
      history = JSON.parse(localStorage.getItem('bigfive_prep_score_history') || '[]');
    } catch {
      history = [];
    }
    return JSON.stringify([snapshot, ...history].slice(0, SCORE_HISTORY_LIMIT));
  };

  // 3. Clear data and reset
  const handleResetAllData = () => {
    // Snapshot FØR vi tømmer noe.
    const nextHistoryJson = snapshotScoreHistory();
    STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
    // Fjern også egen sikkerhetskopi, ellers kommer "slettet" data tilbake ved neste innlogging.
    if (user) STORAGE_KEYS.forEach((key) => localStorage.removeItem(bucketKey(key, user.uid)));
    // Skriv den ferske historikken tilbake ETTER full tømming, så den overlever resetten.
    if (nextHistoryJson) localStorage.setItem('bigfive_prep_score_history', nextHistoryJson);
    setAnswers({});
    setNotes({});
    setActiveTab('home');
    setShowResetConfirm(false);
  };

  // 3x. Retake: nullstill KUN selve testen (svar, rekkefølge, gjetninger, modus,
  // onboarding-flagg) — notater, jobbanalyser og samtykke beholdes. Profilen
  // snapshottes først så brukeren kan sammenligne forsøkene etterpå.
  const handleRetake = async () => {
    const ok = await confirm({
      title: 'Ta testen på nytt?',
      message:
        'Svarene dine nullstilles slik at du kan gjennomføre en fersk generalprøve. Profilen fra dette forsøket lagres, så du kan sammenligne resultatene etterpå. Notater og lagrede jobbanalyser beholdes.',
      confirmLabel: 'Start ny gjennomføring',
      cancelLabel: 'Avbryt',
    });
    if (!ok) return;
    const nextHistoryJson = snapshotScoreHistory();
    const TEST_KEYS = [
      'bigfive_prep_answers',
      'bigfive_prep_shuffled_ids',
      'bigfive_prep_guesses',
      'bigfive_prep_mode',
      'bigfive_prep_confirmed_context',
    ];
    TEST_KEYS.forEach((k) => localStorage.removeItem(k));
    if (nextHistoryJson) localStorage.setItem('bigfive_prep_score_history', nextHistoryJson);
    setAnswers({});
    navigateToTab('questionnaire'); // Questionnaire mountes ferskt og starter onboarding på nytt
  };

  // 3a. GDPR: delete server account (Firestore-data + Firebase Auth) + local data.
  const handleDeleteAccount = async () => {
    const ok = await confirm({
      title: 'Slette konto og alle data?',
      message:
        'Dette sletter kontoen din, e-postadressen og klippsaldoen permanent fra serveren, og fjerner testdataene dine lokalt. Handlingen kan ikke angres.',
      confirmLabel: 'Slett alt permanent',
      cancelLabel: 'Avbryt',
      danger: true,
    });
    if (!ok) return;
    try {
      const res = await authedFetch('/api/delete-account', { method: 'POST' });
      if (!res.ok) throw new Error();
      STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
      // Fjern også egen sikkerhetskopi (GDPR — data skal ikke kunne dukke opp igjen).
      STORAGE_KEYS.forEach((key) => localStorage.removeItem(bucketKey(key, user!.uid)));
      setAnswers({});
      setNotes({});
      await signOut();
      setActiveTab('home');
      toast('Kontoen din og alle data er slettet.', 'success');
    } catch {
      toast('Kunne ikke slette kontoen. Prøv igjen, eller kontakt oss.', 'error');
    }
  };

  // 3b. Export all local data as a JSON backup file.
  const handleExportData = () => {
    const data: Record<string, string> = {};
    STORAGE_KEYS.forEach((key) => {
      const value = localStorage.getItem(key);
      if (value !== null) data[key] = value;
    });

    const backup = {
      app: 'big-five-forberedelse',
      version: 1,
      exportedAt: new Date().toISOString(),
      data,
    };

    const blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = `big_five_backup_${new Date().toISOString().slice(0, 10)}.json`;
    link.click();
    URL.revokeObjectURL(url);
  };

  // 3c. Import a JSON backup and restore it (then reload so all views re-init).
  const handleImportData = (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = ''; // allow re-importing the same file later
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async () => {
      try {
        const parsed = JSON.parse(String(reader.result));
        const data = parsed?.data;
        if (!data || typeof data !== 'object') {
          throw new Error('Mangler "data"-felt');
        }

        const allowed = new Set<string>(STORAGE_KEYS);
        const importableKeys = Object.keys(data).filter(
          (k) => allowed.has(k) && typeof data[k] === 'string'
        );

        if (importableKeys.length === 0) {
          throw new Error('Ingen gjenkjennelige data');
        }

        const ok = await confirm({
          title: 'Gjenopprette sikkerhetskopi?',
          message:
            'Dette overskriver alle nåværende svar og notater i denne nettleseren med innholdet fra sikkerhetskopien.',
          confirmLabel: 'Gjenopprett',
          danger: true,
        });
        if (!ok) return;

        // Clear current data first, then write the backup's keys.
        STORAGE_KEYS.forEach((key) => localStorage.removeItem(key));
        importableKeys.forEach((key) => localStorage.setItem(key, data[key]));

        toast('Sikkerhetskopien er gjenopprettet. Laster siden på nytt …', 'success');
        setTimeout(() => window.location.reload(), 700);
      } catch (e) {
        console.error('Import failed:', e);
        toast('Kunne ikke lese filen. Sjekk at det er en gyldig Big Five-sikkerhetskopi (.json).', 'error');
      }
    };
    reader.readAsText(file);
  };

  const answeredCount = statements.filter(s => answers[s.id] !== undefined).length;
  const isQuestionnaireComplete = answeredCount === statements.length;

  // Tab navigation helper
  const navigateToTab = (tabId: string) => {
    setActiveTab(tabId as TabType);
    window.scrollTo({ top: 0 });
  };

  // Tab definitions (data-driven so the tablist stays consistent and accessible).
  const lockBadge = !isQuestionnaireComplete ? (
    <span className="text-[10px] bg-slate-200 text-slate-500 px-1 rounded-sm">Låst</span>
  ) : null;

  const tabs: {
    key: TabType;
    id: string;
    label: string;
    shortLabel?: string;
    icon: React.ReactNode;
    badge?: React.ReactNode;
    activeClass?: string;
    group: string;
  }[] = [
    { key: 'home', id: 'tab-home', label: 'Start', icon: <Home className="w-4 h-4 text-slate-400" />, group: 'Kom i gang' },
    { key: 'theory', id: 'tab-theory', label: 'Big Five-oversikt', shortLabel: 'Oversikt', icon: <BookOpen className="w-4 h-4 text-slate-400" />, group: 'Kom i gang' },
    {
      key: 'questionnaire',
      id: 'tab-questionnaire',
      label: 'Spørreskjema',
      shortLabel: 'Test',
      icon: <ClipboardList className="w-4 h-4 text-slate-400" />,
      badge: answeredCount > 0 ? (
        <span className="ml-1 bg-teal-100 text-teal-900 text-[10px] font-bold px-1.5 py-0.5 rounded-full">
          {answeredCount}/{statements.length}
        </span>
      ) : null,
      group: 'Test',
    },
    {
      key: 'consistency',
      id: 'tab-consistency',
      label: 'Debrief-rapport',
      shortLabel: 'Debrief',
      icon: <ShieldCheck className="w-4 h-4 text-slate-400" />,
      activeClass: 'bg-teal-700 text-white border border-teal-700 shadow-xs',
      badge: lockBadge,
      group: 'Resultat',
    },
    {
      key: 'results',
      id: 'tab-results',
      label: 'Detaljert Profil',
      shortLabel: 'Profil',
      icon: <FileText className="w-4 h-4 text-slate-400" />,
      badge: lockBadge,
      group: 'Resultat',
    },
    {
      key: 'prep',
      id: 'tab-prep',
      label: 'Intervjuforberedelse',
      shortLabel: 'Forberedelse',
      icon: <HelpCircle className="w-4 h-4 text-slate-400" />,
      badge: lockBadge,
      group: 'Forberedelse',
    },
    {
      key: 'jobAnalysis',
      id: 'tab-job-analysis',
      label: 'AI Jobbanalyse',
      shortLabel: 'Jobbanalyse',
      icon: <Sparkles className="w-4 h-4 text-teal-600 animate-pulse" />,
      badge: <span className="text-[10px] bg-teal-50 text-teal-700 px-1 rounded-sm font-bold">AI</span>,
      group: 'Forberedelse',
    },
    {
      key: 'interview',
      id: 'tab-interview',
      label: 'Intervju-simulator',
      shortLabel: 'Simulator',
      icon: <MessageSquare className="w-4 h-4 text-teal-600" />,
      badge: <span className="text-[10px] bg-gold-100 text-gold-700 px-1 rounded-sm font-bold">PRO</span>,
      group: 'Forberedelse',
    },
    {
      key: 'priority',
      id: 'tab-priority',
      label: 'Prioriteringsøvelse',
      shortLabel: 'Prioritering',
      icon: <Scale className="w-4 h-4 text-slate-400" />,
      group: 'Forberedelse',
    },
    { key: 'notes', id: 'tab-notes', label: 'Mine Notater', shortLabel: 'Notater', icon: <BookMarked className="w-4 h-4 text-slate-400" />, group: 'Annet' },
    { key: 'privacy', id: 'tab-privacy', label: 'Personvern', icon: <ShieldCheck className="w-4 h-4 text-teal-600" />, group: 'Annet' },
  ];

  const activeTabInfo = tabs.find((t) => t.key === activeTab);

  return (
    <div className="min-h-screen bg-[#fcfcfc] text-slate-800 flex flex-col antialiased">
      
      {/* Upper Navigation Bar */}
      <header className="bg-white border-b border-slate-200/80 sticky top-0 z-50 print:hidden">
        <div className="max-w-6xl mx-auto px-4">
          <div className="flex justify-between items-center h-16">
            
            {/* Menu trigger + Logo / Brand */}
            <div className="flex items-center gap-2 sm:gap-3 min-w-0">
              <button
                id="btn-open-nav"
                onClick={() => setShowNav(true)}
                aria-label="Åpne meny"
                aria-haspopup="dialog"
                aria-expanded={showNav}
                className="shrink-0 p-2 -ml-1 text-slate-600 hover:text-slate-900 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              >
                <Menu className="w-5 h-5" />
              </button>
              <button
                onClick={() => navigateToTab('home')}
                className="flex items-center gap-2.5 text-slate-900 hover:text-slate-700 transition cursor-pointer text-left min-w-0"
              >
                <div className="w-9 h-9 bg-teal-700 rounded-lg flex items-center justify-center text-white shrink-0">
                  <Compass className="w-5 h-5" />
                </div>
                <div className="min-w-0 hidden sm:block">
                  <span className="font-bold text-base leading-none block">Big Five Forberedelse</span>
                  <span className="text-[10px] text-slate-500 font-medium">Refleksjonsverktøy for rekruttering</span>
                </div>
              </button>
            </div>

            {/* Answer progress + auth/credits */}
            <div className="flex items-center gap-2 sm:gap-3">
              {answeredCount > 0 && (
                <button
                  onClick={() => navigateToTab('questionnaire')}
                  className="hidden md:flex items-center gap-2 text-xs font-semibold px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg transition"
                >
                  <span className="relative flex h-2 w-2">
                    <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-teal-400 opacity-75"></span>
                    <span className="relative inline-flex rounded-full h-2 w-2 bg-teal-500"></span>
                  </span>
                  <span>Fullført: {answeredCount} / {statements.length}</span>
                </button>
              )}

              {configured && !loading && (
                user ? (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => { setPurchaseConsent(false); setShowPurchase(true); }}
                      className="flex items-center gap-1.5 text-xs font-bold px-2.5 py-1.5 bg-white hover:bg-gold-50 border border-gold-300 text-gold-700 rounded-lg transition cursor-pointer"
                      title="Dine AI-klipp – klikk for å kjøpe flere"
                    >
                      <Ticket className="w-3.5 h-3.5" />
                      {credits ?? '–'} klipp
                      <Plus className="w-3 h-3" />
                    </button>
                    <button
                      onClick={() => setShowAccount(true)}
                      title={user.email || 'Min side'}
                      aria-label="Min side"
                      className="flex items-center gap-1.5 text-xs font-semibold px-2.5 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-600 rounded-lg transition cursor-pointer"
                    >
                      <UserCircle className="w-4 h-4" />
                      <span className="hidden sm:inline">Min side</span>
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => signIn()}
                    className="flex items-center gap-1.5 text-xs font-semibold px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition"
                  >
                    <LogIn className="w-3.5 h-3.5" />
                    Logg inn
                  </button>
                )
              )}
            </div>

          </div>
        </div>

        {/* "You are here" bar: always shows the active section + reopens the menu */}
        <button
          onClick={() => setShowNav(true)}
          aria-label={`Nåværende seksjon: ${activeTabInfo?.label ?? ''}. Åpne meny for å bytte.`}
          className="w-full bg-slate-50 border-t border-slate-200/50 hover:bg-slate-100 transition cursor-pointer"
        >
          <div className="max-w-6xl mx-auto px-4 py-2 flex items-center gap-2 text-xs sm:text-sm font-semibold text-slate-700">
            {activeTabInfo?.icon}
            <span className="truncate">{activeTabInfo?.label}</span>
            {activeTabInfo?.badge}
          </div>
        </button>
      </header>

      {/* Mandatory Disclaimer visible on all pages */}
      <div className="px-4 print:hidden shrink-0">
        <DisclaimerBanner />
      </div>

      {/* Main Content Area */}
      <main
        id="main-content"
        aria-label={activeTabInfo?.label}
        tabIndex={-1}
        className="flex-1 pb-16 print:hidden"
      >
        <Suspense
          fallback={
            <div className="max-w-md mx-auto py-20 flex items-center justify-center gap-2 text-slate-400 text-sm">
              <span className="w-4 h-4 border-2 border-slate-300 border-t-teal-600 rounded-full animate-spin" />
              Laster …
            </div>
          }
        >
        {activeTab === 'home' && (
          <LandingPage
            onStart={() => navigateToTab('questionnaire')}
            onViewOverview={() => navigateToTab('theory')}
            completedCount={answeredCount}
          />
        )}

        {activeTab === 'theory' && (
          <BigFiveOverview />
        )}

        {activeTab === 'questionnaire' && (
          <Questionnaire 
            answers={answers}
            onAnswer={handleAnswer}
            onComplete={() => navigateToTab('results')}
          />
        )}

        {activeTab === 'results' && (
          <Results
            answers={answers}
            onNavigateToTab={navigateToTab}
            onRetake={handleRetake}
          />
        )}

        {activeTab === 'consistency' && (
          <ConsistencyReview 
            answers={answers}
            onNavigateToTab={navigateToTab}
          />
        )}

        {activeTab === 'prep' && (
          <InterviewPrep 
            answers={answers}
            onNavigateToTab={navigateToTab}
          />
        )}

        {activeTab === 'jobAnalysis' && (
          <JobAnalysis 
            answers={answers}
            notes={notes}
            onSaveNote={handleSaveNote}
            onNavigateToTab={navigateToTab}
          />
        )}

        {activeTab === 'interview' && (
          <InterviewSimulator
            answers={answers}
            onNavigateToTab={navigateToTab}
          />
        )}

        {activeTab === 'priority' && (
          <PriorityPractice onNavigateToTab={navigateToTab} />
        )}

        {activeTab === 'notes' && (
          <NotesSection
            notes={notes}
            onSaveNote={handleSaveNote}
            answers={answers}
          />
        )}

        {activeTab === 'privacy' && (
          <div id="privacy-view" className="max-w-2xl mx-auto py-8 px-4 print:hidden">
            <div className="bg-white border border-slate-100 rounded-xl p-6 sm:p-8 shadow-xs">
              <div className="w-12 h-12 bg-teal-50 rounded-full flex items-center justify-center text-teal-700 mb-6 mx-auto">
                <ShieldCheck className="w-6 h-6" />
              </div>
              
              <h2 className="text-xl sm:text-2xl font-bold text-slate-900 text-center mb-2">
                Slik håndteres dine data
              </h2>
              <p className="text-slate-500 text-xs sm:text-sm text-center mb-5 max-w-md mx-auto">
                Testen og notatene dine forblir lokalt på din enhet. Den valgfrie AI-jobbanalysen sender data til Google Gemini for å generere rapporten.
              </p>

              <div className="flex flex-wrap justify-center gap-2 mb-6">
                <button
                  onClick={() => setLegalView('personvern')}
                  className="text-xs font-semibold px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg transition cursor-pointer"
                >
                  Les hele personvernerklæringen
                </button>
                <button
                  onClick={() => setLegalView('vilkar')}
                  className="text-xs font-semibold px-3 py-1.5 bg-slate-50 hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-lg transition cursor-pointer"
                >
                  Vilkår & kjøpsbetingelser
                </button>
              </div>

              <div className="space-y-4 text-slate-600 text-sm sm:text-base leading-relaxed mb-8 border-t border-slate-100 pt-6">
                <p>
                  • <strong>Ingen registrering:</strong> Du trenger ikke registrere deg eller logge inn for å bruke appen.
                </p>
                <p>
                  • <strong>Test og notater er 100 % lokale:</strong> Svarene på spørreskjemaet, profilberegningen og notatene dine lagres kun i din egen nettlesers lokale lager (localStorage). Disse sendes aldri til noen server, og du kan lukke fanen og fortsette senere uten å miste framdriften.
                </p>
                <p>
                  • <strong>AI-jobbanalysen (valgfri) bruker en ekstern tjeneste:</strong> Hvis du velger å kjøre AI Jobbanalyse, sendes stillingstittelen, stillingsbeskrivelsen du limer inn, og dine beregnede Big Five-skårer til vår server og videre til <strong>Google Gemini</strong> for å generere rapporten. Ikke lim inn sensitive personopplysninger i stillingsfeltene. Denne delen er helt frivillig — resten av appen fungerer fullt ut uten den.
                </p>
              </div>

              {/* Backup / Restore Section */}
              <div className="border-t border-slate-150 pt-6 mb-2">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-2">Sikkerhetskopi av dine data</h3>
                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed mb-4">
                  Siden alt lagres lokalt, forsvinner svar og notater hvis du tømmer nettleseren eller bytter enhet. Last ned en sikkerhetskopi for å ta vare på dem, eller gjenopprett en tidligere kopi.
                </p>
                <div className="flex flex-wrap gap-2">
                  <button
                    onClick={handleExportData}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 font-semibold px-4 py-2.5 rounded-lg text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
                  >
                    <ShieldCheck className="w-4 h-4 text-teal-600" />
                    Last ned sikkerhetskopi
                  </button>
                  <button
                    onClick={() => importInputRef.current?.click()}
                    className="bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 hover:border-slate-300 font-semibold px-4 py-2.5 rounded-lg text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
                  >
                    <BookMarked className="w-4 h-4 text-slate-500" />
                    Gjenopprett fra fil
                  </button>
                  <input
                    ref={importInputRef}
                    type="file"
                    accept="application/json,.json"
                    onChange={handleImportData}
                    className="hidden"
                  />
                </div>
              </div>

              {/* Reset Section */}
              <div className="border-t border-slate-150 pt-6">
                <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-2">Slett dine lagrede data</h3>
                <p className="text-slate-500 text-xs sm:text-sm leading-relaxed mb-4">
                  Ønsker du å fjerne alle svar og notater fra nettleseren din (f.eks. hvis du bruker en delt datamaskin)? Klikk på knappen nedenfor. Denne handlingen kan ikke angres.
                </p>

                {showResetConfirm ? (
                  <div className="bg-rose-50 border border-rose-200 p-4 rounded-lg space-y-3">
                    <p className="text-rose-950 font-semibold text-xs sm:text-sm flex items-center gap-2">
                      <Trash2 className="w-4 h-4 text-rose-600" />
                      Er du helt sikker på at du vil slette alt?
                    </p>
                    <p className="text-rose-900 text-xs">
                      Dette vil fjerne alle dine {statements.length} svar på spørreskjemaet og alle dine personlige notater permanent. Om testen er fullført, lagres skårene dine slik at du kan sammenligne med et senere forsøk.
                    </p>
                    <div className="flex gap-2">
                      <button
                        id="btn-confirm-delete"
                        onClick={handleResetAllData}
                        className="bg-rose-600 hover:bg-rose-700 text-white font-medium px-4 py-2 rounded-lg text-xs sm:text-sm cursor-pointer transition"
                      >
                        Ja, slett alt permanent
                      </button>
                      <button
                        onClick={() => setShowResetConfirm(false)}
                        className="bg-white border border-slate-200 text-slate-700 font-medium px-4 py-2 rounded-lg text-xs sm:text-sm cursor-pointer hover:bg-slate-50 transition"
                      >
                        Avbryt
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    id="btn-trigger-delete"
                    onClick={() => setShowResetConfirm(true)}
                    className="bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-300 font-semibold px-4 py-2.5 rounded-lg text-xs sm:text-sm transition flex items-center gap-2 cursor-pointer"
                  >
                    <Trash2 className="w-4 h-4" />
                    Slett mine svar og notater
                  </button>
                )}
              </div>

              {configured && user && (
                <div className="border-t border-slate-150 pt-6 mt-6">
                  <h3 className="font-bold text-slate-900 text-sm sm:text-base mb-2">Konto (GDPR)</h3>
                  <p className="text-slate-500 text-xs sm:text-sm leading-relaxed">
                    Logg ut og sletting av konto og alle data finner du under{' '}
                    <button
                      onClick={() => setShowAccount(true)}
                      className="text-teal-700 underline font-semibold cursor-pointer"
                    >
                      Min side
                    </button>{' '}
                    (person-ikonet øverst til høyre).
                  </p>
                </div>
              )}

            </div>
          </div>
        )}
        </Suspense>

      </main>

      {/* Footer for print & branding */}
      <footer className="bg-slate-50 border-t border-slate-200 py-6 text-center text-xs text-slate-400 mt-auto shrink-0 print:hidden">
        <div className="max-w-6xl mx-auto px-4 space-y-2">
          <p>© 2026 Big Five Forberedelse — Test og notater lagres lokalt. AI-jobbanalysen (valgfri) bruker Google Gemini.</p>
          <p className="flex items-center justify-center gap-3">
            <button onClick={() => setLegalView('personvern')} className="hover:text-slate-600 underline cursor-pointer">
              Personvern
            </button>
            <span aria-hidden="true">·</span>
            <button onClick={() => setLegalView('vilkar')} className="hover:text-slate-600 underline cursor-pointer">
              Vilkår & kjøpsbetingelser
            </button>
          </p>
        </div>
      </footer>

      {/* Print Specific Stylings: will print neat clean notes pages or briefing pages without UI headers */}
      {isQuestionnaireComplete && (
        <div id="briefing-print-section" className="hidden print:block p-8 max-w-4xl mx-auto bg-white">
          {(() => {
            const saved = localStorage.getItem('bigfive_prep_job_analysis');
            const jobTitle = localStorage.getItem('bigfive_prep_job_title') || '';
            if (saved) {
              try {
                const analysis = JSON.parse(saved);
                return (
                  /* UNIFIED INTERVJU-BRIEFING PRINT FORMAT (Task 5) */
                  <div className="space-y-8">
                    <div className="border-b-2 border-slate-900 pb-4 mb-6">
                      <span className="text-xs uppercase font-mono text-slate-500 block mb-1">
                        KANDIDAT-BRIEFING — KUN TIL PERSONLIG BRUK UNDER FORBEREDELSE
                      </span>
                      <h1 className="text-3xl font-black text-slate-900">Briefing til Intervjudagen</h1>
                      <div className="grid grid-cols-2 gap-4 mt-3 text-sm">
                        <div>
                          <p className="text-slate-600"><span className="font-semibold text-slate-800">Søkt stilling:</span> {jobTitle}</p>
                          <p className="text-slate-600"><span className="font-semibold text-slate-800">Dato:</span> {new Date().toLocaleDateString('no-NO')}</p>
                        </div>
                        <div className="text-right">
                          <p className="text-slate-600"><span className="font-semibold text-slate-800">Match-bånd:</span> <span className="font-bold text-teal-800">{analysis.matchBand} Match</span></p>
                          <p className="text-slate-500 text-xs">Vurdert via Big Five-generalprøven</p>
                        </div>
                      </div>
                    </div>

                    {/* Rolleanalyse og match-begrunnelse */}
                    <div className="space-y-3 break-inside-avoid">
                      <h2 className="text-lg font-bold uppercase tracking-wider text-slate-800 border-b pb-1">1. Overordnet Match-Analyse</h2>
                      <p className="text-slate-700 text-sm leading-relaxed whitespace-pre-line">
                        {analysis.matchAnalysis}
                      </p>
                    </div>

                    {/* Implisitte Jobbkrav & Profil Side-ved-side */}
                    <div className="space-y-4 break-inside-avoid">
                      <h2 className="text-lg font-bold uppercase tracking-wider text-slate-800 border-b pb-1">2. Rolleanalyse &amp; Personlighetsprofil (Side-ved-side)</h2>
                      <div className="grid gap-3">
                        {analysis.impliedTraits?.map((t: any, idx: number) => {
                          let userBand = '';
                          let userScoreText = '';

                          const matchedKey = resolveDimensionKey(t.trait);

                          if (matchedKey) {
                            const score = computeDimensionScore(matchedKey, answers);
                            userBand = getBand(score);
                            userScoreText = `${userBand} tendens (${score.toFixed(1)}/5)`;
                          }

                          return (
                            <div key={idx} className="p-3 bg-slate-50 border border-slate-200 rounded-lg grid grid-cols-2 gap-4 text-xs break-inside-avoid">
                              <div>
                                <p className="font-bold text-slate-900">Stillingens implisitte krav: {t.trait}</p>
                                <p className="text-slate-600 italic mt-1">&ldquo;{t.evidenceInText}&rdquo;</p>
                              </div>
                              <div className="border-l border-slate-200 pl-3 flex flex-col justify-center">
                                <p className="font-bold text-slate-800">Din profil:</p>
                                {matchedKey ? (
                                  <p className="text-indigo-900 font-semibold mt-1">
                                    {dimensionsData[matchedKey].name}: {userScoreText}
                                  </p>
                                ) : (
                                  <p className="text-slate-500 italic">Generell egenskap.</p>
                                )}
                              </div>
                            </div>
                          );
                        })}
                      </div>
                    </div>

                    {/* Superpowers */}
                    <div className="space-y-3 break-inside-avoid">
                      <h2 className="text-lg font-bold uppercase tracking-wider text-slate-800 border-b pb-1">3. Dine Største Superkrefter i denne Rollen</h2>
                      <div className="space-y-4">
                        {analysis.superpowers?.map((s: any, idx: number) => (
                          <div key={idx} className="space-y-1 text-sm break-inside-avoid">
                            <p className="font-bold text-slate-900">{idx+1}. {s.trait}</p>
                            <p className="text-slate-600"><span className="font-semibold text-slate-800">Hvorfor det passer:</span> {s.whyItFits}</p>
                            <p className="text-slate-600 italic"><span className="font-semibold text-slate-700">Intervjutips:</span> {s.interviewTip}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Friksjonspunkter */}
                    <div className="space-y-3 break-inside-avoid">
                      <h2 className="text-lg font-bold uppercase tracking-wider text-slate-800 border-b pb-1">4. Situasjonsbetingede Friksjonspunkter</h2>
                      <div className="space-y-4">
                        {analysis.frictionPoints?.map((f: any, idx: number) => (
                          <div key={idx} className="space-y-1 text-sm break-inside-avoid">
                            <p className="font-bold text-slate-900">{idx+1}. Friksjonsområde</p>
                            <p className="text-slate-600"><span className="font-semibold text-slate-800">Spenning:</span> {f.tension}</p>
                            <p className="text-slate-600 italic"><span className="font-semibold text-slate-700">Kompenseringsstrategi på intervjuet:</span> {f.compensationStrategy}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Intervjuspørsmål */}
                    <div className="space-y-3 break-inside-avoid">
                      <h2 className="text-lg font-bold uppercase tracking-wider text-slate-800 border-b pb-1">5. Tøffe Spørsmål fra Rekruttereren (Simulering)</h2>
                      <div className="space-y-4">
                        {analysis.interviewQuestions?.map((q: any, idx: number) => (
                          <div key={idx} className="space-y-1 text-sm break-inside-avoid">
                            <p className="font-bold text-slate-900 italic">Spørsmål: &ldquo;{q.question}&rdquo;</p>
                            <p className="text-slate-600"><span className="font-semibold text-slate-800">Foreslått, ærlig vinkling:</span> {q.suggestedAngle}</p>
                          </div>
                        ))}
                      </div>
                    </div>

                    {/* Dine STAR-notater */}
                    <div className="space-y-4 break-before-page">
                      <h2 className="text-lg font-bold uppercase tracking-wider text-slate-800 border-b pb-1">6. Dine Personlige Forberedelser &amp; STAR-Historier</h2>
                      <p className="text-slate-500 text-xs mb-4">
                        Dine egne refleksjoner, historier og forberedte eksempler fra Mine Notater:
                      </p>
                      
                      {(Object.keys(dimensionsData) as DimensionKey[]).map((key) => {
                        const dim = dimensionsData[key];
                        const dimNote = notes[key] || { workExample: '', interviewStrength: '', awareness: '' };
                        const hasNotes = dimNote.workExample || dimNote.interviewStrength || dimNote.awareness;
                        if (!hasNotes) return null;

                        return (
                          <div key={key} className="mb-6 border-b pb-4 break-inside-avoid">
                            <h3 className="font-bold text-slate-900 text-sm border-b pb-1 mb-2 uppercase">{dim.name}</h3>
                            <div className="space-y-2 text-xs">
                              {dimNote.workExample && (
                                <div>
                                  <p className="font-bold text-slate-500">Eksempel fra arbeidshverdagen / STAR-historie:</p>
                                  <p className="text-slate-800 pl-2 border-l border-slate-200 mt-0.5 whitespace-pre-line">{dimNote.workExample}</p>
                                </div>
                              )}
                              {dimNote.interviewStrength && (
                                <div>
                                  <p className="font-bold text-slate-500">Styrke jeg kan forklare i intervju:</p>
                                  <p className="text-slate-800 pl-2 border-l border-slate-200 mt-0.5 whitespace-pre-line">{dimNote.interviewStrength}</p>
                                </div>
                              )}
                              {dimNote.awareness && (
                                <div>
                                  <p className="font-bold text-slate-500">Noe jeg bør være bevisst på (fallgruve):</p>
                                  <p className="text-slate-800 pl-2 border-l border-slate-200 mt-0.5 whitespace-pre-line">{dimNote.awareness}</p>
                                </div>
                              )}
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                );
              } catch (e) {
                // fallback
              }
            }

            return (
              /* STANDARD NOTES ONLY PRINT FORMAT */
              <div>
                <h1 className="text-2xl font-bold mb-2 text-slate-900">Mine Forberedelser til Jobbintervju (Big Five)</h1>
                <p className="text-slate-500 text-xs mb-6">Generert fra Big Five Forberedelse - {new Date().toLocaleDateString('no-NO')}</p>
                
                {(Object.keys(dimensionsData) as DimensionKey[]).map((key) => {
                  const dim = dimensionsData[key];
                  const dimNote = notes[key] || { workExample: '', interviewStrength: '', awareness: '' };

                  return (
                    <div key={key} className="mb-8 border-b pb-6 break-inside-avoid">
                      <h2 className="text-lg font-bold border-b pb-1 mb-3 text-slate-900">{dim.name}</h2>
                      
                      <div className="space-y-4">
                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-slate-400 uppercase">1. Eksempel fra arbeidshverdagen</h3>
                          {dimNote.workExample ? (
                            <p className="text-slate-800 text-sm whitespace-pre-line pl-1">{dimNote.workExample}</p>
                          ) : (
                            <p className="text-slate-400 text-xs italic pl-1 border border-dashed border-slate-200 p-3 rounded-lg bg-slate-50/50">
                              Ingen notater skrevet. Skriv ned en spesifikk situasjon der du demonstrerte denne egenskapen.
                            </p>
                          )}
                        </div>

                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-slate-400 uppercase">2. Styrke jeg kan forklare i intervju</h3>
                          {dimNote.interviewStrength ? (
                            <p className="text-slate-800 text-sm whitespace-pre-line pl-1">{dimNote.interviewStrength}</p>
                          ) : (
                            <p className="text-slate-400 text-xs italic pl-1 border border-dashed border-slate-200 p-3 rounded-lg bg-slate-50/50">
                              Ingen notater skrevet. Hvordan vil du presentere dine positive sider og styrker for intervjueren?
                            </p>
                          )}
                        </div>

                        <div className="space-y-1">
                          <h3 className="text-xs font-bold text-slate-400 uppercase">3. Noe jeg bør være bevisst på (Fallgruver / Utviklingsområder)</h3>
                          {dimNote.awareness ? (
                            <p className="text-slate-800 text-sm whitespace-pre-line pl-1">{dimNote.awareness}</p>
                          ) : (
                            <p className="text-slate-400 text-xs italic pl-1 border border-dashed border-slate-200 p-3 rounded-lg bg-slate-50/50">
                              Ingen notater skrevet. Hvilke fallgruver opplever du og hvordan kompenserer du for dem i hverdagen?
                            </p>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            );
          })()}
        </div>
      )}

      {/* Legal documents (privacy / terms) shown full-screen */}
      {legalView && (
        <div className="fixed inset-0 z-50 bg-white overflow-y-auto print:hidden">
          <Suspense fallback={<div className="py-20 text-center text-slate-400 text-sm">Laster …</div>}>
            <LegalView
              source={legalView === 'personvern' ? personvernMd : vilkarMd}
              onBack={() => setLegalView(null)}
            />
          </Suspense>
        </div>
      )}

      {/* Side navigation drawer (opened from the hamburger button / "you are here" bar) */}
      {showNav && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40"
          onClick={closeNav}
          role="dialog"
          aria-modal="true"
          aria-label="Meny"
        >
          <div
            ref={navDialogRef}
            tabIndex={-1}
            className="absolute left-0 top-0 h-full w-full max-w-xs bg-white shadow-xl outline-none flex flex-col"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex items-center justify-between px-4 h-16 border-b border-slate-200/80 shrink-0">
              <span className="font-bold text-slate-900">Seksjoner</span>
              <button
                onClick={closeNav}
                aria-label="Lukk meny"
                className="p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              >
                <X className="w-5 h-5" />
              </button>
            </div>
            <nav aria-label="Seksjoner" className="flex-1 overflow-y-auto py-2">
              {tabs.map((tab, i) => {
                const isActive = activeTab === tab.key;
                const isNewGroup = tab.group !== tabs[i - 1]?.group;
                return (
                  <React.Fragment key={tab.key}>
                    {isNewGroup && (
                      <div className={`px-4 pb-1.5 text-[10px] font-bold uppercase tracking-wider text-slate-400 ${i === 0 ? 'pt-2' : 'pt-4'}`}>
                        {tab.group}
                      </div>
                    )}
                    <button
                      id={tab.id}
                      aria-current={isActive ? 'page' : undefined}
                      onClick={() => { navigateToTab(tab.key); closeNav(); }}
                      className={`w-full flex items-center gap-3 px-4 py-3 text-sm font-semibold transition cursor-pointer text-left ${
                        isActive
                          ? 'bg-teal-50/70 text-teal-800 border-l-4 border-teal-400'
                          : 'text-slate-600 hover:bg-slate-50 border-l-4 border-transparent'
                      }`}
                    >
                      {tab.icon}
                      <span className="flex-1">{tab.label}</span>
                      {tab.badge}
                    </button>
                  </React.Fragment>
                );
              })}
            </nav>
          </div>
        </div>
      )}

      {/* Credit purchase modal (opened from the credit chip) */}
      {showPurchase && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={closePurchase}
          role="dialog"
          aria-modal="true"
          aria-label="Kjøp klipp"
        >
          <div
            ref={purchaseDialogRef}
            tabIndex={-1}
            className="bg-white rounded-2xl shadow-xl max-w-lg w-full p-6 relative outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closePurchase}
              className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              aria-label="Lukk"
            >
              <X className="w-5 h-5" />
            </button>
            <h2 className="text-xl font-bold text-slate-900 mb-1">Kjøp AI-klipp</h2>
            <p className="text-slate-600 text-sm mb-4">
              1 klipp = én AI-jobbanalyse eller ett øvingsintervju. Du har nå{' '}
              <span className="font-semibold text-amber-700">{credits ?? 0} klipp</span>.
            </p>

            <CreditPurchase blocked={!purchaseConsent} />

            {/* Required consent (angrerett / immediate delivery) + links before paying */}
            <label className="flex items-start gap-2.5 mt-4 text-xs text-slate-600 leading-relaxed cursor-pointer">
              <input
                type="checkbox"
                checked={purchaseConsent}
                onChange={(e) => setPurchaseConsent(e.target.checked)}
                className="mt-0.5 w-4 h-4 accent-teal-700 shrink-0 cursor-pointer"
              />
              <span>
                Jeg ber uttrykkelig om at en AI-økt kan leveres umiddelbart når jeg starter
                den, også før angrefristen på 14 dager er utløpt, og jeg erkjenner at
                angreretten bortfaller for et klipp når det tas i bruk (angrerettloven § 22 n).
              </span>
            </label>
            <p className="text-[11px] text-slate-400 mt-3">
              Ved kjøp godtar du{' '}
              <button onClick={() => openLegal('vilkar')} className="text-teal-700 underline cursor-pointer">
                vilkårene
              </button>{' '}
              og bekrefter at du har lest{' '}
              <button onClick={() => openLegal('personvern')} className="text-teal-700 underline cursor-pointer">
                personvernerklæringen
              </button>.
            </p>
          </div>
        </div>
      )}

      {/* Account / "Min side" panel (opened from the person icon in the header) */}
      {showAccount && user && (
        <div
          className="fixed inset-0 z-50 bg-slate-900/40 flex items-center justify-center p-4"
          onClick={closeAccount}
          role="dialog"
          aria-modal="true"
          aria-label="Min side"
        >
          <div
            ref={accountDialogRef}
            tabIndex={-1}
            className="bg-white rounded-2xl shadow-xl max-w-md w-full p-6 relative outline-none"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              onClick={closeAccount}
              className="absolute top-3 right-3 p-1.5 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-lg transition cursor-pointer"
              aria-label="Lukk"
            >
              <X className="w-5 h-5" />
            </button>

            <div className="flex items-center gap-3 mb-5">
              <div className="w-11 h-11 bg-teal-700 rounded-full flex items-center justify-center text-white shrink-0">
                <UserCircle className="w-6 h-6" />
              </div>
              <div className="min-w-0">
                <h2 className="text-lg font-bold text-slate-900 leading-tight">Min side</h2>
                <p className="text-sm text-slate-500 truncate" title={user.email || undefined}>
                  {user.email || 'Innlogget'}
                </p>
              </div>
            </div>

            {/* Saldo + kjøp */}
            <div className="flex items-center justify-between gap-3 bg-amber-50 border border-amber-200 rounded-xl px-4 py-3 mb-4">
              <div className="flex items-center gap-2 text-amber-800">
                <Ticket className="w-4 h-4" />
                <span className="font-bold text-sm">{credits ?? '–'} klipp</span>
              </div>
              <button
                onClick={() => { closeAccount(); setPurchaseConsent(false); setShowPurchase(true); }}
                className="flex items-center gap-1.5 text-xs font-bold px-3 py-1.5 bg-teal-700 hover:bg-teal-800 text-white rounded-lg transition cursor-pointer"
              >
                <Plus className="w-3.5 h-3.5" />
                Kjøp flere
              </button>
            </div>

            {/* Lagringsinfo — forklarer hvorfor svar ikke synker mellom enheter */}
            <div className="flex items-start gap-2.5 bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 mb-5 text-xs text-slate-600 leading-relaxed">
              <HardDrive className="w-4 h-4 text-slate-400 shrink-0 mt-0.5" />
              <span>
                Testsvar, profil og notater lagres <span className="font-semibold">kun på denne enheten</span>{' '}
                og synkroniseres ikke mellom PC og mobil. Klippsaldoen er knyttet til kontoen din
                og følger deg på alle enheter. Bruk ikke delte eller offentlige datamaskiner til dette.
              </span>
            </div>

            {/* Handlinger */}
            <div className="space-y-2.5">
              <button
                onClick={() => { closeAccount(); signOut(); }}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-slate-50 text-slate-700 border border-slate-200 font-semibold px-4 py-2.5 rounded-lg text-sm transition cursor-pointer"
              >
                <LogOut className="w-4 h-4" />
                Logg ut
              </button>
              <button
                onClick={() => { closeAccount(); handleDeleteAccount(); }}
                className="w-full flex items-center justify-center gap-2 bg-white hover:bg-rose-50 text-rose-600 border border-rose-200 hover:border-rose-300 font-semibold px-4 py-2.5 rounded-lg text-sm transition cursor-pointer"
              >
                <Trash2 className="w-4 h-4" />
                Slett konto og alle data
              </button>
            </div>

            <p className="text-[11px] text-slate-400 mt-4 text-center">
              <button onClick={() => { closeAccount(); setLegalView('personvern'); }} className="hover:text-slate-600 underline cursor-pointer">
                Personvern
              </button>
              <span aria-hidden="true" className="mx-2">·</span>
              <button onClick={() => { closeAccount(); setLegalView('vilkar'); }} className="hover:text-slate-600 underline cursor-pointer">
                Vilkår & kjøpsbetingelser
              </button>
            </p>
          </div>
        </div>
      )}

    </div>
  );
}
