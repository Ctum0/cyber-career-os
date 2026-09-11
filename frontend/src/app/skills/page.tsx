'use client';
import { useEffect, useState } from 'react';
import { getSkillModules, submitSolution, generateSkillModules } from '@/lib/api';
import type { SkillModule, SolutionReview } from '@/lib/types';
import { PageHeader, ErrorBanner, EmptyState } from '@/components/ui';
import { Award, CheckCircle2, RotateCw, Sparkles, Send, BookOpen, Layers, Loader2 } from 'lucide-react';

export default function SkillsPage() {
  const [modules, setModules] = useState<SkillModule[]>([]);
  const [selectedModule, setSelectedModule] = useState<SkillModule | null>(null);
  const [solution, setSolution] = useState('');
  const [review, setReview] = useState<SolutionReview | null>(null);
  const [loading, setLoading] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [flippedCards, setFlippedCards] = useState<Record<number, boolean>>({});

  const loadModules = () => {
    getSkillModules()
      .then((data) => {
        setModules(data || []);
        if (data && data.length > 0 && !selectedModule) {
          setSelectedModule(data[0]);
        }
      })
      .catch((err: unknown) =>
        setError(err instanceof Error ? err.message : 'Failed to load modules')
      );
  };

  useEffect(() => {
    loadModules();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const handleGenerate = async () => {
    setGenerating(true);
    setError(null);
    try {
      const res = await generateSkillModules(5);
      loadModules();
      if (res.created === 0) {
        setError('No new modules to generate — all priority skills already have modules, or no target roles are set.');
      }
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to generate modules');
    }
    setGenerating(false);
  };

  const handleSubmit = async (moduleId: number) => {
    if (!solution.trim()) return;
    setLoading(true);
    setError(null);
    try {
      const res = await submitSolution(moduleId, solution);
      setReview(res);
      setSolution('');
      loadModules();
    } catch (err: unknown) {
      setError(err instanceof Error ? err.message : 'Failed to submit solution');
    }
    setLoading(false);
  };

  const toggleFlip = (index: number) => {
    setFlippedCards((prev) => ({ ...prev, [index]: !prev[index] }));
  };

  const ankiCards = selectedModule?.anki_cards ?? [];

  const generateButton = (
    <button
      onClick={handleGenerate}
      disabled={generating}
      className="btn-primary flex items-center gap-2 mx-auto disabled:opacity-50"
    >
      {generating ? (
        <>
          <Loader2 className="w-4 h-4 animate-spin" />
          Generating...
        </>
      ) : (
        <>
          <Sparkles className="w-4 h-4" />
          Generate Modules
        </>
      )}
    </button>
  );

  return (
    <div className="space-y-8">
      <PageHeader
        title="Skill Pipeline"
        description="Auto-generated training modules targeting your lowest-confidence high-priority skills. Complete labs, practice Anki flashcards, and submit proof of work."
      />

      {/* Error Banner */}
      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}

      <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
        {/* Module Sidebar List */}
        <div className="card space-y-4">
          <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Layers className="w-5 h-5 text-cyber-500" />
              Skill Modules
            </h2>
            <span className="text-xs px-2 py-0.5 rounded-full bg-slate-100 dark:bg-slate-800 font-semibold text-slate-400">
              {modules.length}
            </span>
          </div>

          {modules.length > 0 ? (
            <div className="space-y-2.5">
              {modules.map((mod) => {
                const isSelected = selectedModule?.id === mod.id;
                return (
                  <div
                    key={mod.id}
                    tabIndex={0}
                    role="button"
                    aria-pressed={isSelected}
                    className={`p-4 rounded-xl cursor-pointer transition-all border outline-none focus-visible:ring-2 focus-visible:ring-cyber-500 ${
                      isSelected
                        ? 'border-cyber-500/50 bg-cyber-500/5 shadow-sm'
                        : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700 bg-white dark:bg-slate-900'
                    }`}
                    onClick={() => {
                      setSelectedModule(mod);
                      setReview(null);
                      setFlippedCards({});
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setSelectedModule(mod);
                        setReview(null);
                        setFlippedCards({});
                      }
                    }}
                  >
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="font-semibold text-sm text-slate-900 dark:text-slate-100">
                        Module #{mod.id}
                      </span>
                      <span
                        className={`badge ${
                          mod.status === 'reviewed'
                            ? 'bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20'
                            : mod.status === 'in_progress'
                            ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                            : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                        }`}
                      >
                        {mod.status}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400 dark:text-slate-300 line-clamp-2">
                      {mod.challenge || 'Custom skill practice challenge'}
                    </p>
                  </div>
                );
              })}
            </div>
          ) : (
            <EmptyState
              message="No modules generated yet."
              hint="Set target roles first, then generate modules for your weakest skills."
              action={generateButton}
            />
          )}
        </div>

        {/* Selected Module Detail */}
        <div className="md:col-span-2 space-y-6">
          {selectedModule ? (
            <div className="card space-y-6">
              <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
                <div>
                  <span className="badge bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20 uppercase text-[10px] font-bold">
                    Active Training Module
                  </span>
                  <h2 className="text-xl font-bold text-slate-900 dark:text-slate-100 mt-1">
                    Module #{selectedModule.id}
                  </h2>
                </div>
                <div className="flex items-center gap-2">
                  <button
                    onClick={handleGenerate}
                    disabled={generating}
                    className="btn-secondary text-xs flex items-center gap-1.5 disabled:opacity-50"
                  >
                    {generating ? (
                      <Loader2 className="w-3.5 h-3.5 animate-spin" />
                    ) : (
                      <Sparkles className="w-3.5 h-3.5" />
                    )}
                    {generating ? 'Generating...' : 'Generate More'}
                  </button>
                  <span
                    className={`badge ${
                      selectedModule.status === 'reviewed'
                        ? 'bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20'
                        : 'bg-amber-500/10 text-amber-600 dark:text-amber-400 border-amber-500/20'
                    }`}
                  >
                    {selectedModule.status}
                  </span>
                </div>
              </div>

              {/* Lab Exercise Section */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
                  <BookOpen className="w-4 h-4 text-cyber-500" />
                  Hands-on Lab Instructions
                </h3>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 font-mono text-xs leading-relaxed whitespace-pre-wrap text-slate-800 dark:text-slate-200">
                  {selectedModule.lab_exercise}
                </div>
              </div>

              {/* Interactive Anki Flashcards */}
              {ankiCards.length > 0 && (
                <div>
                  <h3 className="text-xs font-semibold uppercase text-slate-400 mb-3 flex items-center gap-1.5">
                    <Sparkles className="w-4 h-4 text-amber-400" />
                    Anki Practice Flashcards (Click or press Enter to Flip)
                  </h3>
                  <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-4">
                    {ankiCards.map((card, idx) => {
                      const isFlipped = flippedCards[idx];
                      return (
                        <div
                          key={idx}
                          tabIndex={0}
                          role="button"
                          aria-label={`Flashcard ${idx + 1}: ${isFlipped ? 'showing answer' : 'showing question'}`}
                          onClick={() => toggleFlip(idx)}
                          onKeyDown={(e) => {
                            if (e.key === 'Enter' || e.key === ' ') {
                              e.preventDefault();
                              toggleFlip(idx);
                            }
                          }}
                          className={`h-40 rounded-xl p-4 cursor-pointer transition-all border flex flex-col justify-between select-none outline-none focus-visible:ring-2 focus-visible:ring-cyber-500 ${
                            isFlipped
                              ? 'bg-cyber-950/40 border-cyber-500/50 text-cyber-200 shadow-md'
                              : 'bg-slate-900 border-slate-800 hover:border-slate-700 text-slate-100'
                          }`}
                        >
                          <div className="flex items-center justify-between text-[10px] uppercase font-bold text-slate-400">
                            <span>Card #{idx + 1}</span>
                            <span className="flex items-center gap-1 text-cyber-400">
                              <RotateCw className="w-3 h-3" />
                              {isFlipped ? 'Answer' : 'Question'}
                            </span>
                          </div>
                          <p className="text-sm font-medium leading-relaxed my-auto text-center">
                            {isFlipped ? card.a : card.q}
                          </p>
                          <span className="text-[10px] text-center text-slate-400">
                            {isFlipped ? 'Click to show question' : 'Click to reveal answer'}
                          </span>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}

              {/* Challenge Description */}
              <div>
                <h3 className="text-xs font-semibold uppercase text-slate-400 mb-2 flex items-center gap-1.5">
                  <Award className="w-4 h-4 text-cyber-500" />
                  "Prove-It" Challenge
                </h3>
                <div className="p-4 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 text-xs leading-relaxed text-slate-800 dark:text-slate-200">
                  {selectedModule.challenge}
                </div>
              </div>

              {/* Solution Submission Form */}
              {selectedModule.status !== 'reviewed' ? (
                <div className="space-y-3 pt-2">
                  <h3 className="text-xs font-semibold uppercase text-slate-400">Your Solution / Proof of Work</h3>
                  <textarea
                    value={solution}
                    onChange={(e) => setSolution(e.target.value)}
                    placeholder="Paste command outputs, script logic, detection rules, or challenge solution..."
                    className="input min-h-[140px] font-mono text-xs"
                  />
                  <div className="flex justify-end">
                    <button
                      onClick={() => handleSubmit(selectedModule.id)}
                      disabled={loading || !solution.trim()}
                      className="btn-primary flex items-center gap-2 disabled:opacity-50"
                    >
                      {loading ? (
                        <>
                          <Loader2 className="w-4 h-4 animate-spin" />
                          Evaluating...
                        </>
                      ) : (
                        <>
                          <Send className="w-4 h-4" />
                          Submit for AI Evaluation
                        </>
                      )}
                    </button>
                  </div>
                </div>
              ) : (
                <div className="p-4 rounded-xl bg-cyber-500/10 border border-cyber-500/20 flex items-center gap-3">
                  <CheckCircle2 className="w-5 h-5 text-cyber-500" />
                  <div>
                    <h4 className="text-sm font-bold text-cyber-600 dark:text-cyber-400">Module Complete</h4>
                    <p className="text-xs text-slate-400">Solution evaluated and confidence score updated.</p>
                  </div>
                </div>
              )}

              {/* AI Review Outcome Card */}
              {review && (
                <div className="p-5 rounded-2xl bg-slate-900 border border-cyber-500/30 text-slate-100 space-y-3 fade-in">
                  <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                    <h4 className="text-sm font-bold text-cyber-400 flex items-center gap-1.5">
                      <Sparkles className="w-4 h-4" />
                      AI Evaluation Result
                    </h4>
                    <span className="text-xs font-bold px-2.5 py-0.5 rounded-full bg-cyber-500/20 text-cyber-400 border border-cyber-500/30">
                      Score: {review.score}/100
                    </span>
                  </div>
                  <p className="text-xs text-slate-300 whitespace-pre-wrap leading-relaxed">{review.feedback}</p>
                </div>
              )}
            </div>
          ) : (
            <div className="card">
              <EmptyState
                message={
                  modules.length > 0
                    ? 'Select a module from the left menu to start practicing.'
                    : 'No modules available yet.'
                }
                hint={modules.length === 0 ? 'Generate modules to start training.' : undefined}
                action={modules.length === 0 ? generateButton : undefined}
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
