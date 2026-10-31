export interface OutboundLogEntry {
  host: string;
  url: string;
  reason: string;
  timestamp: string;
  isLocal: boolean;
}

class OutboundWatcher {
  private currentTurnId = 0;
  private turnLogs = new Map<number, OutboundLogEntry[]>();
  private clientResourceHosts: string[] = [];

  public startTurn(): number {
    this.currentTurnId += 1;
    this.turnLogs.set(this.currentTurnId, []);
    // Prune older turns beyond last 10
    if (this.turnLogs.size > 10) {
      const oldest = Math.min(...Array.from(this.turnLogs.keys()));
      this.turnLogs.delete(oldest);
    }
    return this.currentTurnId;
  }

  public logConnection(urlOrHost: string, reason: string, turnId?: number): void {
    const targetTurn = turnId ?? this.currentTurnId;
    let host = urlOrHost;
    try {
      const parsed = new URL(urlOrHost);
      host = parsed.hostname;
    } catch {
      host = urlOrHost.split('/')[0].split(':')[0];
    }

    const isLocal =
      host === 'localhost' ||
      host === '127.0.0.1' ||
      host === '::1' ||
      host === '0.0.0.0';

    const list = this.turnLogs.get(targetTurn) ?? [];
    list.push({
      host,
      url: urlOrHost,
      reason,
      timestamp: new Date().toISOString(),
      isLocal
    });
    this.turnLogs.set(targetTurn, list);
  }

  public recordBrowserResources(urls: string[]): void {
    const hosts: string[] = [];
    for (const u of urls) {
      try {
        const parsed = new URL(u);
        hosts.push(parsed.hostname);
      } catch {
        // Ignore relative entries
      }
    }
    this.clientResourceHosts = Array.from(new Set(hosts));
  }

  public getLastTurnReport(turnId?: number): {
    turnId: number;
    serverConnections: OutboundLogEntry[];
    browserHosts: string[];
    externalHosts: string[];
  } {
    const id = turnId ?? this.currentTurnId;
    const serverConnections = this.turnLogs.get(id) ?? [];
    const externalServerHosts = serverConnections
      .filter((c) => !c.isLocal)
      .map((c) => c.host);

    const externalBrowserHosts = this.clientResourceHosts.filter(
      (h) =>
        h !== 'localhost' &&
        h !== '127.0.0.1' &&
        !h.endsWith('.run.app') // App's own origin when previewed in AI Studio
    );

    const externalHosts = Array.from(new Set([...externalServerHosts, ...externalBrowserHosts]));

    return {
      turnId: id,
      serverConnections,
      browserHosts: this.clientResourceHosts,
      externalHosts
    };
  }
}

export const outboundWatcher = new OutboundWatcher();
