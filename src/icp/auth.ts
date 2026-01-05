// src/icp/auth.ts
import { AuthClient } from "@dfinity/auth-client";
import { HttpAgent } from "@dfinity/agent";

export const II_LEGACY = "https://identity.ic0.app"; // legacy
export const II_2 = "https://id.ai";                 // II 2.0

let _authClient: AuthClient | null = null;

export async function getAuthClient(): Promise<AuthClient> {
  if (_authClient) return _authClient;
  _authClient = await AuthClient.create();
  return _authClient;
}

export async function login(identityProvider: string): Promise<void> {
  const auth = await getAuthClient();
  await new Promise<void>((resolve, reject) => {
    auth.login({
      identityProvider,
      onSuccess: () => resolve(),
      onError: (err) => reject(err),
      // windowOpenerFeatures: "toolbar=0,location=0,menubar=0,width=500,height=700,left=100,top=100",
    });
  });
}

export async function logout(): Promise<void> {
  const auth = await getAuthClient();
  await auth.logout();
}

export async function isAuthed(): Promise<boolean> {
  const auth = await getAuthClient();
  return auth.isAuthenticated();
}

export async function getAgent(): Promise<HttpAgent> {
  const auth = await getAuthClient();
  const identity = auth.getIdentity();
  const agent = new HttpAgent({
    identity,
    host: "https://icp-api.io", // public boundary node
  });
  return agent;
}

export async function getPrincipalText(): Promise<string> {
  const auth = await getAuthClient();
  return auth.getIdentity().getPrincipal().toText();
}


export async function getIdentity() {
  const auth = await getAuthClient();
  return auth.getIdentity();
}
