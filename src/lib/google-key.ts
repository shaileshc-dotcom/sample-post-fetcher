/**
 * Normalize a service-account private key from an env var into valid PEM,
 * tolerating every common way it gets mangled in dashboards (Vercel etc.):
 *  - wrapped in single/double quotes
 *  - literal "\n" sequences instead of real newlines
 *  - Windows CRLF
 *  - the whole PEM base64-encoded (an escape hatch to avoid newline issues)
 */
export function normalizePrivateKey(raw: string | undefined): string {
  let key = (raw || "").trim();
  if (!key) return "";

  // Strip a single pair of surrounding quotes if present.
  if ((key.startsWith('"') && key.endsWith('"')) || (key.startsWith("'") && key.endsWith("'"))) {
    key = key.slice(1, -1);
  }

  // Turn literal \n (and \r\n) into real newlines; normalize CRLF.
  key = key.replace(/\\r\\n/g, "\n").replace(/\\n/g, "\n").replace(/\r\n/g, "\n").replace(/\r/g, "\n");

  // If it's not already PEM, it may be base64 of the whole PEM — try decoding.
  if (!key.includes("BEGIN PRIVATE KEY") && /^[A-Za-z0-9+/=\s]+$/.test(key)) {
    try {
      const decoded = Buffer.from(key.replace(/\s+/g, ""), "base64").toString("utf8");
      if (decoded.includes("BEGIN PRIVATE KEY")) key = decoded;
    } catch { /* ignore */ }
  }

  // Ensure a trailing newline (some parsers require it).
  if (!key.endsWith("\n")) key += "\n";
  return key;
}
