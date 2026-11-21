type BrainCall = {
  chatId: string;
  agent: string;
  model: string;
  tools: string[];
  schema: object;
  text: string;
  parts: { text: string; outside: boolean }[];
};

type ScriptEntry = { when?: string; answer: object | string };

export function createFakeBrain(script: ScriptEntry[]) {
  const remaining = [...script];
  const calls: BrainCall[] = [];
  return {
    calls,
    chat: (call: BrainCall): string => {
      calls.push(call);
      const index = remaining.findIndex(
        (entry) => entry.when === undefined || call.text.includes(entry.when),
      );
      if (index === -1) throw new Error("No matching fake brain answer");
      const [entry] = remaining.splice(index, 1);
      if (entry === undefined) throw new Error("No matching fake brain answer");
      return typeof entry.answer === "string" ? entry.answer : JSON.stringify(entry.answer);
    },
  };
}
