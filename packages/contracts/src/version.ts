export const CONTRACT_VERSION = 2;

export function isSupportedContractVersion(n: number): boolean {
  return n === CONTRACT_VERSION;
}

export function checkContractVersion(value: unknown): "ok" | "contract_mismatch" {
  return typeof value === "number" && isSupportedContractVersion(value) ? "ok" : "contract_mismatch";
}
