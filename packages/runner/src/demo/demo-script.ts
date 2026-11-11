import type { Script } from "../scripted-harness.ts";
export const DEMO_TITLES: Record<string, string> = {
  j1: "Job one",
  j2: "Job two",
  j3: "Job three",
  j4: "Job four",
  j5: "Job five",
};
export const DEMO_SCORES: Record<string, number> = { j1: 9, j2: 4, j3: 8, j4: 6, j5: 8 };
export const DEMO_FIT = ["j1", "j3", "j5"];
export function demoScript(ids: string[]): Script {
  const jobId = (instructions: string) => {
    const id = /"id":"(j\d)"/.exec(instructions)?.at(1);
    if (!id || !Object.hasOwn(DEMO_TITLES, id)) throw new Error("Unknown demo job.");
    return id;
  };
  return {
    steps: {
      alerts: { outputs: { jobs: ids.map((id) => ({ id, title: DEMO_TITLES[id] ?? "" })) }, text: "" },
      rough: (req) => {
        const id = jobId(req.instructions);
        const value = DEMO_SCORES[id];
        if (value === undefined) throw new Error("Unknown score.");
        return { outputs: { score: { value } } };
      },
      page: (req) => ({ text: `Full post: ${DEMO_TITLES[jobId(req.instructions)]}` }),
      full: (req) => ({
        outputs: { verdict: { fit: DEMO_FIT.includes(jobId(req.instructions)) } },
      }),
      proto: (req) => ({ text: `Published at /p/${jobId(req.instructions)}` }),
      proposal: (req) => ({ text: `Hello, here is my plan for ${DEMO_TITLES[jobId(req.instructions)]}.` }),
    },
  };
}
