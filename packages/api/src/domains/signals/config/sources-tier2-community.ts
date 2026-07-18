import type { SignalSource } from '@agent-studio/shared';

/**
 * Tier 2-3 sources: open-source frameworks, tech bloggers,
 * VC/industry analysis, and community aggregators.
 */
export const TIER2_COMMUNITY_SOURCES: readonly SignalSource[] = [
  // ── Open-source frameworks & tools ────────────────────────────
  {
    id: 'langchain-blog-rss',
    name: 'LangChain Blog',
    url: 'https://blog.langchain.dev/rss/',
    tier: 2,
    category: 'engineering',
    enabled: true,
    fetch: { method: 'rss' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'github-trending',
    name: 'GitHub Trending',
    url: 'https://github.com/trending',
    tier: 2,
    category: 'community',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article.Box-row, .Box-row' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'vllm-github',
    name: 'vLLM GitHub Releases',
    url: 'https://api.github.com/repos/vllm-project/vllm/releases?per_page=5',
    tier: 1,
    category: 'engineering',
    enabled: true,
    fetch: {
      method: 'api',
      headers: { Accept: 'application/vnd.github.v3+json' },
    },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'llamacpp-github',
    name: 'llama.cpp GitHub Releases',
    url: 'https://api.github.com/repos/ggerganov/llama.cpp/releases?per_page=5',
    tier: 1,
    category: 'engineering',
    enabled: true,
    fetch: {
      method: 'api',
      headers: { Accept: 'application/vnd.github.v3+json' },
    },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'ollama-github',
    name: 'Ollama GitHub Releases',
    url: 'https://api.github.com/repos/ollama/ollama/releases?per_page=5',
    tier: 2,
    category: 'engineering',
    enabled: true,
    fetch: {
      method: 'api',
      headers: { Accept: 'application/vnd.github.v3+json' },
    },
    schedule: { frequency: 'manual' },
  },

  // ── Tech bloggers ─────────────────────────────────────────────
  {
    id: 'simon-willison',
    name: 'Simon Willison',
    url: 'https://simonwillison.net/',
    tier: 2,
    category: 'community',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .entry, .day .entry' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'lilian-weng',
    name: "Lilian Weng (Lil'Log)",
    url: 'https://lilianweng.github.io/',
    tier: 2,
    category: 'community',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .post-link' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'chip-huyen',
    name: 'Chip Huyen',
    url: 'https://huyenchip.com/',
    tier: 3,
    category: 'community',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .post' },
    schedule: { frequency: 'manual' },
  },

  // ── VC / industry analysis ────────────────────────────────────
  {
    id: 'latent-space-rss',
    name: 'Latent Space',
    url: 'https://www.latent.space/feed',
    tier: 3,
    category: 'community',
    enabled: true,
    fetch: { method: 'rss' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'a16z-ai',
    name: 'a16z AI',
    url: 'https://a16z.com/ai/',
    tier: 3,
    category: 'community',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .post-card' },
    schedule: { frequency: 'manual' },
  },

  // ── Community aggregators ─────────────────────────────────────
  {
    id: 'hacker-news-rss',
    name: 'Hacker News',
    url: 'https://news.ycombinator.com/rss',
    tier: 3,
    category: 'community',
    enabled: true,
    fetch: { method: 'rss' },
    schedule: { frequency: 'manual' },
    filters: {
      keywords: {
        include: ['ai', 'llm', 'gpt', 'claude', 'gemini', 'agent', 'transformer', 'machine learning'],
      },
    },
  },
];
