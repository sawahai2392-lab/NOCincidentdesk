import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { after, before, beforeEach, test } from 'node:test';
import { doc, getDoc, setDoc, writeBatch } from 'firebase/firestore';
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

test('workspace member can read own incident', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
  }).firestore();
  await assertSucceeds(getDoc(doc(db, 'workspaces/workspace-a/incidents/incident-a')));
});

test('member cannot read another workspace incident by guessing its document path', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
  }).firestore();
  await assertFails(getDoc(doc(db, 'workspaces/workspace-b/incidents/private-b')));
});

test('operator can create a draft incident in their workspace', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
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

test('audit entries are append-only for workspace members', async () => {
  const db = testEnv.authenticatedContext('operator-a', {
    email: 'operator@example.com',
  }).firestore();
  const auditRef = doc(db, 'workspaces/workspace-a/incidents/incident-a/audit/audit-1');
  await assertSucceeds(setDoc(auditRef, {
    action: 'updated',
    summary: 'Operator update',
    actorId: 'operator-a',
    createdAt: 2,
  }));
  await assertFails(setDoc(auditRef, {
    action: 'tampered',
    summary: 'Audit rewritten',
    actorId: 'operator-a',
    createdAt: 3,
  }));
});

test('first account can create its own Admin workspace atomically', async () => {
  const db = testEnv.authenticatedContext('first-admin', {
    email: 'first@example.com',
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
