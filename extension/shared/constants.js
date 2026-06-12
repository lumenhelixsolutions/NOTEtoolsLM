// NOTEtoolsLM — Shared Constants

export const ARTIFACT_TYPES = {
  audio:      { label: 'Audio',      icon: '\uD83C\uDF99', color: '#3b82f6', ext: 'mp3' },
  video:      { label: 'Video',      icon: '\uD83C\uDFAC', color: '#ec4899', ext: 'mp4' },
  slide_deck: { label: 'Slides',     icon: '\uD83D\uDCC1', color: '#f59e0b', ext: 'pdf' },
  mind_map:   { label: 'Mind Map',   icon: '\uD83E\uDDE0', color: '#8b5cf6', ext: 'json' },
  report:     { label: 'Report',     icon: '\uD83D\uDCCA', color: '#10b981', ext: 'md' }
};

export const PREFABS = [
  {
    id: 'deep-dive',
    name: 'Deep-Dive Podcast',
    type: 'audio',
    desc: 'Two hosts explore the subject in depth with cited sources. 15-20 min.',
    template: 'Create a deep-dive podcast episode about {topic} for {audience}. Use a conversational format with two hosts exploring the subject in depth, citing sources naturally. Target 15-20 minutes. Include an intro hook, segment transitions, and a closing summary with key takeaways.'
  },
  {
    id: 'executive-briefing',
    name: 'Executive Briefing',
    type: 'report',
    desc: 'One-page summary with key findings, implications, and recommended actions.',
    template: 'Generate an executive briefing about {topic} tailored for {audience}. Structure: Executive Summary (3 bullets), Key Findings, Strategic Implications, Recommended Actions, and Risk Assessment. Keep it under 2 pages. Use professional business language.'
  },
  {
    id: 'explainer-video',
    name: 'Explainer Video',
    type: 'video',
    desc: 'Script with scene descriptions, on-screen text, narrator, and timing cues.',
    template: 'Write an explainer video script about {topic} for {audience}. Include scene descriptions, on-screen text suggestions, narrator voiceover, and timing cues. Structure: Hook (0-5s), Problem (5-20s), Solution (20-50s), How It Works (50-80s), CTA (80-90s).'
  },
  {
    id: 'investor-deck',
    name: 'Investor Deck',
    type: 'slide_deck',
    desc: '10-slide outline: Problem, Market, Solution, Traction, Team, Ask.',
    template: 'Create an investor slide deck outline about {topic} targeting {audience}. Include: Title Slide, Problem Statement, Market Opportunity, Solution Overview, Business Model, Traction, Team, Financials, and Ask. Provide speaker notes for each slide.'
  },
  {
    id: 'mind-map',
    name: 'Knowledge Map',
    type: 'mind_map',
    desc: 'Hierarchical mind map with central concept, 5-7 branches, sub-branches.',
    template: 'Generate a hierarchical mind map about {topic} designed for {audience}. Start with a central concept, branch into 5-7 main categories, each with 3-5 sub-branches. Include connection descriptions and brief explanatory notes for each node.'
  },
  {
    id: 'critique-debate',
    name: 'Critique & Debate',
    type: 'audio',
    desc: 'Balanced two-sided debate with moderator and source citations.',
    template: 'Produce a critique and debate episode about {topic} for {audience}. Present two balanced perspectives with a moderator. Each side gets opening statements (2 min), rebuttals (1 min), and closing arguments (1 min). Include source citations and a neutrality disclaimer.'
  },
  {
    id: 'tutorial',
    name: 'Tutorial Walkthrough',
    type: 'audio',
    desc: 'Step-by-step instructional with prerequisites, time estimates, and recap.',
    template: 'Create a step-by-step tutorial about {topic} aimed at {audience}. Break into 5-8 clear steps. Use encouraging, instructional tone. Include prerequisites, time estimates per step, common pitfalls, and a recap. Assume the listener is following along.'
  },
  {
    id: 'competitive-analysis',
    name: 'Competitive Analysis',
    type: 'report',
    desc: 'Market competitor breakdown with comparison matrix and recommendations.',
    template: 'Write a competitive analysis about {topic} for {audience}. Identify 4-6 key players. For each: Strengths, Weaknesses, Market Position, Strategy, and Threat Level. Include a comparison matrix and strategic recommendations. Use objective, data-driven language.'
  }
];

export const FREE_PREFABS = ['deep-dive', 'executive-briefing'];

export const DEFAULT_SETTINGS = {
  vaultPath: '',
  autoSync: true,
  licenseKey: ''
};

export const STORAGE_KEYS = {
  artifacts: 'plm:artifacts',
  notebooks: 'plm:notebooks',
  settings: 'plm:settings',
  session: 'plm:session',
  token: 'plm:token',
  tokenExpiry: 'plm:tokenExpiry',
  workspaces: 'plm:workspaces',
  activeWorkspace: 'plm:activeWorkspace',
  sourceExports: 'plm:sourceExports',
  sourcesSession: 'plm:sourcesSession'
};

export const MSG_ACTIONS = {
  ARTIFACTS_DISCOVERED: 'artifacts:discovered',
  ARTIFACT_DOWNLOAD: 'artifact:download',
  ARTIFACT_STORE: 'artifact:store',
  ARTIFACT_DELETE: 'artifact:delete',
  VAULT_SYNCED: 'vault:synced',
  PREFAB_INJECT: 'prefab:inject',
  NOTEBOOK_DETECTED: 'notebook:detected',
  GET_STATE: 'get:state',
  SET_STATE: 'set:state',
  SCAN_REQUEST: 'scan:request',
  SHOW_INSPECTOR: 'show:inspector',
  SOURCES_EXTRACT_START: 'sources:extract:start',
  SOURCES_EXTRACT_CANCEL: 'sources:extract:cancel',
  SOURCES_EXTRACT_PROGRESS: 'sources:extract:progress',
  SOURCES_EXTRACT_COMPLETE: 'sources:extract:complete',
  SOURCES_EXTRACT_ERROR: 'sources:extract:error',
  SOURCES_EXPORT_SAVED: 'sources:export:saved',
  SOURCES_GET_NOTEBOOK: 'sources:get:notebook',
  SOURCES_DOWNLOAD_MD: 'sources:download:md',
  SOURCES_DOWNLOAD_ZIP: 'sources:download:zip',
  SOURCES_CLEAR_EXPORTS: 'sources:clear:exports'
};