/**
 * @waypoint/planner - delivery planning and route-leg scheduling.
 *
 * TypeScript port of docs/delivery-planning-flowchart.md (charts M, F1-F9).
 * The Python implementation in tools/planner-oracle is the reference; test/parity.test.ts
 * proves this engine produces identical plans on real dataset days.
 */
export * from "./types";
export * as params from "./params";
export { createReference, makeOrder, capabilityCost, cmpStr, type Reference, type ReferenceInput } from "./reference";
export { hhmmToMin, minToHhmm, addDays } from "./time";
export { window, tripMinutes, tripMinutesOf, litres, bucketOf } from "./formulas";
export { intake, isOperating, nextOperatingDay, previousOperatingDay, type IntakeResult } from "./intake";
export { checkVehicle, eligibleVehicles, unavoidableReason, weight, orderClass, type StatusMap } from "./eligibility";
export { PLANNED, EXPECTED, emptyContext, contextForDate, sequence, legMinutes, serviceMinutes, schedule, departureTime } from "./schedule";
export { MODE_2B, MODE_LIVE, RULE_TEXT, checkVehicleDay } from "./vehicle-day";
export { buildTrips, type Trips } from "./build";
export { repairAndClassify } from "./repair";
export { planDay, timePlan, servedMap, loadList, dockSignoff, carryOver, type DockDecision } from "./plan";
export { rescheduleRemaining, notDeparted, longStopAlarmTime, projectPosition, syncEvent, type SyncOutcome } from "./live";
