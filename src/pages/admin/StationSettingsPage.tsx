/* ============================================================
 * NodeFM Station — Station Settings Page (Admin)
 *
 * Creates/edits the canonical Station config and selects the
 * default-rotation playlist version plus station epoch.
 * ============================================================ */

import { useCallback, useEffect, useMemo, useState } from 'react';
import { PageShell } from '../../components/PageShell';
import { LoadingState } from '../../components/LoadingState';
import { ErrorState } from '../../components/ErrorState';
import { QdnTransactionFlow } from '../../components/QdnTransactionFlow';
import {
  createQdnTransactionState,
  markQdnTransactionChunkActive,
  type QdnTransactionState,
} from '../../components/qdnTransactionFlow';
import { useStation } from '../../features/station';
import { usePlaylists } from '../../hooks/usePlaylists';
import { NoticeAdminPanel } from '../../features/notices/components';
import type { StationMusicScope } from '../../types/domain';

function toLocalDateTimeInputValue(utcIso: string): string {
  const date = new Date(utcIso);
  if (Number.isNaN(date.getTime())) return '';

  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

export default function StationSettingsPage() {
  const { station, loaded, loading, error, saveStation, refresh } = useStation();
  const {
    playlists,
    loaded: playlistsLoaded,
    loading: playlistsLoading,
    error: playlistsError,
    getVersions,
    refresh: refreshPlaylists,
  } = usePlaylists();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [timezone, setTimezone] = useState('Europe/Helsinki');
  const [playlistId, setPlaylistId] = useState('');
  const [versionId, setVersionId] = useState('');
  const [epochLocalInput, setEpochLocalInput] = useState('');
  const [messagingEnabled, setMessagingEnabled] = useState(false);
  const [tipsEnabled, setTipsEnabled] = useState(false);
  const [musicScope, setMusicScope] = useState<StationMusicScope | ''>('');
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [transaction, setTransaction] = useState<QdnTransactionState | null>(null);
  const [initialized, setInitialized] = useState(false);

  const versions = useMemo(
    () => (playlistId ? getVersions(playlistId) : []),
    [getVersions, playlistId],
  );

  useEffect(() => {
    if (initialized || !playlistsLoaded || !loaded) return;

    const preferredPlaylist =
      station?.defaultRotationPlaylistId &&
      playlists.some((playlist) => playlist.playlistId === station.defaultRotationPlaylistId)
        ? station.defaultRotationPlaylistId
        : (playlists.find((playlist) => playlist.latestVersionId)?.playlistId ?? '');

    const preferredVersions = preferredPlaylist ? getVersions(preferredPlaylist) : [];
    const preferredVersion =
      station?.defaultRotationPlaylistVersionId &&
      preferredVersions.some(
        (version) => version.versionId === station.defaultRotationPlaylistVersionId,
      )
        ? station.defaultRotationPlaylistVersionId
        : (preferredVersions[preferredVersions.length - 1]?.versionId ?? '');

    setName(station?.name ?? '');
    setDescription(station?.description ?? '');
    setTimezone(station?.timezone ?? 'Europe/Helsinki');
    setPlaylistId(preferredPlaylist);
    setVersionId(preferredVersion);
    setEpochLocalInput(
      station
        ? toLocalDateTimeInputValue(station.stationEpochUtc)
        : toLocalDateTimeInputValue(new Date().toISOString()),
    );
    setMessagingEnabled(station?.messagingEnabled ?? false);
    setTipsEnabled(station?.tipsEnabled ?? false);
    setMusicScope(station?.musicScope ?? '');
    setInitialized(true);
  }, [getVersions, initialized, loaded, playlists, playlistsLoaded, station]);

  const handleSave = useCallback(async () => {
    if (!name.trim() || !timezone.trim() || !playlistId || !versionId || !epochLocalInput) {
      setSaveError('Station name, timezone, default playlist, version, and epoch are required.');
      return;
    }

    const epochDate = new Date(epochLocalInput);
    if (Number.isNaN(epochDate.getTime())) {
      setSaveError('Station epoch is not a valid date/time.');
      return;
    }

    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);
    setTransaction(
      createQdnTransactionState(
        [
          {
            id: 'station',
            label: station ? 'Save station configuration' : 'Publish station configuration',
          },
        ],
        { retryable: true },
      ),
    );
    setTransaction((current) =>
      current ? markQdnTransactionChunkActive(current, 'station') : current,
    );

    try {
      await saveStation({
        name: name.trim(),
        description: description.trim() || undefined,
        timezone: timezone.trim(),
        defaultRotationPlaylistId: playlistId,
        defaultRotationPlaylistVersionId: versionId,
        stationEpochUtc: epochDate.toISOString(),
        messagingEnabled,
        tipsEnabled,
        musicScope: musicScope || undefined,
      });
      setSaveSuccess(true);
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) => ({ ...item, status: 'succeeded' as const })),
              phase: 'success' as const,
              successMessage: 'Station configuration saved.',
              retryable: false,
            }
          : current,
      );
    } catch (err) {
      setSaveError(err instanceof Error ? err.message : 'Failed to save station configuration.');
      setTransaction((current) =>
        current
          ? {
              ...current,
              chunks: current.chunks.map((item) =>
                item.status === 'active' ? { ...item, status: 'failed' as const } : item,
              ),
              phase: 'failed' as const,
              error: err instanceof Error ? err.message : 'Failed to save station configuration.',
              retryable: true,
            }
          : current,
      );
    } finally {
      setSaving(false);
    }
  }, [
    name,
    description,
    timezone,
    playlistId,
    versionId,
    epochLocalInput,
    messagingEnabled,
    tipsEnabled,
    musicScope,
    saveStation,
    station,
  ]);

  if (loading || playlistsLoading) {
    return (
      <PageShell title="Station Settings">
        <LoadingState message="Loading station settings…" />
      </PageShell>
    );
  }

  if (error && !loaded) {
    return (
      <PageShell title="Station Settings">
        <ErrorState
          message="Failed to load station configuration."
          detail={error}
          onRetry={refresh}
        />
      </PageShell>
    );
  }

  if (playlistsError && !playlistsLoaded) {
    return (
      <PageShell title="Station Settings">
        <ErrorState
          message="Failed to load playlists."
          detail={playlistsError}
          onRetry={refreshPlaylists}
        />
      </PageShell>
    );
  }

  return (
    <PageShell title="Station Settings">
      <div className="admin-station-settings">
        <div className="admin-station-settings__form">
          <label className="form-field">
            Station name
            <input type="text" value={name} onChange={(event) => setName(event.target.value)} />
          </label>

          <label className="form-field">
            Description
            <textarea
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              rows={2}
            />
          </label>

          <label className="form-field">
            Timezone
            <input
              type="text"
              value={timezone}
              onChange={(event) => setTimezone(event.target.value)}
            />
          </label>

          <label className="form-field">
            Default rotation playlist
            <select
              value={playlistId}
              onChange={(event) => {
                setPlaylistId(event.target.value);
                setVersionId('');
              }}
            >
              <option value="">Select a playlist</option>
              {playlists.map((playlist) => (
                <option key={playlist.playlistId} value={playlist.playlistId}>
                  {playlist.title}
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            Default rotation playlist version
            <select
              value={versionId}
              onChange={(event) => setVersionId(event.target.value)}
              disabled={!playlistId}
            >
              <option value="">Select a published version</option>
              {versions.map((version) => (
                <option key={version.versionId} value={version.versionId}>
                  v{version.versionNumber} — {version.tracks.length} tracks
                </option>
              ))}
            </select>
          </label>

          <label className="form-field">
            AutoDJ timeline start
            <input
              type="datetime-local"
              value={epochLocalInput}
              onChange={(event) => setEpochLocalInput(event.target.value)}
            />
          </label>
          <p className="form-field__hint">
            Base reference time used to calculate deterministic AutoDJ playback. Normally set once
            and left unchanged.
          </p>
          <p className="form-field__hint form-field__hint--accent">
            Station time: {timezone.trim() || 'not set'}
          </p>

          <label className="form-check">
            <input
              type="checkbox"
              checked={messagingEnabled}
              onChange={(event) => setMessagingEnabled(event.target.checked)}
            />
            Enable station messaging
          </label>

          <label className="form-check">
            <input
              type="checkbox"
              checked={tipsEnabled}
              onChange={(event) => setTipsEnabled(event.target.checked)}
            />
            Enable tips/donations
          </label>

          <label className="form-field">
            Music scope
            <select
              value={musicScope}
              onChange={(event) => setMusicScope(event.target.value as StationMusicScope | '')}
            >
              <option value="">Not set</option>
              <option value="INTERNATIONAL">International</option>
              <option value="REGIONAL">Regional</option>
              <option value="MIXED">Mixed</option>
            </select>
          </label>

          {saveError && <p className="form-error">{saveError}</p>}
          {saveSuccess && <p className="form-success">Station configuration saved.</p>}

          <div className="form-actions">
            <button
              className="button button--primary"
              type="button"
              onClick={handleSave}
              disabled={saving || !name.trim() || !playlistId || !versionId || !epochLocalInput}
            >
              {saving ? 'Saving…' : station ? 'Save Station' : 'Create Station'}
            </button>
          </div>
        </div>
        <NoticeAdminPanel />
      </div>
      {transaction ? (
        <QdnTransactionFlow
          title="Station Configuration"
          state={transaction}
          onClose={() => setTransaction(null)}
        />
      ) : null}
    </PageShell>
  );
}
