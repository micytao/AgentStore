import { Agent } from "undici";

/**
 * Node's global `fetch` rejects self-signed/untrusted certs by default —
 * this surfaces to the caller as an opaque "fetch failed" TypeError with no
 * indication it was a TLS problem. That's extremely common for exactly the
 * kind of cluster this is likely running against: the kube-apiserver's own
 * cert (api.<cluster>:6443) is very often self-signed even when the
 * cluster's Route/console wildcard cert is real (e.g. Let's Encrypt on
 * workshop clusters) — so "the console loads fine over HTTPS but the API
 * doesn't" is a real, expected split, not a config mistake by itself.
 *
 * When the corresponding "insecure TLS" toggle is on (Admin -> Platform),
 * this returns an undici Agent with cert verification disabled, passed as
 * `dispatcher` on the fetch call. Never enable this against a real
 * production endpoint — it removes MITM protection entirely.
 */
let insecureAgent: Agent | undefined;

function getInsecureAgent(): Agent {
  if (!insecureAgent) {
    insecureAgent = new Agent({ connect: { rejectUnauthorized: false } });
  }
  return insecureAgent;
}

export function dispatcherFor(insecure: boolean): Agent | undefined {
  return insecure ? getInsecureAgent() : undefined;
}
