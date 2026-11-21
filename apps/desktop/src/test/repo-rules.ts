export function findPrivateTraces(text: string): string[] {
  const findings: string[] = [];
  if (
    /(?:\/Users\/[^/\s]+(?:\/|\b)|\/home\/(?!test(?:\/|\b)|example(?:\/|\b))[^/\s]+|\/Volumes\/|[A-Za-z]:\\Users\\)/.test(
      text,
    )
  ) {
    findings.push("absolute local path");
  }
  const addresses = text.match(/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g) ?? [];
  if (
    addresses.some(
      (address) =>
        !/^[^@]+@(?:example\.test|example\.com)$/i.test(address) &&
        address.toLowerCase() !== "donotreply@upwork.com",
    )
  ) {
    findings.push("address");
  }
  const withoutHashes = text
    .replace(/sha256:[a-f0-9]{64}\b/gi, "")
    .replace(/\b(?:from\s*|import\s*\(?\s*)["'][^"']+["']/g, "");
  if (/(?<![A-Za-z0-9])[A-Za-z0-9]{40,}(?![A-Za-z0-9])/.test(withoutHashes)) {
    findings.push("long token");
  }
  return findings;
}
