import { PgBoss } from "pg-boss";
import { env } from "./env.js";
import { slaReminderHandler } from "../../backend/index.js";

export async function startStandaloneJobs() {
  const boss = new PgBoss({
    connectionString: env.DATABASE_URL,
    schema: "pgboss",
    application_name: "noc-incident-desk-jobs"
  });

  boss.on("error", (error: Error) => {
    console.error("background_jobs_error", error.message);
  });

  await boss.start();

  // Preserve the former AppDeploy schedule: every 15 minutes in Jakarta time.
  await boss.schedule(
    "sla-update-reminder",
    "*/15 * * * *",
    {
      purpose: "notify overdue active incidents",
      schemaVersion: 1
    },
    { tz: "Asia/Jakarta" }
  );

  await boss.work("sla-update-reminder", async (jobs) => {
    const result = await slaReminderHandler();
    console.info("sla_reminder_job_complete", {
      batchSize: Array.isArray(jobs) ? jobs.length : 1,
      statusCode: result.statusCode,
      body: result.body
    });
  });

  console.info("background_jobs_started", {
    schedules: ["sla-update-reminder"],
    timezone: "Asia/Jakarta"
  });

  return boss;
}
