import type { SignalSource } from '@agent-studio/shared';

/**
 * Academic paper sources: arXiv feeds + HuggingFace daily papers.
 */
export const PAPER_SOURCES: readonly SignalSource[] = [
  {
    id: 'arxiv-cs-cl',
    name: 'arXiv cs.CL',
    url: 'https://export.arxiv.org/rss/cs.CL',
    tier: 1,
    category: 'papers',
    enabled: true,
    fetch: { method: 'rss' },
    schedule: { frequency: 'daily' },
    filters: {
      keywords: {
        include: ['agent', 'llm', 'context', 'tool', 'mcp', 'rag'],
      },
    },
  },
  {
    id: 'arxiv-cs-ai',
    name: 'arXiv cs.AI',
    url: 'https://export.arxiv.org/rss/cs.AI',
    tier: 1,
    category: 'papers',
    enabled: true,
    fetch: { method: 'rss' },
    schedule: { frequency: 'manual' },
    filters: {
      keywords: {
        include: ['agent', 'llm', 'reasoning', 'planning', 'tool use', 'mcp'],
      },
    },
  },
  {
    id: 'arxiv-cs-lg',
    name: 'arXiv cs.LG',
    url: 'https://export.arxiv.org/rss/cs.LG',
    tier: 1,
    category: 'papers',
    enabled: true,
    fetch: { method: 'rss' },
    schedule: { frequency: 'manual' },
    filters: {
      keywords: {
        include: ['transformer', 'llm', 'language model', 'fine-tuning', 'rlhf', 'alignment'],
      },
    },
  },
  {
    id: 'huggingface-papers',
    name: 'HuggingFace Papers',
    url: 'https://huggingface.co/papers',
    tier: 2,
    category: 'papers',
    enabled: true,
    fetch: { method: 'webpage', selector: 'article, a[href*="/papers/"]' },
    schedule: { frequency: 'manual' },
  },
];
