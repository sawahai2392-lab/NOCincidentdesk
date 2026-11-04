import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { deleteDoc, doc, getDoc, setDoc, writeBatch, Timestamp } from 'firebase/firestore';
import {
  assertFails,
  assertSucceeds,
  initializeTestEnvironment,
} from '@firebase/rules-unit-testing';

const projectId = 'demo-noc-incident-desk';
const rules = await readFile(new URL('../firestore.rules', import.meta.url), 'utf8');
let testEnv;

before(async () => {
  testEnv = await initializeTestEnvironment({
    projectId,
    firestore: {
      host: '127.0.0.1',
      port: 8080,
      rules,
    },
  });
});

after(async () => {
  await testEnv?.cleanup();
});

beforeEach(async () => {
  await testEnv.clearFirestore();
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'workspaces', 'workspace-a'), {
      ownerUid: 'admin-a',
      name: 'Workspace A',
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    });
    await setDoc(doc(db, 'workspaces/workspace-a/members/admin-a'), {
      userId: 'admin-a',
      workspaceId: 'workspace-a',
      role: 'admin',
      email: 'admin@example.com',
      status: 'active',
      joinedAt: 1,
    });
    await setDoc(doc(db, 'workspaces/workspace-a/members/operator-a'), {
      userId: 'operator-a',
      workspaceId: 'workspace-a',
      role: 'operator',
      email: 'operator@example.com',
      status: 'active',
      joinedAt: 2,
    });
    await setDoc(doc(db, 'workspaces/workspace-a/members/supervisor-a'), {
      userId: 'supervisor-a',
      workspaceId: 'workspace-a',
      role: 'supervisor',
      email: 'supervisor@example.com',
      status: 'active',
      joinedAt: 3,
    });
    await setDoc(doc(db, 'workspaces', 'workspace-b'), {
      ownerUid: 'admin-b',
      name: 'Workspace B',
      createdAt: 1,
      updatedAt: 1,
      status: 'active',
    });
    await setDoc(doc(db, 'workspaces/workspace-b/members/admin-b'), {
      userId: 'admin-b',
      workspaceId: 'workspace-b',
      role: 'admin',
      email: 'admin-b@example.com',
      status: 'active',
      joinedAt: 1,
    });
    await setDoc(doc(db, 'workspaces/workspace-b/incidents/private-b'), {
      id: 'private-b',
      incidentId: 'TT-PRIVATE-B',
      status: 'Open',
      severity: 'Major',
      deletedAt: 0,
      createdBy: 'admin-b',
      createdAt: 1,
      updatedBy: 'admin-b',
      updatedAt: 1,
      revision: 1,
    });
    await setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a'), {
      id: 'incident-a',
      incidentId: 'TT-A-001',
      status: 'Open',
      severity: 'Major',
      deletedAt: 0,
      normalizedIncidentId: 'tta001',
      createdBy: 'operator-a',
      createdAt: 1,
      updatedBy: 'operator-a',
      updatedAt: 1,
      revision: 1,
    });
    await setDoc(doc(db, 'workspaces/workspace-a/incidentKeys/tta001'), {
      incidentId: 'incident-a',
      normalizedKey: 'tta001',
      active: true,
    });
  });
});

test('email-unverified account cannot access workspace records', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: false,
  }).firestore();
  await assertFails(getDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a')));
});

test('workspace member can read own incident', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  await assertSucceeds(getDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a')));
});

test('member cannot read another workspace incident by guessing its document path', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  await assertFails(getDoc(doc(db, 'workspaces/workspace-b/incidents/private-b')));
});

test('operator can create a draft incident in their workspace', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  await assertSucceeds(setDoc(doc(db, 'workspaces/workspace-a/incidents/new-draft'), {
    id: 'new-draft',
    incidentId: '',
    status: 'Draft',
    severity: 'Critical',
    deletedAt: 0,
    createdBy: 'operator-a',
    createdAt: 2,
    updatedBy: 'operator-a',
    updatedAt: 2,
    revision: 1,
  }));
});

test('incident identifier requires a matching index in the same atomic write', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();

  const withoutIndex = {
    id: 'incident-no-index',
    incidentId: 'TT-A-002',
    normalizedIncidentId: 'tta002',
    status: 'Draft',
    severity: 'Critical',
    deletedAt: 0,
    createdBy: 'operator-a',
    createdAt: 2,
    updatedBy: 'operator-a',
    updatedAt: 2,
    revision: 1,
  };
  await assertFails(setDoc(
    doc(db, 'workspaces/workspace-a/incidents/incident-no-index'),
    withoutIndex,
  ));

  const batch = writeBatch(db);
  batch.set(doc(db, 'workspaces/workspace-a/incidents/incident-with-index'), {
    ...withoutIndex,
    id: 'incident-with-index',
  });
  batch.set(doc(db, 'workspaces/workspace-a/incidentKeys/tta002'), {
    incidentId: 'incident-with-index',
    normalizedKey: 'tta002',
    active: true,
  });
  await assertSucceeds(batch.commit());
});

test('operator cannot resolve an incident or move it to Trash', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  const incidentRef = doc(db, 'workspaces/workspace-a/incidents/incident-a');

  await assertFails(setDoc(incidentRef, {
    id: 'incident-a',
    incidentId: 'TT-A-001',
    normalizedIncidentId: 'tta001',
    status: 'Resolved',
    severity: 'Major',
    deletedAt: 0,
    createdBy: 'operator-a',
    createdAt: 1,
    updatedBy: 'operator-a',
    updatedAt: 2,
    revision: 2,
  }));

  await assertFails(setDoc(incidentRef, {
    id: 'incident-a',
    incidentId: 'TT-A-001',
    status: 'Open',
    severity: 'Major',
    deletedAt: 3,
    createdBy: 'operator-a',
    createdAt: 1,
    updatedBy: 'operator-a',
    updatedAt: 2,
    revision: 2,
  }));
});

test('supervisor can resolve an incident', async () => {
  const db = testEnv.authenticatedContext('supervisor-a', {
    email: 'supervisor@example.com',
    email_verified: true,
  }).firestore();
  await assertSucceeds(setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a'), {
    id: 'incident-a',
    incidentId: 'TT-A-001',
    normalizedIncidentId: 'tta001',
    status: 'Resolved',
    severity: 'Major',
    deletedAt: 0,
    createdBy: 'operator-a',
    createdAt: 1,
    updatedBy: 'supervisor-a',
    updatedAt: 2,
    revision: 2,
  }));
});

test('incident key documents cannot point to missing incidents', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();

  await assertFails(setDoc(doc(db, 'workspaces/workspace-a/incidentKeys/poisoned'), {
    incidentId: 'missing-incident',
    normalizedKey: 'poisoned',
    active: true,
  }));
});

test('admin can release an incident key when moving an incident to Trash', async () => {
  const db = testEnv.authenticatedContext('admin-a', {
    email: 'admin@example.com',
    email_verified: true,
  }).firestore();
  const batch = writeBatch(db);
  batch.update(doc(db, 'workspaces/workspace-a/incidents/incident-a'), {
    deletedAt: 10,
    deletedBy: 'admin-a',
    deleteReason: 'Duplicate report',
    updatedBy: 'admin-a',
    updatedAt: 10,
    revision: 2,
  });
  batch.delete(doc(db, 'workspaces/workspace-a/incidentKeys/tta001'));
  await assertSucceeds(batch.commit());
});

test('removed member can rejoin the same workspace with a fresh email-bound invite', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const adminDb = context.firestore();
    await setDoc(doc(adminDb, 'users/operator-a'), {
      uid: 'operator-a',
      workspaceId: 'workspace-a',
      role: 'operator',
      email: 'operator@example.com',
      name: 'Operator A',
      photoURL: '',
      createdAt: 1,
      updatedAt: 1,
    });
    await setDoc(doc(adminDb, 'workspaces/workspace-a/members/operator-a'), {
      userId: 'operator-a',
      workspaceId: 'workspace-a',
      role: 'operator',
      email: 'operator@example.com',
      name: 'Operator A',
      createdAt: 1,
      joinedAt: 2,
      status: 'removed',
      removedAt: 3,
    });
    await setDoc(doc(adminDb, 'workspaceInvites/reinvite-operator-a'), {
      workspaceId: 'workspace-a',
      email: 'operator@example.com',
      role: 'supervisor',
      status: 'pending',
      createdAt: 4,
      expiresAt: Timestamp.fromMillis(Date.now() + 60_000),
      createdBy: 'admin-a',
    });
  });

  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  const joinedAt = Date.now();
  const batch = writeBatch(db);
  batch.update(doc(db, 'workspaces/workspace-a/members/operator-a'), {
    role: 'supervisor',
    email: 'operator@example.com',
    name: 'Operator A',
    joinedAt,
    status: 'active',
    inviteCode: 'reinvite-operator-a',
    removedAt: null,
  });
  batch.update(doc(db, 'users/operator-a'), {
    name: 'Operator A',
    photoURL: '',
    updatedAt: joinedAt,
  });
  batch.update(doc(db, 'workspaceInvites/reinvite-operator-a'), {
    status: 'joined',
    joinedAt,
    joinedBy: 'operator-a',
  });
  await assertSucceeds(batch.commit());

  const member = await getDoc(doc(db, 'workspaces/workspace-a/members/operator-a'));
  assert.equal(member.data()?.status, 'active');
  assert.equal(member.data()?.role, 'supervisor');
});

test('audit entries are append-only and must match the resulting incident revision', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  const auditRef = doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-1');
  const updateBatch = writeBatch(db);
  updateBatch.update(doc(db, 'workspaces/workspace-a/incidents/incident-a'), {
    updatedBy: 'operator-a',
    updatedAt: 2,
    revision: 2,
  });
  updateBatch.set(auditRef, {
    action: 'updated',
    summary: 'Operator update',
    changedFields: ['internalNotes'],
    fromRevision: 1,
    toRevision: 2,
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 2,
  });
  await assertSucceeds(updateBatch.commit());
  await assertFails(setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-orphan'), {
    action: 'updated',
    summary: 'Wrong revision',
    changedFields: ['internalNotes'],
    fromRevision: 1,
    toRevision: 3,
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 3,
  }));
  await assertFails(setDoc(auditRef, {
    action: 'tampered',
    summary: 'Audit rewritten',
    changedFields: [],
    fromRevision: 1,
    toRevision: 1,
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 3,
  }));
});

test('version snapshots and their audit entries must be created atomically', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  const incident = {
    id: 'incident-a',
    incidentId: 'TT-A-001',
    status: 'Open',
    severity: 'Major',
    deletedAt: 0,
    normalizedIncidentId: 'tta001',
    createdBy: 'operator-a',
    createdAt: 1,
    updatedBy: 'operator-a',
    updatedAt: 1,
    revision: 1,
  };
  const version = doc(db, 'workspaces/workspace-a/incidents/incident-a/versions/version-1');
  const audit = doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-1');
  const batch = writeBatch(db);
  batch.set(version, {
    id: 'version-1',
    label: 'Manual snapshot · rev 1',
    incident,
    revision: 1,
    auditId: 'audit-1',
    createdAt: 2,
    createdBy: 'operator-a',
    createdByName: 'Operator A',
  });
  batch.set(audit, {
    action: 'snapshot_created',
    summary: 'Version snapshot dibuat',
    changedFields: [],
    fromRevision: 1,
    toRevision: 1,
    versionId: 'version-1',
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 2,
  });
  await assertSucceeds(batch.commit());

  await assertFails(setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a/versions/orphan-version'), {
    id: 'orphan-version',
    label: 'Unlinked snapshot',
    incident,
    revision: 1,
    auditId: 'missing-audit',
    createdAt: 3,
    createdBy: 'operator-a',
    createdByName: 'Operator A',
  }));
  await assertFails(setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-orphan-snapshot'), {
    action: 'snapshot_created',
    summary: 'Orphan snapshot',
    changedFields: [],
    fromRevision: 1,
    toRevision: 1,
    versionId: 'missing-version',
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 4,
  }));
  await assertFails(setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-missing-version-id'), {
    action: 'snapshot_created',
    summary: 'Snapshot without reference',
    changedFields: [],
    fromRevision: 1,
    toRevision: 1,
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 5,
  }));

  const restoreBatch = writeBatch(db);
  restoreBatch.update(doc(db, 'workspaces/workspace-a/incidents/incident-a'), {
    updatedBy: 'operator-a',
    updatedAt: 6,
    revision: 2,
  });
  restoreBatch.set(doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-restore'), {
    action: 'version_restored',
    summary: 'Incident dipulihkan dari version snapshot',
    changedFields: ['internalNotes'],
    fromRevision: 1,
    toRevision: 2,
    sourceVersionId: 'version-1',
    actorId: 'operator-a',
    actorName: 'Operator A',
    createdAt: 6,
  });
  await assertSucceeds(restoreBatch.commit());

  await assertFails(setDoc(version, {
    id: 'version-1',
    label: 'Tampered',
    incident,
    revision: 1,
    auditId: 'audit-1',
    createdAt: 5,
    createdBy: 'operator-a',
    createdByName: 'Operator A',
  }));
});

test('first account can create its own Admin workspace atomically', async () => {
  const db = testEnv.authenticatedContext('first-admin', {
    email: 'first@example.com',
    email_verified: true,
  }).firestore();
  const batch = writeBatch(db);
  batch.set(doc(db, 'workspaces/new-workspace'), {
    name: 'New workspace',
    ownerUid: 'first-admin',
    createdAt: 1,
    updatedAt: 1,
    status: 'active',
  });
  batch.set(doc(db, 'workspaces/new-workspace/members/first-admin'), {
    userId: 'first-admin',
    workspaceId: 'new-workspace',
    role: 'admin',
    email: 'first@example.com',
    name: 'First Admin',
    joinedAt: 1,
    status: 'active',
  });
  batch.set(doc(db, 'users/first-admin'), {
    uid: 'first-admin',
    workspaceId: 'new-workspace',
    role: 'admin',
    email: 'first@example.com',
    name: 'First Admin',
    createdAt: 1,
    updatedAt: 1,
  });
  batch.set(doc(db, 'workspaces/new-workspace/settings/main'), {
    groups: [],
    picAreas: [],
    picNames: [],
    rootCauses: [],
    actions: [],
    progressPhrases: [],
    sites: [],
    slaCriticalMinutes: 15,
    slaMajorMinutes: 30,
    slaMinorMinutes: 60,
    staleUpdateMinutes: 45,
    updatedAt: 1,
    updatedBy: 'first-admin',
  });
  await assertSucceeds(batch.commit());
});

test('hard delete is disabled for both Admin and Operator in Spark-only mode', async () => {
  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a'), {
      id: 'incident-a',
      incidentId: 'TT-A-001',
      normalizedIncidentId: 'tta001',
      status: 'Open',
      severity: 'Major',
      deletedAt: 10,
      createdBy: 'operator-a',
      createdAt: 1,
      updatedBy: 'admin-a',
      updatedAt: 10,
      revision: 2,
    });
  });

  const operatorDb = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  const adminDb = testEnv.authenticatedContext('admin-a', {
    email: 'admin@example.com',
    email_verified: true,
  }).firestore();

  await assertFails(deleteDoc(doc(operatorDb, 'workspaces/workspace-a/incidents/incident-a')));
  await assertFails(deleteDoc(doc(adminDb, 'workspaces/workspace-a/incidents/incident-a')));

  await testEnv.withSecurityRulesDisabled(async (context) => {
    const db = context.firestore();
    await setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-1'), {
      action: 'deleted',
      actorId: 'admin-a',
      createdAt: 10,
    });
    await setDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a/versions/version-1'), {
      createdBy: 'admin-a',
      incident: { id: 'incident-a' },
      createdAt: 9,
    });
  });

  await assertFails(deleteDoc(doc(adminDb, 'workspaces/workspace-a/incidents/incident-a/audit/audit-1')));
  await assertFails(deleteDoc(doc(adminDb, 'workspaces/workspace-a/incidents/incident-a/versions/version-1')));
});


test('restore operations are Admin-only and immutable outside the allowed status fields', async () => {
  const adminDb = testEnv.authenticatedContext('admin-a', {
    email: 'admin@example.com',
    email_verified: true,
  }).firestore();
  const operatorDb = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
    email_verified: true,
  }).firestore();
  const operationRef = doc(adminDb, 'workspaces/workspace-a/restoreOperations/restore-1');
  const startedAt = Date.now();

  await assertSucceeds(setDoc(operationRef, {
    id: 'restore-1',
    kind: 'selective-restore',
    status: 'running',
    stage: 'starting',
    message: 'Restore started',
    selectedSections: ['settings', 'routeMaster'],
    createdAt: startedAt,
    updatedAt: startedAt,
    createdBy: 'admin-a',
    events: [{ at: startedAt, stage: 'starting', message: 'Restore started' }],
  }));

  // Audit events are append-only: an Admin cannot clear or rewrite existing events.
  await assertFails(setDoc(operationRef, { events: [] }, { merge: true }));
  await assertFails(setDoc(operationRef, {
    events: [{ at: startedAt, stage: 'tampered', message: 'Changed history' }],
  }, { merge: true }));

  // While the operation is still running, identity and creation time are immutable.
  await assertFails(setDoc(operationRef, { createdBy: 'operator-a' }, { merge: true }));
  await assertFails(setDoc(operationRef, { createdAt: startedAt + 1 }, { merge: true }));

  const operatorOperationRef = doc(operatorDb, 'workspaces/workspace-a/restoreOperations/restore-1');
  await assertFails(getDoc(operatorOperationRef));
  await assertFails(setDoc(doc(operatorDb, 'workspaces/workspace-a/restoreOperations/operator-restore'), {
    id: 'operator-restore',
    kind: 'selective-restore',
    status: 'running',
    createdAt: startedAt,
    updatedAt: startedAt,
    createdBy: 'operator-a',
    selectedSections: ['settings'],
    events: [],
  }));

  await assertSucceeds(setDoc(operationRef, {
    status: 'completed',
    stage: 'completed',
    message: 'Restore verified',
    updatedAt: startedAt + 100,
    finishedAt: startedAt + 100,
    events: [
      { at: startedAt, stage: 'starting', message: 'Restore started' },
      { at: startedAt + 100, stage: 'completed', message: 'Restore verified' },
    ],
  }, { merge: true }));

  await assertFails(setDoc(operationRef, {
    status: 'failed',
    updatedAt: startedAt + 200,
  }, { merge: true }));
  await assertFails(deleteDoc(operationRef));
});
