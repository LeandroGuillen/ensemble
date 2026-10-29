import {
  projectPathFromStagedPath,
  sanitizeTrashRecordId,
  trashCommitFailedMessage,
  trashStagingFailureMessage,
} from './trash-record-id';

describe('trash-record-id', () => {
  it('sanitizes ids with a dot (e.g. jon.snow)', () => {
    expect(sanitizeTrashRecordId('jon.snow')).toBe('jon_snow');
  });

  it('sanitizes ids with an accented letter (e.g. josé)', () => {
    expect(sanitizeTrashRecordId('josé')).toBe('jos_');
  });

  it('truncates to 128 and falls back when empty', () => {
    expect(sanitizeTrashRecordId('').length).toBeGreaterThan(0);
    expect(sanitizeTrashRecordId('a'.repeat(200)).length).toBe(128);
    expect(sanitizeTrashRecordId('...')).toBe('___');
  });

  it('formats staging and commit-failed messages exactly', () => {
    expect(trashStagingFailureMessage('Ada', 'boom')).toBe(
      `Couldn't delete "Ada": boom. Nothing was changed.`
    );
    expect(trashCommitFailedMessage('Ada', 'ENOENT', '/proj')).toBe(
      `Couldn't move "Ada" to the system Trash (ENOENT). ` +
        `It's kept in /proj/.ensemble-trash/ and Ensemble will retry next time you open this project.`
    );
  });

  it('derives project path from a staged path', () => {
    expect(
      projectPathFromStagedPath('/proj/.ensemble-trash/2026-char-id/ada.md')
    ).toBe('/proj');
  });
});
