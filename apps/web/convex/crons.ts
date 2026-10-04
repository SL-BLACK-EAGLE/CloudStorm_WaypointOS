import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

const crons = cronJobs();

// Every minute: alert the loader and the dispatcher about vehicles due to leave within 5 minutes,
// or already late, that the loader has not signed off yet.
crons.interval("departure alerts", { minutes: 1 }, internal.departures.tick, {});

export default crons;
