import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import type { ArtifactJobState, StudyArtifact, StudyMeta, StudyThreadLink } from '@agent-studio/shared';

/**
 * StudyMetaService manages sidecar meta.json files for Signal articles.
 *
 * Layout:
 *   article file: /path/to/library/{source}/{articleId}.md
 *   sidecar dir:  /path/to/library/{source}/{articleId}/
 *   meta file:    /path/to/library/{source}/{articleId}/meta.json
 *   artifacts:    /path/to/library/{source}/{articleId}/notes/
 *                 /path/to/library/{source}/{articleId}/podcasts/
 */

function sidecarDir(articleFilePath: string): string {
  // /foo/bar/article-id.md → /foo/bar/article-id/
  return articleFilePath.replace(/\.md$/, '');
}

function metaPath(articleFilePath: string): string {
  return join(sidecarDir(articleFilePath), 'meta.json');
}

function emptyMeta(articleId: string): StudyMeta {
  return {
    articleId,
    threads: [],
    artifacts: [],
    collections: [],
  };
}

export class StudyMetaService {
  async ensureSidecar(articleFilePath: string): Promise<string> {
    const dir = sidecarDir(articleFilePath);
    await mkdir(dir, { recursive: true });
    return dir;
  }

  async readMeta(articleId: string, articleFilePath: string): Promise<StudyMeta> {
    const path = metaPath(articleFilePath);
    try {
      const raw = await readFile(path, 'utf-8');
      return JSON.parse(raw) as StudyMeta;
    } catch {
      return emptyMeta(articleId);
    }
  }

  async writeMeta(articleFilePath: string, meta: StudyMeta): Promise<void> {
    await this.ensureSidecar(articleFilePath);
    const path = metaPath(articleFilePath);
    await writeFile(path, JSON.stringify(meta, null, 2), 'utf-8');
  }

  async linkThread(
    articleId: string,
    articleFilePath: string,
    link: Omit<StudyThreadLink, 'linkedAt'> & { linkedAt?: string },
  ): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);

    // Dedup by threadId (R22: idempotent)
    if (meta.threads.some((t) => t.threadId === link.threadId)) {
      return meta;
    }

    const fullLink: StudyThreadLink = {
      threadId: link.threadId,
      linkedAt: link.linkedAt ?? new Date().toISOString(),
      linkedBy: link.linkedBy,
    };

    const updated: StudyMeta = {
      ...meta,
      threads: [...meta.threads, fullLink],
      lastStudiedAt: new Date().toISOString(),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  async unlinkThread(articleId: string, articleFilePath: string, threadId: string): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const updated: StudyMeta = {
      ...meta,
      threads: meta.threads.filter((t) => t.threadId !== threadId),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  async addArtifact(articleId: string, articleFilePath: string, artifact: StudyArtifact): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const updated: StudyMeta = {
      ...meta,
      artifacts: [...meta.artifacts, artifact],
      lastStudiedAt: new Date().toISOString(),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  /**
   * Add artifact, replacing any existing artifact with matching kind + mode prefix.
   * E.g. podcast-essence-* replaces previous podcast-essence-*.
   */
  async addOrReplaceArtifact(
    articleId: string,
    articleFilePath: string,
    artifact: StudyArtifact,
    matchPrefix: string,
  ): Promise<{ meta: StudyMeta; replaced: readonly StudyArtifact[] }> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const replaced = meta.artifacts.filter((a) => a.kind === artifact.kind && a.id.startsWith(matchPrefix));
    const filtered = meta.artifacts.filter((a) => !(a.kind === artifact.kind && a.id.startsWith(matchPrefix)));
    const updated: StudyMeta = {
      ...meta,
      artifacts: [...filtered, artifact],
      lastStudiedAt: new Date().toISOString(),
    };
    await this.writeMeta(articleFilePath, updated);
    return { meta: updated, replaced };
  }

  async removeArtifact(articleId: string, articleFilePath: string, artifactId: string): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const updated: StudyMeta = {
      ...meta,
      artifacts: meta.artifacts.filter((a) => a.id !== artifactId),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  async updateArtifactState(
    articleId: string,
    articleFilePath: string,
    artifactId: string,
    state: ArtifactJobState,
    filePath?: string | undefined,
  ): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const updated: StudyMeta = {
      ...meta,
      artifacts: meta.artifacts.map((a) =>
        a.id === artifactId ? { ...a, state, ...(filePath ? { filePath } : {}) } : a,
      ),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  async markThreadStale(articleId: string, articleFilePath: string, threadId: string): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const updated: StudyMeta = {
      ...meta,
      threads: meta.threads.map((t) => (t.threadId === threadId ? { ...t, stale: true } : t)),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  async addCollection(articleId: string, articleFilePath: string, collectionId: string): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    if (meta.collections.includes(collectionId)) return meta;
    const updated: StudyMeta = {
      ...meta,
      collections: [...meta.collections, collectionId],
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  async removeCollection(articleId: string, articleFilePath: string, collectionId: string): Promise<StudyMeta> {
    const meta = await this.readMeta(articleId, articleFilePath);
    const updated: StudyMeta = {
      ...meta,
      collections: meta.collections.filter((c) => c !== collectionId),
    };
    await this.writeMeta(articleFilePath, updated);
    return updated;
  }

  getSidecarDir(articleFilePath: string): string {
    return sidecarDir(articleFilePath);
  }

  async ensureSubDir(articleFilePath: string, subDir: string): Promise<string> {
    const dir = join(sidecarDir(articleFilePath), subDir);
    await mkdir(dir, { recursive: true });
    return dir;
  }
}
