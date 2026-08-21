export { BulkImportWorkspace } from './components/BulkImportWorkspace';
export { BulkImportSummary } from './components/BulkImportSummary';
export { BulkImportRowEditor } from './components/BulkImportRowEditor';

export {
  unavailableBulkPublicationAdapter,
  BulkPublicationUnavailableError,
  isBulkPublicationRowResultCurrent,
  isBulkPublicationStepResultCurrent,
  mapBulkImportRoleToPublicationIntent,
  validateBulkPublicationStepResultAgainstCurrentRow,
} from './publicationAdapter';
export type {
  BulkPublicationAlreadyConfirmedStepResult,
  BulkPublicationAcquisitionFailure,
  BulkPublicationAcquisitionResult,
  BulkPublicationActorContext,
  BulkPublicationAdapter,
  BulkPublicationBatchResult,
  BulkPublicationCapability,
  BulkPublicationCoverIntent,
  BulkPublicationFailedStepResult,
  BulkPublicationIntent,
  BulkPublicationNonResourceStepResult,
  BulkPublicationPublishedStepResult,
  BulkPublicationResourceStepKind,
  BulkPublicationResultCurrentContext,
  BulkPublicationRoleIntent,
  BulkPublicationRowIntent,
  BulkPublicationRowResult,
  BulkPublicationRowStatus,
  BulkPublicationSkipReason,
  BulkPublicationSourceDescriptor,
  BulkPublicationSourceStepResult,
  BulkPublicationStepKind,
  BulkPublicationStepResultClassification,
  BulkPublicationStepResult,
  BulkPublicationStepResultValidation,
  BulkPublicationUnknownStepResult,
} from './publicationAdapter';

export {
  addLocalStagingFiles,
  applyBulkImportExtraction,
  createBulkImportBatch,
  createBulkImportRow,
  createEmptyPublicationJournal,
  markBulkImportRowAnalysisFailed,
  markBulkImportRowAnalyzing,
  removeBulkImportRow,
  setBulkImportMetadataField,
  setBulkImportRowCover,
  setBulkImportRowSelected,
  setBulkImportRowSource,
} from './batchStore';
export type { AddLocalStagingFilesResult, ApplyExtractionResult } from './batchStore';

export {
  getBulkImportBatchSummary,
  getBulkImportPublicationStatus,
  getBulkImportRowDisplayStatus,
  getBulkImportRowValidation,
} from './selectors';
export type {
  BulkImportBatchSummary,
  BulkImportPublicationStatus,
  BulkImportRowDisplayStatus,
  BulkImportRowValidation,
} from './selectors';

export {
  BULK_IMPORT_MAX_TOTAL_BYTES,
  BULK_IMPORT_MAX_TRACKS,
  MIB_BYTES,
  formatMib,
  getBulkImportLimits,
  getSelectedBulkImportRows,
} from './limits';
export type { BulkImportLimits } from './limits';

export { parseArtistTitleFromFilename } from './filenameParser';
export type { FilenameParseResult } from './filenameParser';

export { sourceDescriptorsMatch } from './sourceIdentity';

export {
  computeAudioContentRevision,
  computeCoverContentRevision,
  computeMetadataContentRevision,
  stableContentFingerprint,
} from './contentRevision';

export {
  BULK_IMPORT_PUBLICATION_JOURNAL_SCHEMA_VERSION,
  createEmptyPublicationAttempt,
  createEmptyPublicationSource,
  createEmptyPublicationStep,
  createFailedPublicationStep,
  createInProgressPublicationStep,
  createPublishedPublicationStep,
  createUnknownPublicationStep,
  getRequiredPublicationContentRevision,
  getUnknownPublicationSteps,
  isFailedPublicationStep,
  isInProgressPublicationStep,
  isPublishedPublicationStep,
  isUnknownPublicationStep,
  invalidatePublicationForCoverChange,
  invalidatePublicationForMetadataChange,
  invalidatePublicationForSourceChange,
  publicationStepMatchesContent,
  publicationStepStatus,
} from './publicationJournal';

export {
  clearTransientRegistry,
  createBulkImportTransientRegistry,
  deleteTransientEntry,
  getTransientEntry,
  setTransientEntry,
  transientSourceKey,
} from './transientRegistry';
export type { BulkImportTransientRegistry } from './transientRegistry';

export {
  loadBulkImportBatch,
  saveBulkImportBatch,
  clearBulkImportBatch,
  serializeBulkImportBatch,
  deserializeBulkImportBatch,
} from './services/bulkImportStorage';

export {
  extractEmbeddedAudioMetadata,
  metadataFromMusicMetadata,
  normalizeEmbeddedGenres,
  normalizeEmbeddedReleaseDate,
  selectEmbeddedPicture,
} from './services/audioMetadata';

export {
  BULK_IMPORT_LOCAL_DECODE_MAX_BYTES,
  resolveLocalAudioDurationMs,
  shouldAttemptLocalAudioDecode,
} from './services/localAudio';

export type {
  AppliedBulkImportExtraction,
  BulkImportBatch,
  BulkImportCoverDraft,
  BulkImportCoverOrigin,
  BulkImportDurationSource,
  BulkImportExtractionState,
  BulkImportExtractionStatus,
  BulkImportLocalSourceDescriptor,
  BulkImportMetadataDraft,
  BulkImportMetadataField,
  BulkImportMetadataProvenance,
  BulkImportMetadataProvenanceSource,
  BulkImportPublicationAttempt,
  BulkImportPublicationError,
  BulkImportPublicationFailedStep,
  BulkImportPublicationInProgressStep,
  BulkImportPublicationJournal,
  BulkImportPublicationNotStartedStep,
  BulkImportPublicationPublishedStep,
  BulkImportPublicationReference,
  BulkImportPublicationResourceIdentity,
  BulkImportPublicationResourceKind,
  BulkImportPublicationSource,
  BulkImportPublicationSourceStatus,
  BulkImportPublicationStep,
  BulkImportPublicationStepStatus,
  BulkImportPublicationUnknownStep,
  BulkImportRole,
  BulkImportRow,
  BulkImportTransientEntry,
  EmbeddedAudioMetadata,
  EmbeddedAudioPicture,
} from './types';
