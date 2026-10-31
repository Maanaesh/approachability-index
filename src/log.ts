// Only these fields may be logged. Scores and raw metrics have no slot here by design.
export type LogFields = { slackUserId: string; provider?: string; bandKey?: string; outcome?: string; reason?: string };

export type Logger = { info(event: string, fields: LogFields): void };

export function createLogger(write: (line: string) => void = (l) => process.stdout.write(`${l}\n`)): Logger {
  return {
    info(event, f) {
      write(JSON.stringify({
        at: new Date().toISOString(),
        event,
        slackUserId: f.slackUserId,
        provider: f.provider,
        bandKey: f.bandKey,
        outcome: f.outcome,
        reason: f.reason,
      }));
    },
  };
}
