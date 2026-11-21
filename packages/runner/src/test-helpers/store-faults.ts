export function storeFaults() {
  let table: string | undefined;
  return {
    failAfter: (name: string) => {
      table = name;
    },
    clear: () => {
      table = undefined;
    },
    afterWrite: (name: string) => {
      if (name === table) throw new Error(`store fault: ${name}`);
    },
  };
}
