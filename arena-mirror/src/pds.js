// PDS plumbing for the mirror: collection listing, batched writes, blob
// upload. Takes any logged-in AtpAgent (or an unauthenticated one for
// read-only dry runs — listRecords/getRecord are public XRPC).

const rkeyFromUri = (uri) => String(uri || '').split('/').pop() || null;

/** Every record in a collection as `{ rkey, value }`. */
export async function listCollection(agent, did, collection) {
  const out = [];
  let cursor;
  do {
    const res = await agent.com.atproto.repo.listRecords({ repo: did, collection, limit: 100, cursor });
    const records = res?.data?.records || [];
    for (const r of records) out.push({ rkey: rkeyFromUri(r.uri), value: r.value });
    cursor = res?.data?.cursor;
    if (!records.length) break;
  } while (cursor);
  return out;
}

export async function getRecord(agent, did, collection, rkey) {
  try {
    const res = await agent.com.atproto.repo.getRecord({ repo: did, collection, rkey });
    return res?.data?.value || null;
  } catch {
    return null;
  }
}

/**
 * Apply create/update/delete ops in applyWrites batches. On a failed batch,
 * falls back to per-op calls so one bad record can't sink its batchmates.
 * Ops: `{ type: 'create'|'update'|'delete', collection, rkey, value? }`.
 * Records use side-loaded lexicons, so validation is off.
 */
export async function applyOps(agent, did, ops, { batchSize = 50, log = () => {} } = {}) {
  let ok = 0;
  let fail = 0;
  for (let i = 0; i < ops.length; i += batchSize) {
    const batch = ops.slice(i, i + batchSize);
    const writes = batch.map((op) =>
      op.type === 'delete'
        ? { $type: 'com.atproto.repo.applyWrites#delete', collection: op.collection, rkey: op.rkey }
        : {
            $type: `com.atproto.repo.applyWrites#${op.type}`,
            collection: op.collection,
            rkey: op.rkey,
            value: op.value,
          },
    );
    try {
      await agent.com.atproto.repo.applyWrites({ repo: did, writes, validate: false });
      ok += batch.length;
    } catch (err) {
      log(`applyWrites batch failed (${err.message}) — retrying ${batch.length} op(s) individually`);
      for (const op of batch) {
        try {
          if (op.type === 'delete') {
            await agent.com.atproto.repo.deleteRecord({ repo: did, collection: op.collection, rkey: op.rkey });
          } else {
            await agent.com.atproto.repo.putRecord({
              repo: did,
              collection: op.collection,
              rkey: op.rkey,
              record: op.value,
              validate: false,
            });
          }
          ok++;
        } catch (opErr) {
          fail++;
          log(`  ${op.type} ${op.collection}/${op.rkey} failed: ${opErr.message}`);
        }
      }
    }
  }
  return { ok, fail };
}

/** Upload bytes as a blob; returns the blob ref to embed in a record. */
export async function uploadBlob(agent, bytes, contentType) {
  const res = await agent.uploadBlob(bytes, { encoding: contentType });
  return res?.data?.blob || null;
}
