import { S3Client } from '@aws-sdk/client-s3';
import {
  loadSentKeys,
  loadDiscardedRecords,
  saveSentKeys,
  saveDiscardedEvents,
  excludeEvaluatedEvents,
} from '../../src/event-pipeline/exclude-evaluated.js';
import { computeDedupKey } from '../../src/event-pipeline/dedup.js';
import type { Event, DiscardedRecord } from '../../src/event-pipeline/types.js';
import { Readable } from 'stream';

function makeStream(body: string) {
  const readable = Readable.from([body]);
  return Object.assign(readable, {
    transformToString: async () => body,
  });
}

function makeS3(response: unknown): S3Client {
  return { send: jest.fn().mockResolvedValue(response) } as unknown as S3Client;
}

function makeS3Throwing(err: unknown): S3Client {
  return { send: jest.fn().mockRejectedValue(err) } as unknown as S3Client;
}

function makeEvent(overrides: Partial<Event> = {}): Event {
  return {
    title: 'Test Concert',
    venue: 'Test Hall',
    date: '2026-04-15',
    url: 'https://example.com',
    sourceId: 'test',
    ...overrides,
  };
}

describe('loadSentKeys', () => {
  it('returns correct Set when file exists', async () => {
    const s3 = makeS3({ Body: makeStream('["key1","key2"]') });
    const result = await loadSentKeys(s3, 'test-bucket');
    expect(result).toEqual(new Set(['key1', 'key2']));
  });

  it('returns empty Set on NoSuchKey', async () => {
    const s3 = makeS3Throwing({ name: 'NoSuchKey' });
    const result = await loadSentKeys(s3, 'test-bucket');
    expect(result).toEqual(new Set());
  });
});

describe('loadDiscardedRecords', () => {
  it('returns correct array when file exists', async () => {
    const records: DiscardedRecord[] = [
      { key: 'abc', title: 'Dvořák Symphony', date: '2026-04-15', venue: 'Rudolfinum' },
    ];
    const s3 = makeS3({ Body: makeStream(JSON.stringify(records)) });
    const result = await loadDiscardedRecords(s3, 'test-bucket');
    expect(result).toEqual(records);
  });

  it('returns empty array on NoSuchKey', async () => {
    const s3 = makeS3Throwing({ name: 'NoSuchKey' });
    const result = await loadDiscardedRecords(s3, 'test-bucket');
    expect(result).toEqual([]);
  });
});

describe('saveSentKeys', () => {
  it('merges and deduplicates keys', async () => {
    const sendFn = jest.fn().mockResolvedValue({});
    const s3 = { send: sendFn } as unknown as S3Client;

    const existing = new Set(['key1', 'key2']);
    const event = makeEvent({ title: 'New Show', venue: 'Venue A', date: '2026-05-01' });
    const newKey = computeDedupKey(event);

    await saveSentKeys(s3, 'test-bucket', existing, [event]);

    const putInput = sendFn.mock.calls[0][0].input as { Body: string };
    const saved = JSON.parse(putInput.Body) as string[];
    expect(saved).toContain('key1');
    expect(saved).toContain('key2');
    expect(saved).toContain(newKey);
    expect(new Set(saved).size).toBe(saved.length);
  });
});

describe('saveDiscardedEvents', () => {
  it('appends new records and deduplicates by key', async () => {
    const sendFn = jest.fn().mockResolvedValue({});
    const s3 = { send: sendFn } as unknown as S3Client;

    const existing: DiscardedRecord[] = [
      { key: 'existing-key', title: 'Old Show', date: '2026-03-01', venue: 'Old Hall' },
    ];
    const newEvent = makeEvent({ title: 'New Show', venue: 'New Hall', date: '2026-05-01' });

    await saveDiscardedEvents(s3, 'test-bucket', existing, [newEvent]);

    const putInput = sendFn.mock.calls[0][0].input as { Body: string };
    const saved = JSON.parse(putInput.Body) as DiscardedRecord[];
    expect(saved).toHaveLength(2);
    expect(saved[0].key).toBe('existing-key');
    expect(saved[1].key).toBe(computeDedupKey(newEvent));
  });

  it('does not duplicate a record already in existingRecords', async () => {
    const sendFn = jest.fn().mockResolvedValue({});
    const s3 = { send: sendFn } as unknown as S3Client;

    const event = makeEvent();
    const key = computeDedupKey(event);
    const existing: DiscardedRecord[] = [
      { key, title: event.title, date: event.date, venue: event.venue },
    ];

    await saveDiscardedEvents(s3, 'test-bucket', existing, [event]);

    const putInput = sendFn.mock.calls[0][0].input as { Body: string };
    const saved = JSON.parse(putInput.Body) as DiscardedRecord[];
    expect(saved).toHaveLength(1);
  });

  it('saves record with correct { key, title, date, venue } shape', async () => {
    const sendFn = jest.fn().mockResolvedValue({});
    const s3 = { send: sendFn } as unknown as S3Client;

    const event = makeEvent({ title: 'Dvořák Symphony', date: '2026-04-15', venue: 'Rudolfinum' });

    await saveDiscardedEvents(s3, 'test-bucket', [], [event]);

    const putInput = sendFn.mock.calls[0][0].input as { Body: string };
    const saved = JSON.parse(putInput.Body) as DiscardedRecord[];
    expect(saved).toHaveLength(1);
    expect(saved[0]).toEqual({
      key: computeDedupKey(event),
      title: 'Dvořák Symphony',
      date: '2026-04-15',
      venue: 'Rudolfinum',
    });
  });
});

describe('excludeEvaluatedEvents', () => {
  it('excludes events whose key is in the combined sent + discarded Set', () => {
    const eventE = makeEvent({ title: 'Sent Show', venue: 'Hall A', date: '2026-04-01' });
    const eventF = makeEvent({ title: 'Discarded Show', venue: 'Hall B', date: '2026-04-02' });
    const eventG = makeEvent({ title: 'New Show', venue: 'Hall C', date: '2026-04-03' });

    const combinedKeys = new Set([computeDedupKey(eventE), computeDedupKey(eventF)]);

    const result = excludeEvaluatedEvents([eventE, eventF, eventG], combinedKeys);

    expect(result).toHaveLength(1);
    expect(result[0]).toBe(eventG);
  });
});
