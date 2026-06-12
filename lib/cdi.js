const CITATION_PATTERN = /\[\d+\]|source|cite|according to|research|study/gi;

function computeCdi(text) {
  const prompt = String(text || '');
  const citationMatches = prompt.match(CITATION_PATTERN) || [];
  const words = prompt.split(/\s+/).filter(Boolean);
  const paragraphs = prompt.split(/\n\n+/).filter((p) => p.trim().length > 0);
  const cdi = Math.min(
    100,
    Math.round((citationMatches.length / Math.max(prompt.length / 100, 1)) * 10),
  );

  return {
    cdi,
    wordCount: words.length,
    paragraphCount: paragraphs.length,
    citationHits: citationMatches.length,
  };
}

function inspectArtifact(artifact) {
  if (!artifact) return null;
  const prompt = artifact.prompt || artifact.title || '';
  const metrics = computeCdi(prompt);
  return { ...artifact, ...metrics };
}

module.exports = { computeCdi, inspectArtifact, CITATION_PATTERN };