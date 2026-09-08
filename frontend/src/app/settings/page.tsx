'use client';
import { useEffect, useState, type ReactNode } from 'react';
import {
  getAllSettings, updateSettings, browseFolders, validateVaultPath,
  getAvailableModels, testAIConnection,
} from '@/lib/api';
import type { SettingsMap, ModelInfo, ConnectionTest, BrowseResult, VaultValidation } from '@/lib/types';
import { PageHeader, ErrorBanner, InlineLoader } from '@/components/ui';
import {
  Settings as SettingsIcon, Cpu, FolderOpen, Rss, Sliders, Save, Loader2,
  CheckCircle2, AlertCircle, ChevronRight, Folder, FileText, TestTube,
  RefreshCw, Plus, X, Eye, EyeOff,
} from 'lucide-react';
import type { LucideIcon } from 'lucide-react';

type Tab = 'ai' | 'obsidian' | 'rss' | 'advanced';

const TABS: { id: Tab; label: string; icon: LucideIcon }[] = [
  { id: 'ai', label: 'AI Provider', icon: Cpu },
  { id: 'obsidian', label: 'Obsidian Vault', icon: FolderOpen },
  { id: 'rss', label: 'RSS Feeds', icon: Rss },
  { id: 'advanced', label: 'Advanced', icon: Sliders },
];

const PROVIDERS = [
  { id: 'groq', label: 'Groq (Free, Fast)', placeholder: 'https://api.groq.com/openai/v1' },
  { id: 'openai', label: 'OpenAI', placeholder: 'https://api.openai.com/v1' },
  { id: 'custom', label: 'Custom (OpenAI-compatible)', placeholder: 'http://localhost:11434/v1' },
];

const TASK_LABELS: Record<string, string> = {
  entity_extraction: 'Entity Extraction (ingest)',
  skill_checklist: 'Skill Checklist (roles)',
  skill_module: 'Skill Module Generation',
  solution_review: 'Solution Review',
  project_ideas: 'Project Ideas',
  ctf_restructure: 'CTF Restructure',
  job_analysis: 'Job Analysis',
  weekly_digest: 'Weekly Digest',
  image_description: 'Image Description (vision)',
};

const SECRET_PLACEHOLDER = '••••••••';

function errMessage(err: unknown, fallback: string): string {
  return err instanceof Error ? err.message : fallback;
}

export default function SettingsPage() {
  const [activeTab, setActiveTab] = useState<Tab>('ai');
  const [settings, setSettings] = useState<Partial<SettingsMap>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  useEffect(() => {
    setLoading(true);
    getAllSettings()
      .then(setSettings)
      .catch((err) => setError(errMessage(err, 'Failed to load settings')))
      .finally(() => setLoading(false));
  }, []);

  const updateLocal = (key: string, value: unknown) => {
    setSettings((prev) => ({ ...prev, [key]: value }));
  };

  const handleSave = async (keys?: string[]) => {
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const toSave: Record<string, unknown> = {};
      for (const key of keys ?? Object.keys(settings)) {
        toSave[key] = settings[key];
      }
      await updateSettings(toSave);
      setSuccess('Settings saved successfully');
      setTimeout(() => setSuccess(null), 3000);
    } catch (err) {
      setError(errMessage(err, 'Failed to save settings'));
    }
    setSaving(false);
  };

  if (loading) {
    return <InlineLoader label="Loading settings..." />;
  }

  return (
    <div className="space-y-8">
      <div>
        <h1 className="text-2xl font-bold text-slate-900 dark:text-white tracking-tight flex items-center gap-3">
          <SettingsIcon className="w-7 h-7 text-cyber-500" />
          Settings
        </h1>
        <p className="section-desc">Configure AI providers, data sources, and learning behavior.</p>
      </div>

      {error && <ErrorBanner message={error} onDismiss={() => setError(null)} />}
      {success && (
        <div role="status" className="bg-cyber-500/10 border border-cyber-500/30 text-cyber-700 dark:text-cyber-400 px-4 py-3 rounded-xl flex items-center gap-3">
          <CheckCircle2 className="w-5 h-5 text-cyber-500 flex-shrink-0" />
          <p className="text-sm">{success}</p>
        </div>
      )}

      {/* Tab navigation */}
      <div className="flex gap-1 bg-slate-100 dark:bg-slate-900 p-1.5 rounded-xl border border-slate-200 dark:border-slate-800" role="tablist">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              role="tab"
              aria-selected={activeTab === tab.id}
              onClick={() => setActiveTab(tab.id)}
              className={`flex items-center gap-2 px-4 py-2 rounded-lg text-sm font-semibold transition-all flex-1 justify-center ${
                activeTab === tab.id
                  ? 'bg-white dark:bg-slate-800 text-cyber-600 dark:text-cyber-400 shadow-sm'
                  : 'text-slate-500 dark:text-slate-400 hover:text-slate-700 dark:hover:text-slate-200'
              }`}
            >
              <Icon className="w-4 h-4" />
              <span className="hidden sm:inline">{tab.label}</span>
            </button>
          );
        })}
      </div>

      {activeTab === 'ai' && <AITab settings={settings} updateLocal={updateLocal} handleSave={handleSave} saving={saving} setError={setError} />}
      {activeTab === 'obsidian' && <ObsidianTab settings={settings} updateLocal={updateLocal} handleSave={handleSave} saving={saving} setError={setError} />}
      {activeTab === 'rss' && <RSSTab settings={settings} updateLocal={updateLocal} handleSave={handleSave} saving={saving} />}
      {activeTab === 'advanced' && <AdvancedTab settings={settings} updateLocal={updateLocal} handleSave={handleSave} saving={saving} />}
    </div>
  );
}

// ------------------------------------------------------------------ //
// Shared field helpers
// ------------------------------------------------------------------ //
function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div>
      <label className="label">{label}</label>
      {children}
      {hint && <p className="text-xs text-slate-400 mt-1">{hint}</p>}
    </div>
  );
}

function SaveButton({ onClick, saving, label }: { onClick: () => void; saving: boolean; label: string }) {
  return (
    <div className="flex justify-end">
      <button onClick={onClick} disabled={saving} className="btn-primary flex items-center gap-2 disabled:opacity-50">
        {saving ? <Loader2 className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
        {saving ? 'Saving...' : label}
      </button>
    </div>
  );
}

// ------------------------------------------------------------------ //
// AI Provider Tab
// ------------------------------------------------------------------ //
function AITab({
  settings, updateLocal, handleSave, saving, setError,
}: {
  settings: Partial<SettingsMap>;
  updateLocal: (key: string, value: unknown) => void;
  handleSave: (keys?: string[]) => void;
  saving: boolean;
  setError: (msg: string | null) => void;
}) {
  const [models, setModels] = useState<ModelInfo[]>([]);
  const [loadingModels, setLoadingModels] = useState(false);
  const [testing, setTesting] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTest | null>(null);
  const [showKey, setShowKey] = useState(false);

  const provider = settings['ai.provider'] || 'groq';
  const providerInfo = PROVIDERS.find((p) => p.id === provider) ?? PROVIDERS[0];
  const hasStoredKey = Boolean(settings['ai.api_key']) && settings['ai.api_key'] !== '';

  const fetchModels = async () => {
    setLoadingModels(true);
    try {
      const res = await getAvailableModels();
      setModels(res.models || []);
    } catch (err) {
      setError(errMessage(err, 'Failed to fetch models'));
    }
    setLoadingModels(false);
  };

  const handleTest = async () => {
    setTesting(true);
    setTestResult(null);
    try {
      const res = await testAIConnection();
      setTestResult(res);
    } catch (err) {
      setTestResult({ ok: false, provider, model: '', error: errMessage(err, 'Connection failed') });
    }
    setTesting(false);
  };

  const aiKeys = ['ai.provider', 'ai.base_url', 'ai.api_key', 'ai.model', 'ai.vision_model', 'ai.task_models'];

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <Cpu className="w-5 h-5 text-cyber-500" />
          AI Provider
        </h2>
        <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 mb-6">
          {PROVIDERS.map((p) => (
            <button
              key={p.id}
              onClick={() => updateLocal('ai.provider', p.id)}
              aria-pressed={provider === p.id}
              className={`p-4 rounded-xl border text-left transition-all ${
                provider === p.id
                  ? 'border-cyber-500/50 bg-cyber-500/5 shadow-sm'
                  : 'border-slate-200 dark:border-slate-800 hover:border-slate-300 dark:hover:border-slate-700'
              }`}
            >
              <span className={`font-semibold text-sm ${provider === p.id ? 'text-cyber-600 dark:text-cyber-400' : 'text-slate-900 dark:text-slate-100'}`}>
                {p.label}
              </span>
            </button>
          ))}
        </div>

        <div className="space-y-4 mb-4">
          <Field label="Base URL" hint={`Leave empty for provider default: ${providerInfo.placeholder}`}>
            <input
              type="text"
              value={settings['ai.base_url'] || ''}
              onChange={(e) => updateLocal('ai.base_url', e.target.value)}
              placeholder={providerInfo.placeholder}
              className="input font-mono text-sm"
            />
          </Field>

          <Field
            label="API Key"
            hint={
              hasStoredKey
                ? 'A key is stored. Paste a new value to replace it; leave the placeholder to keep it.'
                : 'Stored locally in your database. Never sent anywhere except your configured provider.'
            }
          >
            <div className="relative">
              <input
                type={showKey ? 'text' : 'password'}
                value={settings['ai.api_key'] || ''}
                onChange={(e) => updateLocal('ai.api_key', e.target.value)}
                placeholder={hasStoredKey ? SECRET_PLACEHOLDER : 'sk-...'}
                className="input font-mono text-sm pr-10"
              />
              <button
                onClick={() => setShowKey(!showKey)}
                aria-label={showKey ? 'Hide API key' : 'Show API key'}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
              >
                {showKey ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
              </button>
            </div>
          </Field>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Default Model">
            <div className="flex gap-2">
              <input
                type="text"
                value={settings['ai.model'] || ''}
                onChange={(e) => updateLocal('ai.model', e.target.value)}
                placeholder="Auto-detected from provider"
                className="input font-mono text-sm flex-1"
              />
              <button
                onClick={fetchModels}
                disabled={loadingModels}
                className="btn-secondary flex items-center gap-1.5 disabled:opacity-50 whitespace-nowrap"
              >
                {loadingModels ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                Fetch
              </button>
            </div>
            {models.length > 0 && (
              <select
                value={settings['ai.model'] || ''}
                onChange={(e) => updateLocal('ai.model', e.target.value)}
                aria-label="Select from available models"
                className="input mt-2 text-sm"
                size={Math.min(models.length, 5)}
              >
                {models.map((m) => (
                  <option key={m.id} value={m.id}>{m.name}</option>
                ))}
              </select>
            )}
          </Field>
          <Field label="Vision Model" hint="For image analysis in Obsidian sync">
            <input
              type="text"
              value={settings['ai.vision_model'] || ''}
              onChange={(e) => updateLocal('ai.vision_model', e.target.value)}
              placeholder="Auto-detected from provider"
              className="input font-mono text-sm"
            />
          </Field>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button onClick={handleTest} disabled={testing} className="btn-secondary flex items-center gap-2 disabled:opacity-50">
            {testing ? <Loader2 className="w-4 h-4 animate-spin" /> : <TestTube className="w-4 h-4" />}
            {testing ? 'Testing...' : 'Test Connection'}
          </button>
          {testResult && (
            <span className={`text-sm flex items-center gap-1.5 ${testResult.ok ? 'text-cyber-500' : 'text-red-500'}`}>
              {testResult.ok ? <CheckCircle2 className="w-4 h-4" /> : <AlertCircle className="w-4 h-4" />}
              {testResult.ok ? `Connected (${testResult.model})` : testResult.error || 'Failed'}
            </span>
          )}
        </div>
      </div>

      {/* Per-task model overrides */}
      <div className="card">
        <h2 className="section-title mb-2">Per-Task Model Overrides</h2>
        <p className="section-desc mb-4">Override the default model for specific tasks. Leave empty to use the default.</p>
        <div className="space-y-3">
          {Object.entries(TASK_LABELS).map(([task, label]) => (
            <div key={task} className="grid grid-cols-3 gap-3 items-center">
              <label htmlFor={`task-${task}`} className="text-sm text-slate-700 dark:text-slate-300">{label}</label>
              <input
                id={`task-${task}`}
                type="text"
                value={settings['ai.task_models']?.[task] || ''}
                onChange={(e) => {
                  const current = settings['ai.task_models'] || {};
                  updateLocal('ai.task_models', { ...current, [task]: e.target.value });
                }}
                placeholder="Default"
                className="input font-mono text-xs col-span-2"
              />
            </div>
          ))}
        </div>
      </div>

      <SaveButton onClick={() => handleSave(aiKeys)} saving={saving} label="Save AI Settings" />
    </div>
  );
}

// ------------------------------------------------------------------ //
// Obsidian Vault Tab
// ------------------------------------------------------------------ //
function ObsidianTab({
  settings, updateLocal, handleSave, saving, setError,
}: {
  settings: Partial<SettingsMap>;
  updateLocal: (key: string, value: unknown) => void;
  handleSave: (keys?: string[]) => void;
  saving: boolean;
  setError: (msg: string | null) => void;
}) {
  const [browseData, setBrowseData] = useState<BrowseResult | null>(null);
  const [browsePath, setBrowsePath] = useState('');
  const [browsing, setBrowsing] = useState(false);
  const [validating, setValidating] = useState(false);
  const [validation, setValidation] = useState<VaultValidation | null>(null);

  const vaultPath = settings['obsidian.vault_path'] || '';

  const browse = async (path?: string) => {
    setBrowsing(true);
    try {
      const res = await browseFolders(path || browsePath || '');
      setBrowseData(res);
      setBrowsePath(res.current_path);
    } catch (err) {
      setError(errMessage(err, 'Failed to browse'));
    }
    setBrowsing(false);
  };

  const selectPath = (path: string) => {
    updateLocal('obsidian.vault_path', path);
    setValidation(null);
  };

  const handleValidate = async () => {
    if (!vaultPath) return;
    setValidating(true);
    try {
      const res = await validateVaultPath(vaultPath);
      setValidation(res);
    } catch (err) {
      setValidation({ valid: false, reason: errMessage(err, 'Validation failed') });
    }
    setValidating(false);
  };

  const obsidianKeys = [
    'obsidian.vault_path', 'obsidian.scan_interval_minutes', 'obsidian.required_tags',
    'obsidian.include_folders', 'obsidian.exclude_folders',
    'obsidian.max_notes_per_scan', 'obsidian.max_images_per_note', 'obsidian.max_image_size',
  ];

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="section-title mb-1 flex items-center gap-2">
          <FolderOpen className="w-5 h-5 text-cyber-500" />
          Vault Location
        </h2>
        <p className="section-desc mb-4">
          Changes take effect on the next sync — no restart needed. The vault is always read-only.
        </p>

        <Field label="Vault Path">
          <div className="flex gap-2">
            <input
              type="text"
              value={vaultPath}
              onChange={(e) => { updateLocal('obsidian.vault_path', e.target.value); setValidation(null); }}
              placeholder="/path/to/your/obsidian/vault"
              className="input font-mono text-sm flex-1"
            />
            <button onClick={() => browse(vaultPath || undefined)} disabled={browsing} className="btn-secondary flex items-center gap-1.5 disabled:opacity-50">
              {browsing ? <Loader2 className="w-4 h-4 animate-spin" /> : <FolderOpen className="w-4 h-4" />}
              Browse
            </button>
            <button onClick={handleValidate} disabled={validating || !vaultPath} className="btn-secondary flex items-center gap-1.5 disabled:opacity-50">
              {validating ? <Loader2 className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
              Validate
            </button>
          </div>
        </Field>

        {validation && (
          <div className={`p-3 rounded-xl mt-4 mb-4 text-sm ${
            validation.valid
              ? 'bg-cyber-500/10 border border-cyber-500/20 text-cyber-700 dark:text-cyber-400'
              : 'bg-red-500/10 border border-red-500/20 text-red-600 dark:text-red-400'
          }`}>
            {validation.valid
              ? `✓ Valid${validation.is_vault ? ' Obsidian vault' : ' directory'} — ${validation.md_count} markdown files found`
              : `✗ ${validation.reason}`}
          </div>
        )}

        {browseData && (
          <div className="border border-slate-200 dark:border-slate-800 rounded-xl overflow-hidden">
            <div className="px-4 py-2.5 bg-slate-50 dark:bg-slate-950 border-b border-slate-200 dark:border-slate-800 flex items-center gap-2">
              <Folder className="w-4 h-4 text-slate-400" />
              <span className="font-mono text-xs text-slate-600 dark:text-slate-300 flex-1 truncate">{browseData.current_path}</span>
              {browseData.is_vault && (
                <span className="badge badge-green text-[10px]">Obsidian Vault</span>
              )}
            </div>
            <div className="max-h-64 overflow-y-auto">
              {browseData.entries.map((entry, i) => (
                <div
                  key={`${entry.path}-${i}`}
                  className={`flex items-center gap-3 px-4 py-2 text-sm transition-colors ${
                    entry.type === 'file' ? 'opacity-50' : 'cursor-pointer hover:bg-slate-50 dark:hover:bg-slate-800/50'
                  }`}
                  onClick={() => {
                    if (entry.type === 'directory' || entry.type === 'parent') browse(entry.path);
                  }}
                >
                  {entry.type === 'parent' ? (
                    <ChevronRight className="w-4 h-4 text-slate-400 rotate-180" />
                  ) : entry.type === 'directory' ? (
                    <Folder className="w-4 h-4 text-amber-400" />
                  ) : (
                    <FileText className="w-4 h-4 text-slate-400" />
                  )}
                  <span className="flex-1 truncate text-slate-700 dark:text-slate-300">{entry.name}</span>
                  {entry.type === 'directory' && (entry.md_count ?? 0) > 0 && (
                    <span className="text-xs text-slate-400">{entry.md_count} .md</span>
                  )}
                  {entry.type === 'directory' && (
                    <button
                      onClick={(e) => { e.stopPropagation(); selectPath(entry.path); }}
                      className="text-xs text-cyber-600 dark:text-cyber-400 hover:underline"
                    >
                      Select
                    </button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>

      <div className="card">
        <h2 className="section-title mb-4">Scan Settings</h2>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mb-4">
          <Field label="Scan Interval (minutes)">
            <input
              type="number"
              value={settings['obsidian.scan_interval_minutes'] ?? 30}
              onChange={(e) => updateLocal('obsidian.scan_interval_minutes', parseInt(e.target.value) || 0)}
              className="input"
              min={5}
            />
          </Field>
          <Field label="Max Notes Per Scan">
            <input
              type="number"
              value={settings['obsidian.max_notes_per_scan'] ?? 10}
              onChange={(e) => updateLocal('obsidian.max_notes_per_scan', parseInt(e.target.value) || 0)}
              className="input"
              min={1}
            />
          </Field>
          <Field label="Max Images Per Note">
            <input
              type="number"
              value={settings['obsidian.max_images_per_note'] ?? 5}
              onChange={(e) => updateLocal('obsidian.max_images_per_note', parseInt(e.target.value) || 0)}
              className="input"
              min={0}
            />
          </Field>
          <Field label="Max Image Size (px)">
            <input
              type="number"
              value={settings['obsidian.max_image_size'] ?? 1024}
              onChange={(e) => updateLocal('obsidian.max_image_size', parseInt(e.target.value) || 0)}
              className="input"
              min={256}
            />
          </Field>
        </div>

        <Field
          label="Required Tags (comma-separated)"
          hint="Only notes with these tags get AI entity extraction. Others are indexed by title only."
        >
          <input
            type="text"
            value={Array.isArray(settings['obsidian.required_tags']) ? settings['obsidian.required_tags'].join(', ') : ''}
            onChange={(e) => updateLocal('obsidian.required_tags', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
            placeholder="cyber, security"
            className="input"
          />
        </Field>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 mt-4">
          <Field label="Include Folders (comma-separated)" hint="Leave empty to include all">
            <input
              type="text"
              value={Array.isArray(settings['obsidian.include_folders']) ? settings['obsidian.include_folders'].join(', ') : ''}
              onChange={(e) => updateLocal('obsidian.include_folders', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
              className="input"
            />
          </Field>
          <Field label="Exclude Folders (comma-separated)" hint="Example: Templates, Archive">
            <input
              type="text"
              value={Array.isArray(settings['obsidian.exclude_folders']) ? settings['obsidian.exclude_folders'].join(', ') : ''}
              onChange={(e) => updateLocal('obsidian.exclude_folders', e.target.value.split(',').map((t) => t.trim()).filter(Boolean))}
              className="input"
            />
          </Field>
        </div>
      </div>

      <SaveButton onClick={() => handleSave(obsidianKeys)} saving={saving} label="Save Obsidian Settings" />
    </div>
  );
}

// ------------------------------------------------------------------ //
// RSS Feeds Tab
// ------------------------------------------------------------------ //
function RSSTab({
  settings, updateLocal, handleSave, saving,
}: {
  settings: Partial<SettingsMap>;
  updateLocal: (key: string, value: unknown) => void;
  handleSave: (keys?: string[]) => void;
  saving: boolean;
}) {
  const feeds: string[] = Array.isArray(settings['rss.feeds']) ? settings['rss.feeds'] : [];
  const [newFeed, setNewFeed] = useState('');

  const addFeed = () => {
    if (!newFeed.trim() || feeds.includes(newFeed.trim())) return;
    updateLocal('rss.feeds', [...feeds, newFeed.trim()]);
    setNewFeed('');
  };

  const removeFeed = (index: number) => {
    updateLocal('rss.feeds', feeds.filter((_, i) => i !== index));
  };

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="section-title mb-2 flex items-center gap-2">
          <Rss className="w-5 h-5 text-cyber-500" />
          RSS Feed Sources
        </h2>
        <p className="section-desc mb-4">
          Security news feeds are polled every 6 hours and queued for processing.
        </p>

        <div className="flex gap-2 mb-4">
          <input
            type="text"
            value={newFeed}
            onChange={(e) => setNewFeed(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && addFeed()}
            placeholder="https://example.com/feed.xml"
            aria-label="New RSS feed URL"
            className="input font-mono text-sm flex-1"
          />
          <button onClick={addFeed} disabled={!newFeed.trim()} className="btn-primary flex items-center gap-1.5 disabled:opacity-50">
            <Plus className="w-4 h-4" />
            Add
          </button>
        </div>

        <div className="space-y-2">
          {feeds.map((feed, i) => (
            <div key={`${feed}-${i}`} className="flex items-center gap-3 p-3 rounded-xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800">
              <Rss className="w-4 h-4 text-slate-400 flex-shrink-0" />
              <span className="font-mono text-xs text-slate-700 dark:text-slate-300 flex-1 truncate">{feed}</span>
              <button
                onClick={() => removeFeed(i)}
                aria-label={`Remove feed ${feed}`}
                className="p-1 text-slate-400 hover:text-red-500 transition-colors"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          ))}
          {feeds.length === 0 && (
            <p className="text-sm text-slate-400 text-center py-4">No RSS feeds configured.</p>
          )}
        </div>
      </div>

      <SaveButton onClick={() => handleSave(['rss.feeds'])} saving={saving} label="Save RSS Settings" />
    </div>
  );
}

// ------------------------------------------------------------------ //
// Advanced Tab
// ------------------------------------------------------------------ //
function AdvancedTab({
  settings, updateLocal, handleSave, saving,
}: {
  settings: Partial<SettingsMap>;
  updateLocal: (key: string, value: unknown) => void;
  handleSave: (keys?: string[]) => void;
  saving: boolean;
}) {
  const advancedKeys = ['advanced.confidence_decay_amount', 'advanced.confidence_decay_days'];

  return (
    <div className="space-y-6">
      <div className="card">
        <h2 className="section-title mb-4 flex items-center gap-2">
          <Sliders className="w-5 h-5 text-cyber-500" />
          Confidence Score Decay
        </h2>
        <p className="section-desc mb-4">
          Skills that haven&apos;t been practiced decay over time, keeping your skill map honest.
        </p>
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Field label="Decay Amount (points)" hint="Points subtracted per decay cycle (Sundays, 2 AM).">
            <input
              type="number"
              value={settings['advanced.confidence_decay_amount'] ?? 5}
              onChange={(e) => updateLocal('advanced.confidence_decay_amount', parseInt(e.target.value) || 0)}
              className="input"
              min={1}
              max={50}
            />
          </Field>
          <Field label="Decay After (days untouched)" hint="Skills untouched for this many days will decay.">
            <input
              type="number"
              value={settings['advanced.confidence_decay_days'] ?? 7}
              onChange={(e) => updateLocal('advanced.confidence_decay_days', parseInt(e.target.value) || 0)}
              className="input"
              min={1}
              max={90}
            />
          </Field>
        </div>
      </div>

      <SaveButton onClick={() => handleSave(advancedKeys)} saving={saving} label="Save Advanced Settings" />
    </div>
  );
}
