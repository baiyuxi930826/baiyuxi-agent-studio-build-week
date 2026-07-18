import type { UploadStatus } from '@/hooks/useSendMessage';

export type ImageLifecycleStatus = UploadStatus | 'preparing';

export function deriveImageLifecycleStatus(
  isPreparingImages: boolean,
  uploadStatus: UploadStatus,
): ImageLifecycleStatus {
  if (isPreparingImages) return 'preparing';
  return uploadStatus;
}

export function isImageLifecycleBlockingSend(status: ImageLifecycleStatus): boolean {
  return status === 'preparing' || status === 'uploading';
}
