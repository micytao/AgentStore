/**
 * Singleton OpenShell SDK client. Connects lazily on first use and reuses the
 * same gRPC transport for all sandbox/provider operations.
 *
 * Auth mode is driven by environment:
 *  - All three OIDC vars set → renewable client-credentials grant (production).
 *  - None set → unauthenticated h2c connection (eval gateway with TLS off).
 */

import { OpenShellClient, clientCredentials } from "@nvidia/openshell-sdk";
import {
  gatewayUrl,
  oidcClientId,
  oidcClientSecret,
  oidcIssuer,
} from "./config.js";

let clientPromise: Promise<OpenShellClient> | undefined;

function buildClient(): Promise<OpenShellClient> {
  const issuer = oidcIssuer();
  const clientId = oidcClientId();
  const secret = oidcClientSecret();

  const useOidc = !!(issuer && clientId && secret);
  if (useOidc) {
    console.log("[openshell] connecting to gateway with OIDC client-credentials");
  } else {
    console.log("[openshell] connecting to gateway without auth (eval mode)");
  }

  return OpenShellClient.connect({
    gateway: gatewayUrl(),
    ...(useOidc
      ? {
          oidcTokenProvider: clientCredentials({
            issuer: issuer!,
            clientId: clientId!,
            clientSecret: secret!,
          }),
          allowInsecureAuth: true,
        }
      : {}),
  });
}

/** Returns the shared OpenShellClient, creating it on first call. */
export function getClient(): Promise<OpenShellClient> {
  if (!clientPromise) {
    clientPromise = buildClient();
  }
  return clientPromise;
}
