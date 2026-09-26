import type { DepartmentId } from "@agentstore/shared";

/** PatternFly `Label`/`Badge` only accept a fixed color enum, so department
 * accents map onto the closest PatternFly color token instead of the
 * arbitrary hex values the old bespoke theme used. */
export const DEPARTMENT_ACCENT: Record<
  DepartmentId,
  "blue" | "teal" | "green" | "orange" | "purple" | "red" | "orangered" | "grey" | "yellow"
> = {
  engineering: "teal",
  security: "orange",
  support: "purple",
  data: "blue",
  finance: "yellow",
};
