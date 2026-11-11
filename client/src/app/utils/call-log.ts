export interface CallLogPayload {
  callType: 'video' | 'audio';
  status: 'completed' | 'missed' | 'offline' | 'cancelled';
  durationSeconds: number;
  endedAt: string;
}

const CALL_LOG_PREFIX = '__CALL_LOG__:';

/** Serializes a call log entry into a chat message content payload. */
export function encodeCallLog(payload: CallLogPayload): string {
  return `${CALL_LOG_PREFIX}${JSON.stringify(payload)}`;
}

/** Parses a chat message's content into a structured call log if it matches the call-log format. */
export function parseCallLog(content?: string | null): CallLogPayload | null {
  if (!content || !content.startsWith(CALL_LOG_PREFIX)) {
    return null;
  }

  try {
    const parsed = JSON.parse(content.slice(CALL_LOG_PREFIX.length)) as Partial<CallLogPayload>;
    if (!parsed || typeof parsed !== 'object') {
      return null;
    }

    const duration =
      typeof parsed.durationSeconds === 'number' && Number.isFinite(parsed.durationSeconds)
        ? Math.max(0, Math.floor(parsed.durationSeconds))
        : 0;

    return {
      callType: parsed.callType === 'audio' ? 'audio' : 'video',
      status:
        parsed.status === 'completed' ||
        parsed.status === 'missed' ||
        parsed.status === 'offline' ||
        parsed.status === 'cancelled'
          ? parsed.status
          : 'completed',
      durationSeconds: duration,
      endedAt: typeof parsed.endedAt === 'string' && parsed.endedAt ? parsed.endedAt : '',
    };
  } catch {
    return null;
  }
}

/** Formats call duration in seconds as HH:MM:SS. */
export function formatCallDuration(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hrs = String(Math.floor(safe / 3600)).padStart(2, '0');
  const mins = String(Math.floor((safe % 3600) / 60)).padStart(2, '0');
  const secs = String(safe % 60).padStart(2, '0');
  return `${hrs}:${mins}:${secs}`;
}

/** Produces a concise notification preview string for a call log entry. */
export function formatCallLogSummary(log: CallLogPayload): string {
  const label = log.callType === 'audio' ? 'Audio call' : 'Video call';
  if (log.status === 'offline') {
    return `${label} (Offline)`;
  }
  if (log.status === 'missed' || log.status === 'cancelled') {
    return `${label} • ${formatCallDuration(log.durationSeconds)}`;
  }
  return `${label} • ${formatCallDuration(log.durationSeconds)}`;
}
