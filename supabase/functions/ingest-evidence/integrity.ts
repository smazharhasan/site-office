// Google Play Integrity (Standard request) verification.
// Configure secrets:
//   PLAY_INTEGRITY_PACKAGE   e.g. pk.siteoffice.app
//   PLAY_INTEGRITY_SA_JSON   service-account JSON with the Play Integrity API enabled
// The app passes requestHash = SHA-256 of the photo, so a token can't be
// replayed for a different picture.
import { importPKCS8, SignJWT } from "npm:jose@5.9.6";

async function googleAccessToken(sa: { client_email: string; private_key: string }): Promise<string> {
  const key = await importPKCS8(sa.private_key, "RS256");
  const now = Math.floor(Date.now() / 1000);
  const assertion = await new SignJWT({ scope: "https://www.googleapis.com/auth/playintegrity" })
    .setProtectedHeader({ alg: "RS256", typ: "JWT" })
    .setIssuer(sa.client_email).setAudience("https://oauth2.googleapis.com/token")
    .setIssuedAt(now).setExpirationTime(now + 3600).sign(key);
  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "urn:ietf:params:oauth:grant-type:jwt-bearer", assertion }),
  });
  if (!res.ok) throw new Error("Google token exchange failed");
  return (await res.json()).access_token;
}

export async function verifyPlayIntegrity(token: string, requestHash: string): Promise<"ok" | "failed" | "not_checked"> {
  const pkg = Deno.env.get("PLAY_INTEGRITY_PACKAGE"); const saJson = Deno.env.get("PLAY_INTEGRITY_SA_JSON");
  if (!pkg || !saJson) return "not_checked";
  try {
    const access = await googleAccessToken(JSON.parse(saJson));
    const res = await fetch(`https://playintegrity.googleapis.com/v1/${pkg}:decodeIntegrityToken`, {
      method: "POST", headers: { authorization: `Bearer ${access}`, "content-type": "application/json" },
      body: JSON.stringify({ integrity_token: token }),
    });
    if (!res.ok) return "failed";
    const p = (await res.json()).tokenPayloadExternal || {};
    const appOk = p.appIntegrity?.appRecognitionVerdict === "PLAY_RECOGNIZED" && p.appIntegrity?.packageName === pkg;
    const devOk = (p.deviceIntegrity?.deviceRecognitionVerdict || []).includes("MEETS_DEVICE_INTEGRITY");
    const hashOk = p.requestDetails?.requestHash === requestHash;
    const fresh = Math.abs(Date.now() - Number(p.requestDetails?.timestampMillis || 0)) < 10 * 60 * 1000;
    return appOk && devOk && hashOk && fresh ? "ok" : "failed";
  } catch {
    return "failed";
  }
}
