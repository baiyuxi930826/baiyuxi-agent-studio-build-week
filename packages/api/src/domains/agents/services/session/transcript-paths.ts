import { join } from 'node:path';

export function encodeTranscriptPathSegment(segment: string): string {
  return encodeURIComponent(segment);
}

export function decodeTranscriptPathSegment(segment: string): string {
  try {
    return decodeURIComponent(segment);
  } catch {
    return segment;
  }
}

export function transcriptThreadDir(dataDir: string, threadId: string): string {
  return join(dataDir, 'threads', encodeTranscriptPathSegment(threadId));
}

export function transcriptSessionDir(dataDir: string, threadId: string, agentId: string, sessionId: string): string {
  return join(
    transcriptThreadDir(dataDir, threadId),
    encodeTranscriptPathSegment(agentId),
    'sessions',
    encodeTranscriptPathSegment(sessionId),
  );
}
