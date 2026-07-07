import React, { useState } from 'react';
import { statements, DimensionKey, BigFiveKey, dimensionsData, bandsData, computeDimensionScore, getBand, Band, toPOMP, integrityInfo, INTEGRITY_KEY, findClosestRoles } from '../data/statements';
import { ChevronRight, Sparkles, AlertTriangle, HelpCircle, Lock, ShieldCheck, Download, RefreshCw, Briefcase } from 'lucide-react';
import { useFeedback } from '../ui/Feedback';

interface ResultsProps {
  answers: Record<string, number>;
  onNavigateToTab: (tabId: string) => void;
  /** Nullstiller kun testen (med bekreftelse) og starter en ny gjennomføring. */
  onRetake: () => void;
}

export default function Results({ answers, onNavigateToTab, onRetake }: ResultsProps) {
  const { toast } = useFeedback();
  const [activeDimKey, setActiveDimKey] = useState<BigFiveKey>('planmessighet');
  const [isExportingPdf, setIsExportingPdf] = useState(false);

  const handleExportPdf = async () => {
    setIsExportingPdf(true);
    try {
      // Lazy-load the heavy PDF libraries only on first export.
      const { exportBriefingToPdf } = await import('../utils/pdfExport');
      const ok = await exportBriefingToPdf('big-five-profil.pdf');
      if (!ok) toast('Kunne ikke lage PDF akkurat nå. Prøv igjen senere.', 'error');
    } catch (e) {
      console.error('PDF export failed to load/run:', e);
      toast('Kunne ikke lage PDF akkurat nå. Prøv igjen senere.', 'error');
    } finally {
      setIsExportingPdf(false);
    }
  };

  // Verify completeness
  const totalStatementsCount = statements.length;
  const answeredCount = statements.filter(s => answers[s.id] !== undefined).length;
  const isCompleted = answeredCount === totalStatementsCount;

  // 1. Lock Screen (If questionnaire is not finished)
  if (!isCompleted) {
    return (
      <div id="results-locked" className="max-w-md mx-auto py-12 px-4 text-center">
        <div className="bg-white border border-slate-200/60 rounded-xl p-8 shadow-xs">
          <div className="w-14 h-14 bg-slate-50 border border-slate-100 rounded-full flex items-center justify-center text-slate-400 mb-6 mx-auto">
            <Lock className="w-6 h-6" />
          </div>
          
          <h2 className="text-xl font-bold text-slate-900 mb-2">Rapporten er ikke klar ennå</h2>
          <p className="text-slate-600 text-sm leading-relaxed mb-6">
            Rapporten og analysen din blir tilgjengelig så snart du har fullført alle {totalStatementsCount} påstandene i spørreskjemaet. Du har svart på{' '}
            <strong className="text-slate-900">{answeredCount} av {totalStatementsCount}</strong> påstander så langt.
          </p>

          <div className="w-full bg-slate-100 rounded-full h-2 mb-6 overflow-hidden">
            <div 
              className="bg-teal-600 h-2 rounded-full transition-all duration-300"
              style={{ width: `${Math.round((answeredCount / totalStatementsCount) * 100)}%` }}
            />
          </div>

          <button
            onClick={() => onNavigateToTab('questionnaire')}
            className="w-full bg-teal-700 hover:bg-teal-800 text-white font-medium py-2.5 px-4 rounded-lg transition shadow-xs cursor-pointer"
          >
            Fortsett der du slapp
          </button>
        </div>
      </div>
    );
  }

  // Calculate scores for each dimension (rounded to 1 decimal for display + banding).
  const getScore = (dim: DimensionKey): number =>
    Number(computeDimensionScore(dim, answers).toFixed(1));

  const getBandColor = (band: Band) => {
    switch (band) {
      case 'Lav':
        return 'bg-amber-50 border-amber-200 text-amber-800';
      case 'Moderat':
        return 'bg-teal-50 border-teal-200 text-teal-800';
      case 'Høy':
        return 'bg-indigo-50 border-indigo-200 text-indigo-800';
    }
  };

  const scores: Record<BigFiveKey, number> = {
    planmessighet: getScore('planmessighet'),
    emosjonell_stabilitet: getScore('emosjonell_stabilitet'),
    ekstroversjon: getScore('ekstroversjon'),
    omgjengelighet: getScore('omgjengelighet'),
    aapenhet: getScore('aapenhet')
  };

  // Integritet er en egen skala (ikke Big Five) — beregnes separat.
  const integrityScore = getScore(INTEGRITY_KEY);
  const integrityBand = getBand(integrityScore);
  const integrityContent = integrityInfo.bands[integrityBand];

  const activeScore = scores[activeDimKey];
  const activeBand = getBand(activeScore);
  const activeContent = bandsData[activeDimKey][activeBand];
  const activeInfo = dimensionsData[activeDimKey];

  // Rank dimensions from highest to lowest score. Two dimensions closer than this
  // threshold are flagged as "practically tied" — in a short, non-normed test the
  // difference isn't meaningful and shouldn't be over-interpreted.
  const NEAR_TIE_THRESHOLD = 0.3;
  const rankedDimensions = (Object.keys(scores) as BigFiveKey[])
    .map((key) => ({
      key,
      name: dimensionsData[key].name,
      score: scores[key],
      band: getBand(scores[key]),
    }))
    .sort((a, b) => b.score - a.score)
    .map((item, i, arr) => ({
      ...item,
      tiedWithPrev: i > 0 && Math.abs(arr[i - 1].score - item.score) < NEAR_TIE_THRESHOLD,
    }));
  const anyNearTies = rankedDimensions.some((d) => d.tiedWithPrev);

  const strongestTrait = rankedDimensions[0];
  const weakestTrait = rankedDimensions[rankedDimensions.length - 1];
  const closestRoles = findClosestRoles(scores, 3);

  // Forrige fullførte forsøk (snapshotted i App.tsx ved "Slett mine svar"), om noe.
  let previousAttempt: { date: string; scores: Record<string, number> } | null = null;
  try {
    const raw = localStorage.getItem('bigfive_prep_score_history');
    const history: { date: string; scores: Record<string, number> }[] = raw ? JSON.parse(raw) : [];
    previousAttempt = history[0] ?? null;
  } catch {
    previousAttempt = null;
  }

  return (
    <div id="results-dashboard" className="max-w-5xl mx-auto py-6 px-4">
      
      {/* Intro Header */}
      <div className="mb-8 flex flex-col md:flex-row md:items-end md:justify-between gap-4 text-center md:text-left">
        <div>
          <h2 className="text-2xl sm:text-3xl font-bold text-slate-900 tracking-tight mb-2">
            Din Refleksjonsrapport
          </h2>
          <p className="text-slate-600 text-sm sm:text-base max-w-3xl leading-relaxed">
            Basert på dine svar har vi estimert dine tendenser på de fem dimensjonene.
            Bruk denne rapporten til å forstå dine naturlige styrker og fallgruver på jobb, og bli tryggere før intervjuet.
          </p>
        </div>
        <div className="shrink-0 mx-auto md:mx-0 flex items-center gap-2">
          <button
            onClick={handleExportPdf}
            disabled={isExportingPdf}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-sm px-4 py-2.5 rounded-lg transition cursor-pointer flex items-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isExportingPdf ? (
              <>
                <RefreshCw className="w-4 h-4 animate-spin" />
                Genererer PDF...
              </>
            ) : (
              <>
                <Download className="w-4 h-4" />
                Last ned profil (PDF)
              </>
            )}
          </button>
          <button
            onClick={onRetake}
            className="bg-white hover:bg-slate-50 border border-slate-200 text-slate-700 font-semibold text-sm px-4 py-2.5 rounded-lg transition cursor-pointer flex items-center gap-2"
            title="Nullstill svarene og gjennomfør generalprøven på nytt — denne profilen lagres for sammenligning"
          >
            <RefreshCw className="w-4 h-4" />
            Ta testen på nytt
          </button>
        </div>
      </div>

      {/* Visible Disclaimer */}
      <div className="mb-6 p-4 bg-amber-50 border border-amber-200/60 rounded-xl text-amber-900 text-xs sm:text-sm flex items-start gap-3">
        <AlertTriangle className="w-5 h-5 text-amber-600 shrink-0 mt-0.5" />
        <p className="leading-relaxed">
          <strong>Viktig presisering:</strong> Profilen din er <strong>IKKE normert mot en referansegruppe</strong>. Resultatene og båndene (Lav/Moderat/Høy) er utelukkende ment som et pedagogisk og veiledende refleksjonsverktøy, og er ikke diagnostiske eller kliniske vurderinger.
        </p>
      </div>

      {/* Relative Profile Ranking View */}
      <div className="mb-8 bg-white border border-slate-100 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2.5 mb-3">
          <Sparkles className="w-5 h-5 text-teal-600 animate-pulse" />
          <h3 className="font-bold text-slate-950 text-base sm:text-lg">
            Relativ Profil (Rangerte personlighetstrekk)
          </h3>
        </div>
        <p className="text-slate-600 text-xs sm:text-sm leading-relaxed mb-3">
          Ved å rangere dimensjonene dine fra høyest til lavest skår kan vi se hvilke personlighetstrekk som er mest fremtredende hos deg relativt sett. Dette gir verdifull selvinnsikt uavhengig av de absolutte grensene:
        </p>
        {anyNearTies && (
          <p className="text-slate-500 text-[11px] sm:text-xs leading-relaxed mb-5 bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2">
            <span className="font-semibold text-slate-700">≈ Merk:</span> Dimensjoner merket «likt nivå» ligger så tett at forskjellen neppe er meningsfull i en kort test. Tolk rekkefølgen mellom dem med varsomhet — de er i praksis jevnbyrdige.
          </p>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-5 gap-4">
          {rankedDimensions.map((item, index) => {
            const isStrongest = item.key === strongestTrait.key;
            const isWeakest = item.key === weakestTrait.key;
            const isActive = activeDimKey === item.key;

            return (
              <button
                key={item.key}
                onClick={() => setActiveDimKey(item.key)}
                className={`p-4 rounded-xl border text-left flex flex-col justify-between h-full transition relative cursor-pointer group hover:shadow-xs ${
                  isStrongest
                    ? 'bg-indigo-50/45 border-indigo-200 hover:border-indigo-300 ring-1 ring-indigo-500/20'
                    : isWeakest
                    ? 'bg-amber-50/35 border-amber-200 hover:border-amber-300 ring-1 ring-amber-500/15'
                    : 'bg-slate-50/40 border-slate-200/60 hover:bg-slate-50'
                } ${isActive ? 'ring-2 ring-slate-900/60' : ''}`}
              >
                <div className="w-full">
                  <div className="flex justify-between items-center mb-2">
                    <span className="text-[10px] font-bold font-mono text-slate-400">RANG #{index + 1}</span>
                    <span className={`text-[10px] font-bold px-1.5 py-0.5 rounded-md ${
                      isStrongest
                        ? 'bg-indigo-100 text-indigo-900'
                        : isWeakest
                        ? 'bg-amber-100 text-amber-900'
                        : 'bg-slate-200/80 text-slate-700'
                    }`}>
                      Skår: {item.score}
                    </span>
                  </div>

                  <h4 className="font-bold text-slate-900 text-sm group-hover:text-teal-700 transition mb-1 leading-tight">
                    {item.name}
                  </h4>
                  <p className="text-slate-500 text-[11px] mb-1">
                    Bånd: <span className="font-semibold text-slate-700">{item.band}</span>
                  </p>
                  {item.tiedWithPrev && (
                    <p className="text-[10px] font-semibold text-slate-500 mb-2">
                      ≈ likt nivå som #{index}
                    </p>
                  )}
                </div>

                <div className="w-full mt-auto pt-2 border-t border-slate-100/60">
                  {isStrongest && (
                    <span className="block text-center text-[9px] font-extrabold uppercase tracking-wider py-1 bg-indigo-600 text-white rounded-md">
                      ⭐ Ditt sterkeste trekk
                    </span>
                  )}
                  {isWeakest && (
                    <span className="block text-center text-[9px] font-extrabold uppercase tracking-wider py-1 bg-amber-600 text-white rounded-md">
                      ⚠️ Ditt svakeste trekk
                    </span>
                  )}
                  {!isStrongest && !isWeakest && (
                    <span className="block text-center text-[9px] font-medium text-slate-400 py-1">
                      Mellomliggende trekk
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Work-style reference comparison — illustrative reflection only, not job-matching */}
      <div className="mb-8 bg-white border border-slate-100 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2.5 mb-2">
          <Briefcase className="w-5 h-5 text-teal-600" />
          <h3 className="font-bold text-slate-950 text-base sm:text-lg">
            Arbeidsstilen din minner mest om disse profilene
          </h3>
        </div>
        <p className="text-slate-500 text-xs sm:text-sm leading-relaxed mb-4">
          Vi har sammenlignet svarene dine med noen enkle referanseprofiler. Dette
          sier ikke hvilket yrke du bør velge, men kan gi en pekepinn på hvilken type
          arbeidsstil svarene dine minner mest om.
        </p>
        <ol className="space-y-3">
          {closestRoles.map((role, i) => (
            <li key={role.id} className="flex items-start gap-3 bg-slate-50/60 border border-slate-200/70 rounded-lg p-3">
              <span className="shrink-0 w-6 h-6 rounded-full bg-teal-700 text-white text-xs font-bold flex items-center justify-center mt-0.5">
                {i + 1}
              </span>
              <div>
                <p className="font-semibold text-slate-900 text-sm">{role.name}</p>
                <p className="text-slate-600 text-xs sm:text-sm leading-relaxed">{role.blurb}</p>
              </div>
            </li>
          ))}
        </ol>
        <p className="text-[11px] text-slate-400 mt-4 leading-relaxed bg-slate-50 border border-slate-200/60 rounded-lg px-3 py-2.5">
          Dette er en illustrerende sammenligning basert på svarene dine i denne
          øvingsappen. Den er <strong>ikke</strong> en normert yrkestest, ikke en
          fasit og ikke en vurdering av hva du passer til. Bruk resultatet som en
          refleksjon rundt arbeidsstil – ikke som karriereråd eller dokumentasjon på
          egnethet.
        </p>
      </div>

      {/* Compare to previous attempt, if one was saved (see App.tsx handleResetAllData) */}
      {previousAttempt && (
        <div className="mb-8 bg-white border border-slate-100 rounded-xl p-5 sm:p-6 shadow-xs">
          <div className="flex items-center gap-2.5 mb-1">
            <RefreshCw className="w-5 h-5 text-teal-600" />
            <h3 className="font-bold text-slate-950 text-base sm:text-lg">
              Sammenlignet med forrige forsøk
            </h3>
          </div>
          <p className="text-slate-500 text-xs mb-4">
            Forrige fullførte forsøk: {new Date(previousAttempt.date).toLocaleDateString('no-NO')}
          </p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
            {[...(Object.keys(dimensionsData) as BigFiveKey[]), INTEGRITY_KEY].map((key) => {
              const name = key === INTEGRITY_KEY ? integrityInfo.name : dimensionsData[key as BigFiveKey].name;
              const prev = previousAttempt!.scores[key];
              const now = key === INTEGRITY_KEY ? integrityScore : scores[key as BigFiveKey];
              if (typeof prev !== 'number' || typeof now !== 'number') return null;
              const delta = now - prev;
              const arrow = delta > 0.05 ? '↑' : delta < -0.05 ? '↓' : '→';
              const color = delta > 0.05 ? 'text-emerald-700' : delta < -0.05 ? 'text-amber-700' : 'text-slate-400';
              return (
                <div key={key} className="bg-slate-50/60 border border-slate-200/70 rounded-lg p-3">
                  <p className="text-[11px] font-semibold text-slate-500 mb-1 truncate">{name}</p>
                  <p className="font-mono text-sm text-slate-800">
                    {prev.toFixed(1)} <span className={`font-bold ${color}`}>{arrow}</span> {now.toFixed(1)}
                  </p>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* Main Grid: Left sidebar scores list, Right sidebar details card */}
      <div className="grid lg:grid-cols-12 gap-8 items-start">
        
        {/* Left Side: Score Summary List (5 cols on lg) */}
        <div className="lg:col-span-5 space-y-4">
          <div className="bg-white border border-slate-100 rounded-xl p-4 shadow-xs">
            <h3 className="font-semibold text-slate-900 text-sm uppercase tracking-wider mb-4 px-1">
              Dine dimensjonsskårer
            </h3>
            
            <div className="space-y-3">
              {(Object.keys(scores) as BigFiveKey[]).map((key) => {
                const score = scores[key];
                const band = getBand(score);
                const name = dimensionsData[key].name;
                const isActive = activeDimKey === key;

                return (
                  <button
                    key={key}
                    id={`btn-select-result-${key}`}
                    onClick={() => setActiveDimKey(key)}
                    className={`w-full text-left p-3.5 rounded-lg border transition cursor-pointer flex flex-col gap-2 ${
                      isActive 
                        ? 'bg-slate-900 border-slate-900 text-white shadow-sm' 
                        : 'bg-slate-50/60 hover:bg-slate-50 border-slate-200/70 text-slate-800'
                    }`}
                  >
                    <div className="flex justify-between items-center w-full">
                      <span className="font-semibold text-sm sm:text-base">{name}</span>
                      <div className="flex items-center gap-2">
                        <span className="text-xs font-bold font-mono px-2 py-0.5 rounded-md bg-white/20">
                          {score}
                        </span>
                        <span className={`text-[10px] font-mono px-2 py-0.5 rounded-md ${
                          isActive ? 'bg-white/10 text-white/80' : 'bg-slate-200/70 text-slate-600'
                        }`} title="POMP (0–100)">
                          {toPOMP(score)}
                        </span>
                        <span className={`text-[10px] sm:text-xs font-semibold px-2 py-0.5 rounded-full border ${
                          isActive
                            ? 'bg-white/10 border-white/20 text-white'
                            : getBandColor(band)
                        }`}>
                          {band}
                        </span>
                        <ChevronRight className={`w-4 h-4 shrink-0 transition ${isActive ? 'translate-x-0.5' : 'text-slate-400'}`} />
                      </div>
                    </div>

                    {/* Small horizontal gauge visually representing score */}
                    <div className="w-full bg-slate-200/50 rounded-full h-1.5 overflow-hidden">
                      <div 
                        className={`h-1.5 rounded-full ${isActive ? 'bg-teal-400' : 'bg-teal-600'}`}
                        style={{ width: `${(score / 5) * 100}%` }}
                      />
                    </div>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="bg-slate-50 border border-slate-200/60 rounded-xl p-5 text-sm space-y-3 text-slate-600">
            <h4 className="font-semibold text-slate-900 text-xs uppercase tracking-wider">Metode og Skåring</h4>
            <p className="text-xs leading-relaxed">
              Skåren beregnes som gjennomsnittet (1.0–5.0) av de 12 leddene i hver dimensjon, etter at negative ledd er snudd (reversert) slik at alle peker samme retning.
            </p>
            <p className="text-xs leading-relaxed">
              Tallet ved siden av (0–100) er en <span className="font-semibold text-slate-700">POMP-skår</span> (Percent of Maximum Possible): den samme skåren skalert til en 0–100-skala, <code className="text-[10px]">(skår − 1) / 4 × 100</code>, så dimensjoner blir lettere å sammenligne.
            </p>
            <div className="grid grid-cols-3 gap-2 pt-1 text-center text-[11px] font-semibold">
              <div className="bg-amber-50 text-amber-800 border border-amber-100 rounded-md py-1">Lav: ≤2.6</div>
              <div className="bg-teal-50 text-teal-800 border border-teal-100 rounded-md py-1">Moderat: 2.7–3.6</div>
              <div className="bg-indigo-50 text-indigo-800 border border-indigo-100 rounded-md py-1">Høy: ≥3.7</div>
            </div>
          </div>
        </div>

        {/* Right Side: Detailed analysis of active score (7 cols on lg) */}
        <div id="results-detail-panel" className="lg:col-span-7 bg-white border border-slate-100 rounded-xl p-6 sm:p-8 shadow-xs space-y-6">
          
          {/* Active Dimension Header */}
          <div className="border-b border-slate-100 pb-5">
            <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-3 mb-2">
              <h3 className="text-xl sm:text-2xl font-bold text-slate-950">
                {activeInfo.name}
              </h3>
              <div className="flex items-center gap-2.5">
                <span className="font-mono text-lg font-bold bg-slate-100 text-slate-800 px-3 py-0.5 rounded-md">
                  {activeScore}
                </span>
                <span className="font-mono text-xs font-semibold bg-slate-100 text-slate-500 px-2.5 py-1 rounded-md" title="POMP (0–100)">
                  {toPOMP(activeScore)}/100
                </span>
                <span className={`text-sm font-semibold px-3 py-1 rounded-full border ${getBandColor(activeBand)}`}>
                  Estimerte tendens: {activeBand}
                </span>
              </div>
            </div>
            <p className="text-slate-500 text-xs sm:text-sm italic">
              {activeInfo.description}
            </p>
          </div>

          {/* Visual Gauge of the Selected Score */}
          <div className="bg-slate-50 border border-slate-100 p-4 rounded-xl">
            <div className="flex justify-between text-[11px] text-slate-400 font-semibold mb-2 px-1">
              <span>LAV (1.0 - 2.6)</span>
              <span>MODERAT (2.7 - 3.6)</span>
              <span>HØY (3.7 - 5.0)</span>
            </div>
            
            {/* Horizontal timeline scale with mark boundaries */}
            <div className="relative w-full h-4 bg-slate-200 rounded-full">
              {/* Boundary markers */}
              {/* Skala 1–5 → posisjon i %: (verdi-1)/4. Lav-grense 2.6 = 40%, Høy-grense 3.6/3.7 ≈ 65%. */}
              <div className="absolute left-[40%] top-0 bottom-0 w-0.5 bg-white z-10" title="Grense Lav-Moderat (2.6)" />
              <div className="absolute left-[65%] top-0 bottom-0 w-0.5 bg-white z-10" title="Grense Moderat-Høy (3.6)" />
              
              {/* Colored segment overlay */}
              <div className="absolute left-0 top-0 bottom-0 right-[60%] bg-amber-200/55 rounded-l-full" />
              <div className="absolute left-[40%] top-0 bottom-0 right-[35%] bg-teal-200/55" />
              <div className="absolute left-[65%] top-0 bottom-0 right-0 bg-indigo-200/55 rounded-r-full" />

              {/* Indicator thumb */}
              <div 
                className="absolute w-6 h-6 bg-slate-900 border-2 border-white rounded-full -top-1 shadow-md -ml-3 flex items-center justify-center text-[10px] text-white font-bold transition-all duration-500"
                style={{ left: `${((activeScore - 1) / 4) * 100}%` }}
              >
                {activeScore}
              </div>
            </div>
            <p className="text-center text-[11px] text-slate-500 mt-2.5">
              Ditt gjennomsnittlige svarnivå ligger i det <strong>{activeBand.toLowerCase()}</strong> området.
            </p>
          </div>

          {/* Detailed Interpretation */}
          <div className="space-y-2">
            <h4 className="font-semibold text-slate-900 text-sm uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-4 h-4 text-teal-600" />
              Kort tolkning
            </h4>
            <p className="text-slate-700 text-sm sm:text-base leading-relaxed">
              {activeContent.interpretation}
            </p>
          </div>

          {/* Strengths & Pitfalls Grid */}
          <div className="grid md:grid-cols-2 gap-6 pt-2">
            <div className="space-y-2.5">
              <h4 className="font-semibold text-emerald-950 text-sm uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-emerald-500" />
                Mulige styrker på jobb
              </h4>
              <ul className="space-y-1.5">
                {activeContent.strengths.map((strength, i) => (
                  <li key={i} className="text-slate-600 text-sm leading-relaxed flex items-start gap-2">
                    <span className="text-emerald-500 font-bold shrink-0 mt-0.5">•</span>
                    <span>{strength}</span>
                  </li>
                ))}
              </ul>
            </div>

            <div className="space-y-2.5">
              <h4 className="font-semibold text-amber-950 text-sm uppercase tracking-wider flex items-center gap-1.5">
                <span className="w-2 h-2 rounded-full bg-amber-500" />
                Mulige fallgruver
              </h4>
              <ul className="space-y-1.5">
                {activeContent.pitfalls.map((pitfall, i) => (
                  <li key={i} className="text-slate-600 text-sm leading-relaxed flex items-start gap-2">
                    <span className="text-amber-500 font-bold shrink-0 mt-0.5">•</span>
                    <span>{pitfall}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {/* Interview preparation reflection questions */}
          <div className="border-t border-slate-100 pt-5 space-y-3">
            <h4 className="font-semibold text-slate-900 text-sm uppercase tracking-wider flex items-center gap-1.5">
              <HelpCircle className="w-4 h-4 text-slate-500" />
              Refleksjonsspørsmål før intervju
            </h4>
            <p className="text-slate-500 text-xs">
              Tenk igjennom disse spørsmålene på forhånd. De hjelper deg å formulere konkrete svar hvis rekruttereren spør om din personlighetstendens.
            </p>
            <div className="bg-slate-50/50 p-4 rounded-lg border border-slate-100 space-y-2.5">
              {activeContent.reflectionQuestions.map((q, i) => (
                <p key={i} className="text-slate-700 text-sm leading-relaxed flex items-start gap-2 italic">
                  <span className="text-slate-400 font-bold shrink-0">?</span>
                  <span>"{q}"</span>
                </p>
              ))}
            </div>
          </div>

          {/* Quick link to other features */}
          <div className="bg-teal-50 border border-teal-100/50 rounded-xl p-4 flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4 mt-6">
            <div>
              <h5 className="font-semibold text-teal-950 text-xs uppercase tracking-wider">Neste Steg: Intervjutrening</h5>
              <p className="text-teal-900 text-xs mt-0.5">
                Vi har skreddersydd konkrete eksempelsvar og oppfølgingsspørsmål basert på profilen din.
              </p>
            </div>
            <button
              onClick={() => onNavigateToTab('interview-prep')}
              className="bg-teal-700 hover:bg-teal-800 text-white font-medium text-xs px-3.5 py-1.5 rounded-lg transition shrink-0 cursor-pointer"
            >
              Start forberedelse
            </button>
          </div>

        </div>
      </div>

      {/* Integritetsskala — egen skala, vist separat fra Big Five */}
      <div className="mt-8 bg-white border border-slate-100 rounded-xl p-5 sm:p-6 shadow-xs">
        <div className="flex items-center gap-2.5 mb-3">
          <ShieldCheck className="w-5 h-5 text-teal-600" />
          <h3 className="font-bold text-slate-950 text-base sm:text-lg">
            {integrityInfo.name}
          </h3>
          <span className="text-[10px] font-bold uppercase tracking-wider bg-slate-100 text-slate-500 px-2 py-0.5 rounded-md">
            Egen skala
          </span>
        </div>
        <p className="text-slate-600 text-xs sm:text-sm leading-relaxed mb-5">
          {integrityInfo.description}
        </p>

        <div className="grid md:grid-cols-3 gap-4">
          {/* Skår + POMP + bånd */}
          <div className="bg-slate-50/60 border border-slate-200/70 rounded-xl p-4 flex flex-col items-center justify-center text-center">
            <div className="flex items-baseline gap-1.5">
              <span className="font-mono text-3xl font-bold text-slate-900">{integrityScore}</span>
              <span className="text-slate-400 text-sm">/5</span>
            </div>
            <span className="font-mono text-xs text-slate-500 mt-1" title="POMP (0–100)">
              {toPOMP(integrityScore)}/100 POMP
            </span>
            <span className={`mt-2 text-xs font-semibold px-3 py-1 rounded-full border ${getBandColor(integrityBand)}`}>
              {integrityBand} tendens
            </span>
          </div>

          {/* Tolkning + forberedelsestips */}
          <div className="md:col-span-2 space-y-3">
            <div>
              <h4 className="font-semibold text-slate-900 text-xs uppercase tracking-wider mb-1">Kort tolkning</h4>
              <p className="text-slate-700 text-sm leading-relaxed">{integrityContent.interpretation}</p>
            </div>
            <div>
              <h4 className="font-semibold text-slate-900 text-xs uppercase tracking-wider mb-1 flex items-center gap-1.5">
                <HelpCircle className="w-3.5 h-3.5 text-slate-500" />
                Tips til forberedelse
              </h4>
              <p className="text-slate-600 text-sm leading-relaxed">{integrityContent.prepTip}</p>
            </div>
          </div>
        </div>

        <p className="text-[11px] text-slate-400 mt-4 leading-relaxed">
          Integritetsskalaen er, som resten av verktøyet, <strong>ikke normert</strong> mot en referansegruppe
          og er kun ment som veiledende refleksjon — ikke en vurdering av din moral.
        </p>
      </div>

    </div>
  );
}
