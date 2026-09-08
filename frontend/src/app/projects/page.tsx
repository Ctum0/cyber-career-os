'use client';
import { useEffect, useState } from 'react';
import { getProjectIdeas, createProject, getProjects, completeProject } from '@/lib/api';
import { Wrench, Sparkles, Loader2, CheckCircle2, AlertCircle, ChevronRight, Plus } from 'lucide-react';

export default function ProjectsPage() {
  const [ideas, setIdeas] = useState<any[]>([]);
  const [projects, setProjects] = useState<any[]>([]);
  const [loading, setLoading] = useState(false);
  const [creating, setCreating] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    getProjects().then(setProjects).catch((err) => setError(err.message));
  }, []);

  const handleGenerateIdeas = async () => {
    setLoading(true);
    setError(null);
    try {
      const data = await getProjectIdeas();
      setIdeas(Array.isArray(data) ? data : []);
      if (!data || (Array.isArray(data) && data.length === 0)) {
        setError('No project ideas generated. Make sure you have target roles set with skill gaps.');
      }
    } catch (err: any) {
      setError(err.message || 'Failed to generate project ideas');
    }
    setLoading(false);
  };

  const handleCreateProject = async (idea: any) => {
    setCreating(idea.title);
    setError(null);
    try {
      await createProject(idea);
      const updated = await getProjects();
      setProjects(updated);
      setIdeas(ideas.filter((i) => i.title !== idea.title));
    } catch (err: any) {
      setError(err.message || 'Failed to create project');
    }
    setCreating(null);
  };

  const handleComplete = async (projectId: number) => {
    try {
      await completeProject(projectId);
      const updated = await getProjects();
      setProjects(updated);
    } catch (err: any) {
      setError(err.message || 'Failed to mark project complete');
    }
  };

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-3xl font-bold text-slate-900 dark:text-slate-100">Project Factory</h1>
        <p className="text-sm text-slate-400 dark:text-slate-300 mt-1">
          Hands-on projects generated from your weakest skills and current threat trends. Build real tools to prove competency.
        </p>
      </div>

      {/* Error Banner */}
      {error && (
        <div className="bg-red-500/10 border border-red-500/30 text-red-700 dark:text-red-400 px-4 py-3 rounded-xl flex items-center gap-3">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0" />
          <p className="text-sm">{error}</p>
          <button onClick={() => setError(null)} className="ml-auto text-xs text-red-500 hover:text-red-400">Dismiss</button>
        </div>
      )}

      {/* Generate Ideas */}
      <div className="card">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 flex items-center gap-2">
              <Sparkles className="w-5 h-5 text-cyber-500" />
              Generate Project Ideas
            </h2>
            <p className="text-sm text-slate-400 dark:text-slate-300 mt-0.5">
              Based on your weakest skills and current threat trends
            </p>
          </div>
          <button
            onClick={handleGenerateIdeas}
            disabled={loading}
            className="btn-primary flex items-center gap-2 disabled:opacity-50"
          >
            {loading ? (
              <>
                <Loader2 className="w-4 h-4 animate-spin" />
                Generating...
              </>
            ) : (
              <>
                <Sparkles className="w-4 h-4" />
                Generate Ideas
              </>
            )}
          </button>
        </div>
      </div>

      {/* Generated Ideas */}
      {ideas.length > 0 && (
        <div className="card">
          <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
            <Lightbulb className="w-5 h-5 text-amber-400" />
            Ideas ({ideas.length})
          </h2>
          <div className="space-y-4">
            {ideas.map((idea, i) => (
              <div key={i} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900 hover:border-cyber-500/30 transition-colors">
                <div className="flex items-start justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{idea.title}</h3>
                  <button
                    onClick={() => handleCreateProject(idea)}
                    disabled={creating === idea.title}
                    className="text-sm text-cyber-600 dark:text-cyber-400 hover:text-cyber-500 flex items-center gap-1 disabled:opacity-50"
                  >
                    {creating === idea.title ? (
                      <>
                        <Loader2 className="w-3.5 h-3.5 animate-spin" />
                        Creating...
                      </>
                    ) : (
                      <>
                        Start Project <ChevronRight className="w-3.5 h-3.5" />
                      </>
                    )}
                  </button>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400 mb-2">{idea.description}</p>
                <div className="flex flex-wrap gap-2">
                  {idea.skills_targeted?.map((skill: string, j: number) => (
                    <span key={j} className="badge bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border border-cyber-500/20">
                      {skill}
                    </span>
                  ))}
                </div>
                <details className="mt-3">
                  <summary className="text-sm text-slate-400 dark:text-slate-300 cursor-pointer hover:text-slate-600 dark:hover:text-slate-200">
                    More details
                  </summary>
                  <div className="mt-2 text-sm space-y-2 text-slate-600 dark:text-slate-300">
                    <p><strong className="text-slate-700 dark:text-slate-200">Architecture:</strong> {idea.architecture}</p>
                    <p><strong className="text-slate-700 dark:text-slate-200">Stack:</strong> {Array.isArray(idea.stack) ? idea.stack.join(', ') : idea.stack}</p>
                    <p><strong className="text-slate-700 dark:text-slate-200">Stretch Goals:</strong> {idea.stretch_goals?.join(', ')}</p>
                  </div>
                </details>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Active Projects */}
      <div className="card">
        <h2 className="text-lg font-semibold text-slate-900 dark:text-slate-100 mb-4 flex items-center gap-2">
          <Wrench className="w-5 h-5 text-cyber-500" />
          Your Projects
        </h2>
        {projects.length > 0 ? (
          <div className="space-y-4">
            {projects.map((project) => (
              <div key={project.id} className="p-4 rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
                <div className="flex items-center justify-between mb-2">
                  <h3 className="font-semibold text-slate-900 dark:text-slate-100">{project.title}</h3>
                  <div className="flex items-center gap-2">
                    <span className={`badge ${
                      project.status === 'completed'
                        ? 'bg-cyber-500/10 text-cyber-600 dark:text-cyber-400 border-cyber-500/20'
                        : project.status === 'active'
                        ? 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20'
                        : 'bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400'
                    }`}>
                      {project.status}
                    </span>
                    {project.status === 'active' && (
                      <button
                        onClick={() => handleComplete(project.id)}
                        className="text-sm text-cyber-600 dark:text-cyber-400 hover:text-cyber-500 flex items-center gap-1"
                      >
                        <CheckCircle2 className="w-3.5 h-3.5" />
                        Mark Complete
                      </button>
                    )}
                  </div>
                </div>
                <p className="text-sm text-slate-500 dark:text-slate-400">{project.description}</p>
              </div>
            ))}
          </div>
        ) : (
          <div className="text-center py-8 space-y-3">
            <p className="text-slate-400 text-sm">No projects yet. Generate ideas to get started!</p>
            <button
              onClick={handleGenerateIdeas}
              disabled={loading}
              className="btn-primary flex items-center gap-2 mx-auto disabled:opacity-50"
            >
              {loading ? (
                <>
                  <Loader2 className="w-4 h-4 animate-spin" />
                  Generating...
                </>
              ) : (
                <>
                  <Plus className="w-4 h-4" />
                  Generate Ideas
                </>
              )}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

function Lightbulb(props: any) {
  return (
    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d="M15 14c.2-1 .7-1.7 1.5-2.5 1-.9 1.5-2.2 1.5-3.5A6 6 0 0 0 6 8c0 1 .2 2.2 1.5 3.5.7.7 1.3 1.5 1.5 2.5"/>
      <path d="M9 18h6"/><path d="M10 22h4"/>
    </svg>
  );
}
