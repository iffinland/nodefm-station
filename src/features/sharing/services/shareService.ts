/* ============================================================
 * NodeFM Station — Sharing Service
 *
 * Canonical QDN share targets and clipboard copy. Sharing uses
 * QDN `qdn://` resource addresses, not invented external URLs.
 *
 * Clipboard fallback is adapted from the current qortium-boards
 * reference implementation.
 * ============================================================ */

import {
  buildQdnUrl,
  getCurrentQdnAppIdentity,
  type QdnHostGlobals,
} from '../../../qortium/navigation';

export type ShareKind = 'app' | 'playlist';

export type ShareTargetInput =
  | { kind: 'app' }
  | {
      kind: 'playlist';
      playlistId: string;
    };

type ClipboardDependencies = {
  navigator?: {
    clipboard?: {
      writeText?: (text: string) => Promise<void> | void;
    };
  };
  document?: Pick<Document, 'body' | 'createElement' | 'execCommand'>;
};

export function buildAppShareTarget(host: QdnHostGlobals | null = null): string {
  const identity = getCurrentQdnAppIdentity(
    host ?? (typeof window === 'undefined' ? null : (window as Window & QdnHostGlobals)),
  );

  return buildQdnUrl(identity);
}

export function buildPlaylistShareTarget(
  playlistId: string,
  host: QdnHostGlobals | null = null,
): string {
  if (!playlistId.trim()) {
    throw new Error('Playlist ID is required to share a playlist.');
  }

  const appIdentity = getCurrentQdnAppIdentity(
    host ?? (typeof window === 'undefined' ? null : (window as Window & QdnHostGlobals)),
  );
  const base = buildQdnUrl(appIdentity);

  return `${base}/playlists/${encodeURIComponent(playlistId.trim())}`;
}

export function buildShareTarget(
  input: ShareTargetInput,
  host: QdnHostGlobals | null = null,
): string {
  if (input.kind === 'app') {
    return buildAppShareTarget(host);
  }

  return buildPlaylistShareTarget(input.playlistId, host);
}

function copyWithTextarea(text: string, documentRef: ClipboardDependencies['document']): boolean {
  if (!documentRef?.body || !documentRef.createElement || !documentRef.execCommand) {
    return false;
  }

  const textarea = documentRef.createElement('textarea');
  textarea.value = text;
  textarea.setAttribute('readonly', '');
  textarea.style.left = '-9999px';
  textarea.style.opacity = '0';
  textarea.style.position = 'fixed';
  textarea.style.top = '0';
  documentRef.body.appendChild(textarea);

  try {
    textarea.focus();
    textarea.select();
    textarea.setSelectionRange(0, textarea.value.length);
    return documentRef.execCommand('copy');
  } catch {
    return false;
  } finally {
    documentRef.body.removeChild(textarea);
  }
}

export async function copyShareTarget(
  text: string,
  dependencies: ClipboardDependencies = globalThis as ClipboardDependencies,
): Promise<boolean> {
  const writeText = dependencies.navigator?.clipboard?.writeText;

  if (writeText) {
    try {
      await writeText.call(dependencies.navigator?.clipboard, text);
      return true;
    } catch {
      // Sandboxed QDN views may reject the modern Clipboard API. Fall through.
    }
  }

  return copyWithTextarea(text, dependencies.document);
}

export function getShareTargetLabel(target: ShareTargetInput): string {
  return target.kind === 'app' ? 'NodeFM app' : 'Playlist';
}
