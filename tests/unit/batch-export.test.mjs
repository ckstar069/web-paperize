import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../tools/batch-export.sh', import.meta.url), 'utf8');

test('batch harness targets and verifies one stable Chrome window id', () => {
  assert.match(source, /WINDOW_ID=.*osascript/s);
  assert.match(source, /set index of window id targetId to 1/);
  assert.match(source, /id of front window is not targetId/);
  assert.doesNotMatch(source, /works even if window is not frontmost/);
});

test('batch harness rejects stale/name-only PDFs and verifies extracted marker text', () => {
  assert.match(source, /started=\$\(date \+%s\)/);
  assert.match(source, /snapshot_pdfs/);
  assert.match(source, /stat -f%m/);
  assert.match(source, /pdftotext/);
  assert.match(source, /grep -Fq -- "\$marker"/);
  assert.match(source, /IDENTITY_TIMEOUT/);
});

test('batch harness recognizes Chrome numeric filename conflicts', () => {
  assert.match(source, /\[\[ "\$suffix" =~ \^\[0-9\]\+\$ \]\]/);
  assert.match(source, /"\$stem \("\*"\)\.pdf"/);
});

test('iframe selection is documented and fails explicitly without entering capture', () => {
  const worker = readFileSync(new URL('../../src/background/service-worker.js', import.meta.url), 'utf8');
  const readme = readFileSync(new URL('../../README.md', import.meta.url), 'utf8');
  assert.match(worker, /info\.frameId !== 0/);
  assert.match(worker, /error\.selectionInFrame/);
  assert.match(readme, /iframe 内选区会明确提示不支持/);
});
