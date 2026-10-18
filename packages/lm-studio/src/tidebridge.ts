import { execFileSync } from "node:child_process";

export const DEFAULT_TIDEBRIDGE_LM_STUDIO = "http://127.0.0.1:1234/v1";

/**
 * TideBridge's native macOS app (com.tideandtype.TideBridge) stores the
 * LM Studio server under UserDefaults key "server". Share only this
 * non-secret loopback configuration; never read its Keychain pairing token.
 */
export function normalizeTideBridgeServer(value: string): string | undefined {
  try {
    const url = new URL(value.trim());
    if (url.protocol !== "http:" ||
        !["127.0.0.1", "localhost", "[::1]"].includes(url.hostname) ||
        url.username || url.password || url.search || url.hash) return undefined;
    if (url.pathname !== "/" && url.pathname !== "/v1" && url.pathname !== "/v1/") {
      return undefined;
    }
    return url.origin + "/v1";
  } catch {
    return undefined;
  }
}

export type TideBridgeConnection = {
  baseUrl: string;
  source: "tidebridge" | "localhost-default";
  description: string;
};

export function readTideBridgeConnection(options: {
  platform?: string;
  readPreference?: () => string;
} = {}): TideBridgeConnection {
  const platform = options.platform ?? process.platform;
  if (platform === "darwin") {
    try {
      const raw = options.readPreference
        ? options.readPreference()
        : execFileSync("/usr/bin/defaults", [
            "read", "com.tideandtype.TideBridge", "server"
          ], { encoding: "utf8", timeout: 2000 });
      const baseUrl = normalizeTideBridgeServer(raw);
      if (baseUrl) {
        return {
          baseUrl,
          source: "tidebridge",
          description: "Using TideBridge's saved local LM Studio address."
        };
      }
    } catch {
      // Missing TideBridge preferences is not a reason to use a public tunnel.
    }
  }
  return {
    baseUrl: DEFAULT_TIDEBRIDGE_LM_STUDIO,
    source: "localhost-default",
    description: "TideBridge preferences were not found; using local LM Studio on port 1234."
  };
}
