import type { SignalSource } from '@agent-studio/shared';

/**
 * Tier 1 China AI labs: DeepSeek, Qwen, Moonshot, Zhipu, ByteDance.
 * Includes GitHub API sources for repos tracking.
 */
export const TIER1_CHINA_SOURCES: readonly SignalSource[] = [
  // ── 国内厂商 ──────────────────────────────────────────────────
  {
    id: 'deepseek-api-news',
    name: 'DeepSeek API News',
    url: 'https://api-docs.deepseek.com/news',
    tier: 1,
    category: 'official',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .news-item, main a' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'qwen-blog',
    name: 'Qwen Blog',
    url: 'https://qwenlm.github.io/blog/',
    tier: 1,
    category: 'official',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .post-card, a[href*="/blog/"]' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'moonshot-docs',
    name: 'Moonshot Docs',
    url: 'https://platform.moonshot.ai/docs/overview',
    tier: 1,
    category: 'official',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, main' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'zhipu-report',
    name: '智谱技术报告',
    url: 'https://bigmodel.cn/technology-report',
    tier: 1,
    category: 'research',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .report-card' },
    schedule: { frequency: 'manual' },
  },
  {
    id: 'bytedance-seed-blog',
    name: '字节 Seed Blog',
    url: 'https://seed.bytedance.com/blog',
    tier: 1,
    category: 'official',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, .blog-card' },
    schedule: { frequency: 'manual' },
  },

  // ── 国内厂商 GitHub (API fetcher) ─────────────────────────────
  {
    id: 'deepseek-github',
    name: 'DeepSeek GitHub Repos',
    url: 'https://api.github.com/orgs/deepseek-ai/repos?sort=updated&per_page=10',
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
    id: 'qwen-github',
    name: 'Qwen GitHub Repos',
    url: 'https://api.github.com/orgs/QwenLM/repos?sort=updated&per_page=10',
    tier: 1,
    category: 'engineering',
    enabled: true,
    fetch: {
      method: 'api',
      headers: { Accept: 'application/vnd.github.v3+json' },
    },
    schedule: { frequency: 'manual' },
  },
];
