import { sql } from "drizzle-orm";
import {
  index,
  integer,
  jsonb,
  pgEnum,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
  uuid,
  varchar
} from "drizzle-orm/pg-core";

export const workspaceRole = pgEnum("workspace_role", [
  "admin",
  "supervisor",
  "operator"
]);

export const incidentStatus = pgEnum("incident_status", [
  "Draft",
  "Open",
  "Monitoring",
  "Resolved",
  "Closed",
  "Cancel"
]);

export const incidentSeverity = pgEnum("incident_severity", [
  "Critical",
  "Major",
  "Minor"
]);

export const workspaces = pgTable("workspaces", {
  id: uuid("id").defaultRandom().primaryKey(),
  name: varchar("name", { length: 200 }).notNull(),
  ownerUserId: text("owner_user_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
});

export const workspaceMembers = pgTable(
  "workspace_members",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    userId: text("user_id").notNull(),
    email: varchar("email", { length: 320 }).notNull(),
    name: varchar("name", { length: 180 }).notNull(),
    role: workspaceRole("role").notNull().default("operator"),
    joinedAt: timestamp("joined_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceUserUnique: uniqueIndex("workspace_members_workspace_user_uq").on(
      table.workspaceId,
      table.userId
    ),
    workspaceIndex: index("workspace_members_workspace_idx").on(table.workspaceId),
    userIndex: index("workspace_members_user_idx").on(table.userId)
  })
);

export const workspaceSettings = pgTable(
  "workspace_settings",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    data: jsonb("data").$type<Record<string, unknown>>().notNull().default({}),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull(),
    updatedBy: text("updated_by").notNull()
  },
  (table) => ({
    workspaceUnique: uniqueIndex("workspace_settings_workspace_uq").on(table.workspaceId)
  })
);

export const incidents = pgTable(
  "incidents",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    identityMode: varchar("identity_mode", { length: 16 }).notNull().default("standard"),
    incidentId: varchar("incident_id", { length: 180 }).notNull().default(""),
    titleOverride: varchar("title_override", { length: 1000 }).notNull().default(""),
    status: incidentStatus("status").notNull().default("Draft"),
    severity: incidentSeverity("severity").notNull().default("Critical"),
    revision: integer("revision").notNull().default(1),
    payload: jsonb("payload").$type<Record<string, unknown>>().notNull().default({}),
    deletedAt: timestamp("deleted_at", { withTimezone: true }),
    deleteReason: text("delete_reason").notNull().default(""),
    createdBy: text("created_by").notNull(),
    updatedBy: text("updated_by").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspaceIndex: index("incidents_workspace_updated_idx").on(
      table.workspaceId,
      table.updatedAt
    ),
    workspaceStatusIndex: index("incidents_workspace_status_idx").on(
      table.workspaceId,
      table.status
    ),
    activeIncidentKeyUnique: uniqueIndex("incidents_workspace_active_incident_id_uq")
      .on(table.workspaceId, sql`lower(btrim(${table.incidentId}))`)
      .where(sql`${table.deletedAt} is null and ${table.incidentId} <> ''`)
  })
);

export const incidentVersions = pgTable(
  "incident_versions",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    label: varchar("label", { length: 300 }).notNull(),
    snapshot: jsonb("snapshot").$type<Record<string, unknown>>().notNull(),
    createdBy: text("created_by").notNull(),
    createdByName: varchar("created_by_name", { length: 180 }).notNull().default(""),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    incidentCreatedIndex: index("incident_versions_incident_created_idx").on(
      table.incidentId,
      table.createdAt
    )
  })
);

export const incidentAuditLogs = pgTable(
  "incident_audit_logs",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    incidentId: uuid("incident_id")
      .notNull()
      .references(() => incidents.id, { onDelete: "cascade" }),
    action: varchar("action", { length: 100 }).notNull(),
    summary: varchar("summary", { length: 500 }).notNull(),
    changedFields: jsonb("changed_fields").$type<string[]>().notNull().default([]),
    fromRevision: integer("from_revision").notNull().default(0),
    toRevision: integer("to_revision").notNull().default(0),
    actorId: text("actor_id").notNull(),
    actorName: varchar("actor_name", { length: 180 }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    incidentCreatedIndex: index("incident_audit_logs_incident_created_idx").on(
      table.incidentId,
      table.createdAt
    )
  })
);

export const routeMasterItems = pgTable(
  "route_master_items",
  {
    id: uuid("id").defaultRandom().primaryKey(),
    workspaceId: uuid("workspace_id")
      .notNull()
      .references(() => workspaces.id, { onDelete: "cascade" }),
    systemKey: varchar("system_key", { length: 180 }).notNull(),
    routeSegment: varchar("route_segment", { length: 240 }).notNull(),
    sourceImportId: uuid("source_import_id"),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull()
  },
  (table) => ({
    workspacePairUnique: uniqueIndex("route_master_workspace_pair_uq").on(
      table.workspaceId,
      table.systemKey,
      table.routeSegment
    ),
    workspaceIndex: index("route_master_workspace_idx").on(table.workspaceId)
  })
);

export type Workspace = typeof workspaces.$inferSelect;
export type WorkspaceMember = typeof workspaceMembers.$inferSelect;
export type IncidentRecord = typeof incidents.$inferSelect;
