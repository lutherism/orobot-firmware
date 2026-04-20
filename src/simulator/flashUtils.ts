/**
 * Flash Manager utilities — pure functions for testing
 */

/** Format bytes to human readable string */
export function formatSize(bytes: number): string {
  const gb = bytes / (1024 * 1024 * 1024);
  if (gb >= 1) return `${gb.toFixed(1)} GB`;
  return `${(bytes / (1024 * 1024)).toFixed(0)} MB`;
}

export type DriveCondition = 'ready' | 'not-ready' | 'not-found';

export interface Drive {
  letter: string;
  name: string;
  size: number;
  free: number;
  condition?: DriveCondition;
  conditionMessage?: string;
}

export interface Distribution {
  id: string;
  type: string;
  label: string;
  description: string;
  imageUrl: string;
  imageSize: number;
  boardIds: string[];
}

export interface FlashState {
  status: 'idle' | 'preparing' | 'flashing' | 'verifying' | 'complete' | 'error';
  progress: number;
  log: string[];
  error?: string;
  drivesFlashing?: string[];
  driveProgress?: Record<string, number>;
  driveStates?: Record<string, DriveFlashState>;
  driveLogs?: Record<string, string>;
}

export interface DriveFlashState {
  status: 'idle' | 'preparing' | 'flashing' | 'verifying' | 'complete' | 'error';
  progress: number;
  error?: string;
}