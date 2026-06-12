const fs = require('fs');
const path = require('path');

const PREFABS_PATH = path.join(__dirname, '..', 'public', 'prefabs.json');

const CANONICAL_IDS = [
  'deep-dive',
  'executive-briefing',
  'explainer-video',
  'investor-deck',
  'mind-map',
  'critique-debate',
  'tutorial',
  'competitive-analysis',
];

const VALID_TYPES = new Set(['audio', 'video', 'slide_deck', 'mind_map', 'report']);

function getEmbeddedFallback() {
  return [
    { id: 'deep-dive', name: 'Deep-Dive Podcast', type: 'audio', icon: 'fa-microphone', description: 'Long-form conversational deep-dive', template: 'Create a deep-dive podcast episode about {topic} for {audience}. Use a conversational format with two hosts exploring the subject in depth, citing sources naturally. Target 15-20 minutes. Include an intro hook, segment transitions, and a closing summary with key takeaways.' },
    { id: 'executive-briefing', name: 'Executive Briefing', type: 'report', icon: 'fa-chart-bar', description: 'Concise executive summary report', template: 'Generate an executive briefing about {topic} tailored for {audience}. Structure: Executive Summary (3 bullets), Key Findings, Strategic Implications, Recommended Actions, and Risk Assessment. Keep it under 2 pages. Use professional business language.' },
    { id: 'explainer-video', name: 'Explainer Video', type: 'video', icon: 'fa-video', description: 'Educational video script with visuals', template: 'Write an explainer video script about {topic} for {audience}. Include scene descriptions, on-screen text suggestions, narrator voiceover, and timing cues. Structure: Hook (0-5s), Problem (5-20s), Solution (20-50s), How It Works (50-80s), CTA (80-90s).' },
    { id: 'investor-deck', name: 'Investor Slide Deck', type: 'slide_deck', icon: 'fa-file-powerpoint', description: 'Pitch deck for stakeholders', template: 'Create an investor slide deck outline about {topic} targeting {audience}. Include: Title Slide, Problem Statement, Market Opportunity, Solution Overview, Business Model, Traction, Team, Financials, and Ask. Provide speaker notes for each slide.' },
    { id: 'mind-map', name: 'Knowledge Mind Map', type: 'mind_map', icon: 'fa-brain', description: 'Hierarchical knowledge structure', template: 'Generate a hierarchical mind map about {topic} designed for {audience}. Start with a central concept, branch into 5-7 main categories, each with 3-5 sub-branches. Include connection descriptions and brief explanatory notes for each node.' },
    { id: 'critique-debate', name: 'Critique & Debate', type: 'audio', icon: 'fa-balance-scale', description: 'Balanced argument analysis', template: 'Produce a critique and debate episode about {topic} for {audience}. Present two balanced perspectives with a moderator. Each side gets opening statements (2 min), rebuttals (1 min), and closing arguments (1 min). Include source citations and a neutrality disclaimer.' },
    { id: 'tutorial', name: 'Tutorial Walkthrough', type: 'audio', icon: 'fa-graduation-cap', description: 'Step-by-step instructional', template: 'Create a step-by-step tutorial about {topic} aimed at {audience}. Break into 5-8 clear steps. Use encouraging, instructional tone. Include prerequisites, time estimates per step, common pitfalls, and a recap. Assume the listener is following along.' },
    { id: 'competitive-analysis', name: 'Competitive Analysis', type: 'report', icon: 'fa-search', description: 'Market competitor breakdown', template: 'Write a competitive analysis about {topic} for {audience}. Identify 4-6 key players. For each: Strengths, Weaknesses, Market Position, Strategy, and Threat Level. Include a comparison matrix and strategic recommendations. Use objective, data-driven language.' },
  ];
}

function loadPrefabs() {
  try {
    if (fs.existsSync(PREFABS_PATH)) {
      const parsed = JSON.parse(fs.readFileSync(PREFABS_PATH, 'utf8'));
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    }
  } catch (e) {
    // fall through to embedded fallback
  }
  return getEmbeddedFallback();
}

function validatePrefabs(prefabs) {
  const errors = [];
  if (!Array.isArray(prefabs)) {
    return { valid: false, errors: ['Prefabs must be an array'] };
  }
  const ids = new Set();
  for (const p of prefabs) {
    if (!p.id) errors.push('Prefab missing id');
    if (ids.has(p.id)) errors.push(`Duplicate prefab id: ${p.id}`);
    ids.add(p.id);
    if (!VALID_TYPES.has(p.type)) errors.push(`Invalid type for ${p.id}: ${p.type}`);
    if (!p.template || !p.template.includes('{topic}') || !p.template.includes('{audience}')) {
      errors.push(`Template for ${p.id} must include {topic} and {audience}`);
    }
  }
  for (const id of CANONICAL_IDS) {
    if (!ids.has(id)) errors.push(`Missing canonical prefab: ${id}`);
  }
  return { valid: errors.length === 0, errors };
}

function renderPrefabPrompt(prefab, topic, audience) {
  return String(prefab.template || '')
    .replace(/\{topic\}/g, topic)
    .replace(/\{audience\}/g, audience);
}

module.exports = {
  PREFABS_PATH,
  CANONICAL_IDS,
  VALID_TYPES,
  loadPrefabs,
  getEmbeddedFallback,
  validatePrefabs,
  renderPrefabPrompt,
};